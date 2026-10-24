// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import android.util.Base64
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dns
import okhttp3.Headers
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.IOException
import java.net.InetAddress
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal fun origin(url: HttpUrl): String = "${url.scheme}://${url.host}${if (url.port == 443) "" else ":${url.port}"}"

internal fun httpsUrl(raw: String): HttpUrl {
    requireEngine(raw.length <= 8192, "LIMIT", "URL exceeds the length budget")
    val url = raw.toHttpUrlOrNull() ?: throw EngineFailure("UNSUPPORTED_URL", "Only HTTPS URLs are supported")
    requireEngine(url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.port == 443,
        "UNSUPPORTED_URL", "TLS, default HTTPS port, and credential-free URLs are required")
    return url
}

internal fun safeUrl(raw: String, allowed: Set<String>): HttpUrl {
    val url = httpsUrl(raw)
    requireEngine(origin(url) in allowed, "UNSUPPORTED_ORIGIN", "URL origin is not in the reviewed plugin policy")
    return url
}

internal fun safeHeaders(headers: Map<String, String>): Map<String, String> {
    requireEngine(headers.size <= 32 && headers.keys.map { it.lowercase(Locale.US) }.distinct().size == headers.size,
        "LIMIT", "Too many or duplicate HTTP headers")
    var total = 0
    return headers.mapKeys { it.key.lowercase(Locale.US) }.onEach { (name, value) ->
        total += name.length + value.length
        requireEngine(name.matches(Regex("[a-z0-9!#$%&'*+.^_`|~-]+")) && value.length <= 8192 &&
            value.none { it == '\r' || it == '\n' || it == '\u0000' } && total <= 32768,
            "INVALID_HEADERS", "Invalid HTTP headers")
        requireEngine(name !in setOf("host", "connection", "content-length", "transfer-encoding", "proxy-authorization", "proxy-connection", "set-cookie"),
            "INVALID_HEADERS", "Transport-owned header is not permitted")
    }
}

internal fun isPublicAddress(address: InetAddress): Boolean {
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
        address.isSiteLocalAddress || address.isMulticastAddress) return false
    val bytes = address.address.map { it.toInt() and 255 }
    if (bytes.size == 4) {
        val a = bytes[0]; val b = bytes[1]; val c = bytes[2]
        return !(a == 0 || a == 10 || a == 127 || a >= 224 || a == 169 && b == 254 ||
            a == 172 && b in 16..31 || a == 192 && b == 168 || a == 100 && b in 64..127 ||
            a == 192 && b == 0 || a == 192 && b == 88 && c == 99 || a == 198 && b in 18..19 ||
            a == 198 && b == 51 && c == 100 || a == 203 && b == 0 && c == 113)
    }
    if (bytes.size == 16) {
        if ((bytes[0] and 0xe0) != 0x20) return false
        if (bytes[0] == 0x20 && bytes[1] == 0x02) return false // 6to4 can encode a private IPv4 destination.
        if (bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0 && bytes[3] == 0) return false // Teredo.
        if (bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0d && bytes[3] == 0xb8) return false
        return true
    }
    return false
}

internal class HttpBroker(testTransport: OkHttpClient? = null) {
    // Internal instrumentation seam only. The Expo module always uses the strict default client.
    private val client = testTransport ?: OkHttpClient.Builder()
        .proxy(java.net.Proxy.NO_PROXY)
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(12, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)
        .dns(object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val addresses = Dns.SYSTEM.lookup(hostname)
                if (addresses.isEmpty() || addresses.any { !isPublicAddress(it) }) {
                    // OkHttp's asynchronous dispatcher expects DNS policy failures to be IOExceptions.
                    throw java.net.UnknownHostException("Private or reserved destination is not permitted")
                }
                return addresses
            }
        }).build()

    fun session(origins: Set<String>): Session = Session(origins)

    suspend fun inspectRepository(input: Map<String, Any?>, control: RequestControl): Map<String, Any?> {
        requireEngine(input.keys.none { it in setOf("headers", "authorization", "cookies", "body") },
            "INVALID_REQUEST", "Repository metadata intake accepts no credentials or request body")
        val session = Session(emptySet(), metadataOnly = true)
        val hook = control.onCancel { session.close() }
        try { return session.metadata(input.text("url", 8192)) } finally { hook.close(); session.close() }
    }

    inner class Session internal constructor(private val allowedOrigins: Set<String>, private val metadataOnly: Boolean = false) : AutoCloseable {
        private val calls = ConcurrentHashMap<String, Call>()
        private val aborted = ConcurrentHashMap.newKeySet<String>()
        private val callCount = AtomicInteger()
        @Volatile private var closed = false
        private fun validate(raw: String): HttpUrl = if (metadataOnly) httpsUrl(raw) else safeUrl(raw, allowedOrigins)

        fun abort(id: String) {
            requireEngine(id.length <= 128 && aborted.size < 128, "LIMIT", "HTTP cancellation identifier budget exceeded")
            aborted.add(id); calls[id]?.cancel()
        }

        @Synchronized private fun makeCall(id: String, request: Request): Call {
            requireEngine(id.length <= 128, "INVALID_REQUEST", "HTTP identifier exceeds the budget")
            requireEngine(!closed && id !in aborted, "CANCELLED", "HTTP request cancelled")
            validate(request.url.toString())
            if (metadataOnly) requireEngine(request.method == "GET" && request.body == null && request.headers.names().all {
                it.equals("User-Agent", true) || it.equals("Accept", true)
            }, "INVALID_REQUEST", "Metadata intake only allows unauthenticated GET requests")
            requireEngine(callCount.incrementAndGet() <= 32 && calls.size < 4,
                "LIMIT", "Plugin HTTP call budget exceeded")
            val call = client.newCall(request)
            requireEngine(calls.putIfAbsent(id, call) == null, "INVALID_REQUEST", "Duplicate HTTP request identifier")
            if (closed || id in aborted) call.cancel()
            return call
        }

        private suspend fun await(id: String, request: Request, limit: Int = Limits.BODY): Response = suspendCancellableCoroutine { continuation ->
            val call = try { makeCall(id, request) } catch (error: Exception) {
                continuation.resumeWithException(error)
                return@suspendCancellableCoroutine
            }
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, error: IOException) {
                    calls.remove(id, call)
                    val failure = when {
                        id in aborted || closed -> EngineFailure("CANCELLED", "HTTP request cancelled")
                        error is java.net.UnknownHostException -> EngineFailure("UNSUPPORTED_ORIGIN", "DNS lookup failed or returned a nonpublic destination")
                        else -> error
                    }
                    if (continuation.isActive) continuation.resumeWithException(failure)
                }
                override fun onResponse(call: Call, response: Response) {
                    try {
                        val bounded = bufferResponse(response, limit)
                        calls.remove(id, call)
                        if (id in aborted || closed) {
                            bounded.close()
                            if (continuation.isActive) continuation.resumeWithException(EngineFailure("CANCELLED", "HTTP request cancelled"))
                        } else if (continuation.isActive) continuation.resume(bounded) else bounded.close()
                    } catch (error: Exception) {
                        response.close()
                        calls.remove(id, call)
                        if (continuation.isActive) continuation.resumeWithException(error)
                    } finally { calls.remove(id, call) }
                }
            })
        }

        private fun bufferResponse(response: Response, limit: Int = Limits.BODY): Response {
            response.use {
                val headers = response.headers
                requireEngine(headers.size <= 64 && headers.toString().length <= 32768,
                    "LIMIT", "Response headers exceed the budget")
                val body = response.body
                requireEngine(body.contentLength() <= limit, "LIMIT", "HTTP response is too large")
                val type = body.contentType()
                val bytes = body.byteStream().readBounded(limit)
                return response.newBuilder().body(bytes.toResponseBody(type)).build()
            }
        }

        private fun request(url: String, method: String, headers: Map<String, String>, bytes: ByteArray?): Request {
            val parsed = validate(url)
            requireEngine(method in setOf("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"),
                "UNSUPPORTED_HTTP", "Unsupported HTTP method")
            requireEngine(bytes == null || bytes.size <= Limits.BODY, "LIMIT", "HTTP request body is too large")
            requireEngine(method !in setOf("GET", "HEAD") || bytes == null, "INVALID_REQUEST", "GET and HEAD cannot contain a body")
            val validated = safeHeaders(headers)
            val body = if (method in setOf("POST", "PUT", "PATCH") || bytes != null)
                (bytes ?: byteArrayOf()).toRequestBody(validated["content-type"]?.toMediaTypeOrNull()) else null
            return Request.Builder().url(parsed).headers(Headers.headersOf())
                .header("User-Agent", "Cinetor/1 NativeEngine")
                .apply { validated.forEach { (name, value) -> header(name, value) } }.method(method, body).build()
        }

        private fun redirected(previous: Request, response: Response, mode: String): Request? {
            if (response.code !in setOf(301, 302, 303, 307, 308)) return null
            if (mode == "manual") return null
            requireEngine(mode != "error", "HTTP_REDIRECT", "Redirect was not allowed by this fetch")
            val location = response.header("Location") ?: return null
            val next = previous.url.resolve(location) ?: throw EngineFailure("HTTP_REDIRECT", "Invalid redirect location")
            validate(next.toString())
            val sameOrigin = origin(previous.url) == origin(next)
            // Drop every plugin-controlled header on an origin transition, not only Authorization.
            val headers = if (sameOrigin) previous.headers.toMap().filterKeys { it.lowercase(Locale.US) != "content-length" }
                else emptyMap()
            val changesToGet = response.code == 303 || (response.code in setOf(301, 302) && previous.method == "POST")
            requireEngine(sameOrigin || previous.body == null || changesToGet,
                "HTTP_REDIRECT", "Cross-origin replay of an HTTP request body is not permitted")
            return previous.newBuilder().url(next).headers(Headers.headersOf()).apply {
                headers.forEach { (name, value) -> header(name, value) }
                if (changesToGet) { method("GET", null); removeHeader("content-type"); removeHeader("content-length") }
            }.build()
        }

        suspend fun fetch(id: String, url: String, method: String, headers: Map<String, String>, bytes: ByteArray?, mode: String): String {
            requireEngine(mode in setOf("follow", "manual", "error"), "INVALID_REQUEST", "Invalid redirect mode")
            var current = request(url, method, headers, bytes)
            repeat(6) { attempt ->
                val response = await(id, current)
                response.use {
                    val next = redirected(current, response, mode)
                    if (next == null) {
                        val body = response.body.bytes()
                        return Json.encode(mapOf("ok" to response.isSuccessful, "status" to response.code,
                            "statusText" to response.message, "url" to response.request.url.toString(),
                            "redirected" to (attempt > 0), "headers" to response.headers.toMap().mapKeys { it.key.lowercase(Locale.US) },
                            "bodyBase64" to Base64.encodeToString(body, Base64.NO_WRAP),
                            "body" to body.toString(response.body.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8)))
                    }
                    current = next
                }
            }
            throw EngineFailure("HTTP_REDIRECT", "Too many HTTP redirects")
        }

        suspend fun metadata(url: String): Map<String, Any?> {
            requireEngine(metadataOnly, "INVALID_REQUEST", "Metadata mode is required")
            var current = request(url, "GET", mapOf("accept" to "application/json"), null)
            repeat(6) {
                val response = await("metadata", current)
                response.use {
                    val next = redirected(current, response, "follow")
                    if (next == null) {
                        requireEngine(response.code !in setOf(401, 403), "AUTH", "Repository metadata requires authorization")
                        requireEngine(response.isSuccessful, "HTTP_STATUS", "Repository metadata endpoint did not return success")
                        val bytes = response.body.bytes()
                        val text = try { Charsets.UTF_8.newDecoder()
                            .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                            .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                            .decode(java.nio.ByteBuffer.wrap(bytes)).toString() }
                        catch (_: Exception) { throw EngineFailure("MALFORMED", "Repository metadata must be UTF-8") }
                        val json = Json.parse(text)
                        requireEngine(json.isObject || json.isArray, "MALFORMED", "Repository metadata must be a JSON object or array")
                        return mapOf("url" to response.request.url.toString(), "bodyText" to text,
                            "byteLength" to bytes.size, "sha256" to sha256(bytes))
                    }
                    current = next
                }
            }
            throw EngineFailure("HTTP_REDIRECT", "Too many repository redirects")
        }

        suspend fun probe(input: Map<String, Any?>): Map<String, Any?> {
            val target = safeUrl(input.text("url", 8192), allowedOrigins)
            val declaredOrigin = input["headerOrigin"] as? String
            val raw = input["headers"]
            val parsed = Json.parse(Json.encode(raw ?: emptyMap<String, String>()), 32768)
            requireEngine(parsed.isObject && parsed.all { it.isTextual }, "INVALID_HEADERS", "Probe headers must be strings")
            val supplied = safeHeaders(parsed.fields().asSequence().associate { it.key to it.value.asText() })
            val confined = if (declaredOrigin == null || declaredOrigin == origin(target)) supplied else emptyMap()
            val container = (input["container"] as? String) ?: "unknown"
            requireEngine(container.length <= 40, "INVALID_REQUEST", "Invalid probe container")
            val manifest = container in setOf("hls", "dash", "m3u8", "mpd")
            val limit = if (manifest) Limits.BODY else 4096
            var current = request(target.toString(), "GET", confined + if (manifest) emptyMap() else mapOf("range" to "bytes=0-4095"), null)
            repeat(6) {
                val response = await("probe", current, limit)
                response.use {
                    val next = redirected(current, response, "follow")
                    if (next != null) {
                        current = next.newBuilder().apply { if (!manifest) header("Range", "bytes=0-4095") }.build()
                    } else {
                        requireEngine(response.code !in setOf(401, 403), "AUTH", "Media endpoint requires authorization")
                        requireEngine(response.isSuccessful, "HTTP_STATUS", "Media endpoint did not return a successful response")
                        val bytes = response.body.bytes()
                        val fingerprint = java.security.MessageDigest.getInstance("SHA-256")
                        fun frame(bytes: ByteArray) { fingerprint.update(java.nio.ByteBuffer.allocate(4).putInt(bytes.size).array()); fingerprint.update(bytes) }
                        val fields = sortedMapOf(
                            "version" to "cinetor-media-probe-v1", "url" to response.request.url.toString(),
                            "headerOrigin" to origin(response.request.url), "container" to container,
                            "status" to response.code.toString(), "etag" to (response.header("ETag") ?: ""),
                            "lastModified" to (response.header("Last-Modified") ?: ""),
                            "contentLength" to (response.header("Content-Length") ?: ""),
                            "contentRange" to (response.header("Content-Range") ?: ""))
                        response.request.headers.toMap().forEach { (name, value) -> fields["request-header:${name.lowercase(Locale.US)}"] = value }
                        fields.forEach { (key, value) -> frame(key.toByteArray(Charsets.UTF_8)); frame(value.toByteArray(Charsets.UTF_8)) }
                        frame("probeBytes".toByteArray(Charsets.UTF_8)); frame(bytes)
                        val representation = fingerprint.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
                        return mapOf("statusCode" to response.code, "url" to response.request.url.toString(),
                            "representationId" to representation,
                            "headers" to response.headers.toMap().mapKeys { it.key.lowercase(Locale.US) }.filterKeys { it != "set-cookie" },
                            "bodyBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP),
                            "bodyText" to if (manifest) bytes.toString(Charsets.UTF_8) else "",
                            "byteLength" to bytes.size, "kind" to if (manifest) "manifest" else "prefix")
                    }
                }
            }
            throw EngineFailure("HTTP_REDIRECT", "Too many media redirects")
        }

        // NiceHttp.custom() may override the outer client's timeout/TLS/redirect fields.
        // This interceptor never proceeds on that client: it uses our separate TLS client,
        // validates each redirect, bounds bodies, and tracks calls in the request session.
        fun cloudstreamInterceptor(): Interceptor = Interceptor { chain ->
            var current = chain.request()
            safeHeaders(current.headers.toMap().filterKeys { it.lowercase(Locale.US) !in setOf("content-length") })
            requireEngine(current.body == null, "UNSUPPORTED_HTTP", "This reviewed Cloudstream profile only permits read-only HTTP requests")
            val id = "cs-${java.util.UUID.randomUUID()}"
            var finalResponse: Response? = null
            for (attempt in 0..5) {
                val call = makeCall(id, current)
                val response = try { bufferResponse(call.execute()) } finally { calls.remove(id, call) }
                val next = try { redirected(current, response, "follow") } catch (error: Exception) { response.close(); throw error }
                if (next == null) { finalResponse = response; break }
                response.close()
                current = next
            }
            finalResponse ?: throw EngineFailure("HTTP_REDIRECT", "Too many HTTP redirects")
        }

        override fun close() {
            closed = true
            calls.values.forEach { it.cancel() }
            calls.clear()
            aborted.clear()
        }
    }
}
