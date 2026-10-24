package expo.modules.cinetorbdix

import java.io.Closeable
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.util.Locale
import java.util.concurrent.TimeUnit

internal class HttpResponse(val status: Int, val headers: Map<String, String>, val input: InputStream, private val socket: Socket) : Closeable {
  override fun close() { runCatching { socket.close() } }
}

/** HTTP/1.1 over a selected-Network socket; no cookies, redirects, auth, proxies, or default route. */
internal object HttpTransport {
  private fun request(endpoint: ApprovedEndpoint, operation: BdixOperation, uri: URI, socketFactory: () -> Socket,
    resolveHost: (String) -> java.net.InetAddress, range: String? = null): HttpResponse {
    endpoint.requireEnabled(); endpoint.contain(uri.toASCIIString(), pagination = true); operation.check()
    var socket: Socket? = null
    val deadline = NetworkIo.deadlines.schedule({ operation.cancel("timeout") }, Limits.CONNECT_MS.toLong(), TimeUnit.MILLISECONDS)
    try {
      val peer = resolveHost(uri.host)
      val raw = operation.track(socketFactory()).apply { soTimeout = Limits.READ_MS }
      socket = raw
      raw.connect(InetSocketAddress(peer, if (uri.port >= 0) uri.port else if (uri.scheme == "https") 443 else 80), Limits.CONNECT_MS)
      if (uri.scheme == "https") socket = Wire.tls(raw, uri.host, operation)
      operation.check()
    } catch (error: Throwable) { runCatching { socket?.close() }; throw error }
    finally { deadline.cancel(false) }
    val connected = socket ?: fail("network", "http-connect-failed")
    try {
      val host = uri.rawAuthority
      val target = uri.rawPath + (uri.rawQuery?.let { "?$it" } ?: "")
      val request = "GET $target HTTP/1.1\r\nHost: $host\r\nUser-Agent: Cinetor-BDIX/1\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n" +
        (range?.let { "Range: $it\r\n" } ?: "") + "\r\n"
      connected.getOutputStream().apply { write(request.toByteArray(Charsets.US_ASCII)); flush() }
      val lines = LineInput(connected.getInputStream(), operation, 32768)
      val statusLine = lines.line()?.let { String(it, Charsets.US_ASCII) } ?: fail("malformed", "missing-http-status")
      val status = Regex("HTTP/1\\.[01] ([0-9]{3})(?: [^\\r\\n]*)?").matchEntire(statusLine)?.groupValues?.get(1)?.toInt() ?: fail("malformed", "invalid-http-status")
      val headers = linkedMapOf<String, String>()
      while (true) {
        val line = lines.line()?.let { String(it, Charsets.ISO_8859_1) } ?: fail("malformed", "truncated-http-headers")
        if (line.isEmpty()) break
        val colon = line.indexOf(':')
        if (colon < 1 || line.first().isWhitespace()) fail("malformed", "invalid-http-header")
        val name = line.substring(0, colon).lowercase(Locale.ROOT)
        val value = line.substring(colon + 1).trim()
        if (!Regex("[a-z0-9!#$%&'*+.^_`|~-]+").matches(name) || value.any { it.code < 32 && it != '\t' || it.code == 127 }) fail("malformed", "invalid-http-header")
        if (headers.containsKey(name) && name in setOf("content-length", "transfer-encoding", "content-range", "content-encoding", "etag")) fail("malformed", "ambiguous-http-framing")
        headers[name] = value
        if (headers.size > 64) fail("size", "http-header-limit")
      }
      if (status in 300..399) fail("scope", "redirect-not-approved")
      if (status !in setOf(200, 206)) fail(when (status) { 401 -> "authentication"; 403 -> "permission"; 429 -> "rate-limit"; else -> "http" }, "http-status-$status")
      if (headers["content-encoding"]?.lowercase() !in setOf(null, "identity")) fail("unsupported", "content-encoding-unsupported")
      val length = headers["content-length"]?.let { value ->
        if (!Regex("[0-9]{1,19}").matches(value)) fail("malformed", "invalid-content-length")
        value.toLongOrNull()?.takeIf { it >= 0 } ?: fail("malformed", "invalid-content-length")
      }
      val transfer = headers["transfer-encoding"]?.lowercase()
      if (transfer != null && (length != null || transfer != "chunked")) fail("malformed", "ambiguous-http-framing")
      val body = when {
        transfer == "chunked" -> ChunkedBody(lines.input, operation)
        length != null -> FixedBody(lines.input, length, operation)
        else -> lines.input
      }
      return HttpResponse(status, headers, body, connected)
    } catch (error: Throwable) { runCatching { connected.close() }; throw error }
  }
  fun list(endpoint: ApprovedEndpoint, scope: NetworkScope, operation: BdixOperation, uri: URI, maxBytes: Int): Map<String, Any> {
    request(endpoint, operation, uri, { BoundSocketFactory(scope, operation).createSocket() }, { NetworkIo.resolve(it, scope, operation) }).use { response ->
      if (response.status != 200) fail("malformed", "partial-listing")
      val declared = response.headers["content-length"]?.toLongOrNull()
      if (declared != null && declared > maxBytes) fail("size", "listing-byte-limit")
      val contentType = response.headers["content-type"] ?: fail("unsupported", "listing-content-type")
      if (contentType.substringBefore(';').lowercase() !in setOf("text/html", "application/xhtml+xml", "application/json", "application/vnd.cinetor.directory+json")) fail("unsupported", "listing-content-type")
      val charset = Regex("charset=([^; ]+)", RegexOption.IGNORE_CASE).find(contentType)?.groupValues?.get(1)?.trim('"', '\'')?.lowercase()
      if (charset !in setOf(null, "utf-8", "utf8", "us-ascii")) fail("unsupported", "listing-charset-unsupported")
      val bytes = Wire.prefix(response.input, maxBytes + 1, operation)
      if (bytes.size > maxBytes) fail("size", "listing-byte-limit")
      return mapOf("url" to uri.toASCIIString(), "networkContext" to scope.toMap(), "contentType" to contentType, "text" to Wire.utf8(bytes), "bytes" to bytes.size)
    }
  }
  private fun metadata(response: HttpResponse, uri: URI, range: Boolean): RemoteMetadata {
    val length = response.headers["content-length"]?.toLongOrNull() ?: fail("unsupported", "finite-content-length-required")
    if (response.headers.containsKey("transfer-encoding")) fail("unsupported", "finite-content-length-required")
    val size = if (response.status == 206) {
      if (!range) fail("malformed", "unexpected-partial-response")
      val parts = Regex("bytes 0-([0-9]+)/([0-9]+)").matchEntire(response.headers["content-range"] ?: "") ?: fail("malformed", "invalid-content-range")
      val end = parts.groupValues[1].toLongOrNull() ?: fail("malformed", "invalid-content-range")
      val total = parts.groupValues[2].toLongOrNull() ?: fail("malformed", "invalid-content-range")
      if (end >= total || end > 8191 || end + 1 != length) fail("malformed", "invalid-content-range")
      total
    } else {
      if (response.headers.containsKey("content-range")) fail("malformed", "unexpected-content-range")
      length
    }
    if (size < 16 || size > Limits.FILE_BYTES) fail("size", "file-size-limit")
    val container = PathPolicy.container(uri) ?: fail("unsupported", "progressive-media-required")
    val validator = response.headers["etag"]?.takeIf { Regex("\"[\\x21\\x23-\\x7e]{1,256}\"").matches(it) }
    return RemoteMetadata(size, container, validator, "not-applicable")
  }
  fun probe(endpoint: ApprovedEndpoint, scope: NetworkScope, operation: BdixOperation, uri: URI): RemoteMetadata {
    endpoint.pinned(uri.toASCIIString())
    request(endpoint, operation, uri, { BoundSocketFactory(scope, operation).createSocket() }, { NetworkIo.resolve(it, scope, operation) }, "bytes=0-8191").use { response ->
      val metadata = metadata(response, uri, true)
      val bytes = Wire.prefix(response.input, 8192, operation)
      if (!PathPolicy.sniff(bytes, metadata.container)) fail("unsupported", "media-signature-mismatch")
      return metadata
    }
  }
  fun stream(endpoint: ApprovedEndpoint, scope: NetworkScope, operation: BdixOperation, uri: URI): RemoteStream =
    stream(endpoint, operation, uri, { BoundSocketFactory(scope, operation).createSocket() }, { NetworkIo.resolve(it, scope, operation) })

  internal fun stream(endpoint: ApprovedEndpoint, operation: BdixOperation, uri: URI, socketFactory: () -> Socket, resolveHost: (String) -> java.net.InetAddress): RemoteStream {
    endpoint.pinned(uri.toASCIIString())
    val response = request(endpoint, operation, uri, socketFactory, resolveHost)
    try {
      val metadata = metadata(response, uri, false)
      return RemoteStream(response.input, metadata, { operation.check() }, { response.close() })
    } catch (error: Throwable) { response.close(); throw error }
  }
}

internal class FixedBody(private val input: InputStream, private var remaining: Long, private val operation: BdixOperation) : InputStream() {
  override fun read(): Int { val buffer = ByteArray(1); return if (read(buffer, 0, 1) < 0) -1 else buffer[0].toInt() and 255 }
  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (length == 0) return 0
    operation.check()
    if (remaining == 0L) return -1
    val count = input.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
    if (count < 0) fail("network", "truncated-http-body")
    remaining -= count; return count
  }
}
internal class ChunkedBody(input: InputStream, private val operation: BdixOperation) : InputStream() {
  private val lines = LineInput(input, operation, 65536, 1024)
  private var remaining = 0L
  private var complete = false
  private var needTerminator = false
  override fun read(): Int { val buffer = ByteArray(1); return if (read(buffer, 0, 1) < 0) -1 else buffer[0].toInt() and 255 }
  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    if (length == 0) return 0
    operation.check()
    if (complete) return -1
    if (remaining == 0L) {
      if (needTerminator && lines.line()?.isEmpty() != true) fail("malformed", "invalid-chunk-terminator")
      val header = lines.line()?.let { String(it, Charsets.US_ASCII) } ?: fail("malformed", "truncated-chunk")
      if (!Regex("[0-9a-fA-F]{1,8}").matches(header)) fail("malformed", "invalid-chunk-size")
      remaining = header.toLong(16)
      if (remaining > Limits.PAGE_BYTES) fail("size", "listing-byte-limit")
      if (remaining == 0L) {
        // No trailers can redefine framing or validators.
        if (lines.line()?.isEmpty() != true) fail("unsupported", "http-trailers-unsupported")
        complete = true; return -1
      }
      needTerminator = true
    }
    val count = lines.input.read(buffer, offset, minOf(length.toLong(), remaining).toInt())
    if (count < 0) fail("network", "truncated-chunk")
    remaining -= count; return count
  }
}
