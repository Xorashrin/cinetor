// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines.nuvio

import android.util.Base64
import com.cinetor.engines.*
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.asyncFunction
import com.dokar.quickjs.binding.define
import com.dokar.quickjs.binding.function
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** NuvioMobile's modular host contract on the official, pinned Android QuickJS runtime. */
internal class NuvioRuntime(private val store: PluginStore, private val settings: SettingsStore, private val http: HttpBroker) {
    suspend fun resolve(input: Map<String, Any?>, control: RequestControl): Map<String, Any?> {
        val entry = store.entry(input.text("pluginId", 128), "nuvio")
        val tmdb = input.text("tmdbId", 20)
        requireEngine(tmdb.matches(Regex("[1-9][0-9]{0,18}")), "INVALID_REQUEST", "TMDB identity must be a positive decimal string")
        val mediaType = input.text("mediaType", 5)
        requireEngine(mediaType == "movie" || mediaType == "tv", "INVALID_REQUEST", "mediaType must be movie or tv")
        val season = input.optionalInt("season"); val episode = input.optionalInt("episode")
        requireEngine(if (mediaType == "tv") season != null && episode != null && episode > 0 else season == null && episode == null,
            "INVALID_REQUEST", "TV requests require exact season and episode; movies cannot have episode fields")
        input.text("contentKey", 512)
        val args = mapOf("tmdbId" to tmdb, "mediaType" to mediaType, "season" to season, "episode" to episode)
        val json = execute(entry, input, control, args, false)
        val parsed = Json.parse(json)
        requireEngine(parsed.isArray && parsed.size() <= Limits.MAX_SOURCES, "MALFORMED", "getStreams must return a bounded array")
        val sources = parsed.map { StreamNormalizer.nuvio(it, entry) }.distinctBy { it["sourceId"] }
        return result(input, "sources", sources, sources.isEmpty())
    }

    suspend fun settingsLayout(input: Map<String, Any?>, control: RequestControl): Map<String, Any?> {
        val entry = store.entry(input.text("pluginId", 128), "nuvio")
        val parsed = Json.parse(execute(entry, input, control, emptyMap(), true), 32768)
        requireEngine(parsed.isArray && parsed.size() <= 64, "MALFORMED", "Invalid onSettings layout")
        return result(input, "layout", Json.mapper.convertValue(parsed, List::class.java), parsed.isEmpty)
    }

    private suspend fun execute(entry: ReviewedPlugin, input: Map<String, Any?>, control: RequestControl,
                                args: Map<String, Any?>, layout: Boolean): String {
        val code = store.verifiedBytes(entry).toString(Charsets.UTF_8)
        val profile = (input["profileId"] as? String) ?: "default"
        val settingsJson = Json.encode(settings.read(entry.id, profile))
        return evaluate(code, entry.id, settingsJson, Json.encode(args), entry.networkOrigins, control, layout)
    }

    // Internal for device contract tests only. Expo never exposes a raw-code evaluator.
    internal suspend fun evaluate(code: String, id: String, settingsJson: String, argsJson: String,
                                  origins: Set<String>, control: RequestControl, layout: Boolean = false): String {
        requireEngine(code.toByteArray().size <= Limits.CODE, "LIMIT", "Plugin code exceeds the budget")
        val runtime = QuickJs.create(Dispatchers.IO)
        val nativeFailure = AtomicReference<EngineFailure?>()
        val activeTimers = AtomicInteger()
        val totalTimers = AtomicInteger()
        val session = http.session(origins)
        val dom = DomBridge()
        val cancelHook = control.onCancel { runtime.interruptEvaluation(); session.close() }
        fun guard(block: () -> Any?): Any? = try { control.check(); block() } catch (error: EngineFailure) {
            nativeFailure.compareAndSet(null, error); throw error
        }
        fun bind(name: String, block: (Array<Any?>) -> Any?) { runtime.function(name) { values -> guard { block(values) } } }
        fun arg(values: Array<Any?>, index: Int): String = values.getOrNull(index)?.toString() ?: ""
        try {
            runtime.memoryLimit = 32L * 1024 * 1024
            runtime.maxStackSize = 512L * 1024
            runtime.evaluationTimeoutMillis = control.remaining()
            runtime.define("console") {
                for (name in listOf("log", "warn", "error", "info", "debug")) function(name) { _: Array<Any?> ->
                    // Intentionally redact plugin output: it can contain credentials and signed URLs.
                    null
                }
            }
            bind("__get_scraper_id") { id }
            bind("__get_scraper_settings") { settingsJson }
            bind("__get_tmdb_api_key") { "" }
            bind("__get_call_args") { argsJson }
            bind("__unsupported") { throw EngineFailure("UNSUPPORTED_API", "Plugin requested a host capability not in this runtime profile") }
            bind("__native_abort_fetch") { values -> session.abort(arg(values, 0)); null }
            runtime.asyncFunction("__plugin_sleep") { values: Array<Any?> ->
                try {
                    control.check()
                    requireEngine(totalTimers.incrementAndGet() <= 256 && activeTimers.incrementAndGet() <= 32,
                        "LIMIT", "Timer budget exceeded")
                    val duration = (values.firstOrNull() as? Number)?.toLong()?.coerceIn(0, Limits.TIMEOUT) ?: 0
                    try { delay(duration) } finally { activeTimers.decrementAndGet() }
                    control.check()
                    null
                } catch (error: EngineFailure) { nativeFailure.compareAndSet(null, error); throw error }
            }
            runtime.asyncFunction("__native_fetch") { values: Array<Any?> ->
                try {
                    control.check()
                    val headers = Json.parse(arg(values, 3), 32768)
                    requireEngine(headers.isObject && headers.all { it.isTextual }, "INVALID_HEADERS", "Fetch headers must be strings")
                    val map = headers.fields().asSequence().associate { it.key to it.value.asText() }
                    val bodyText = arg(values, 5)
                    requireEngine(bodyText.length <= 2 * Limits.BODY, "LIMIT", "Fetch request body exceeds the budget")
                    val body = when (arg(values, 4)) {
                        "none" -> null
                        "text" -> bodyText.toByteArray(Charsets.UTF_8)
                        "base64" -> Base64.decode(bodyText, Base64.DEFAULT)
                        else -> throw EngineFailure("UNSUPPORTED_HTTP", "Unsupported request body encoding")
                    }
                    session.fetch(arg(values, 0), arg(values, 1), arg(values, 2), map, body, arg(values, 6)).also { control.check() }
                } catch (error: EngineFailure) {
                    // An individually aborted fetch may be handled by the plugin. Request-level
                    // cancellation and policy failures still invalidate the whole invocation.
                    if (error.code != "CANCELLED" || control.reason != null) nativeFailure.compareAndSet(null, error)
                    throw error
                }
            }
            bind("__parse_url") { values ->
                val url = parseUrl(arg(values, 0), arg(values, 1))
                Json.encode(mapOf("href" to url.toString(), "protocol" to "${url.scheme}:",
                    "host" to "${url.host}${if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"}",
                    "hostname" to url.host, "port" to if (url.port == HttpUrl.defaultPort(url.scheme)) "" else url.port.toString(),
                    "pathname" to url.encodedPath, "search" to (url.encodedQuery?.let { "?$it" } ?: ""),
                    "hash" to (url.encodedFragment?.let { "#$it" } ?: ""),
                    "origin" to "${url.scheme}://${url.host}${if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"}",
                    "username" to url.encodedUsername, "password" to url.encodedPassword))
            }
            bind("__url_set") { values ->
                val original = parseUrl(arg(values, 0), "")
                val value = arg(values, 2)
                val builder = original.newBuilder()
                when (arg(values, 1)) {
                    "href" -> parseUrl(value, "").toString()
                    else -> {
                        when (arg(values, 1)) {
                            "protocol" -> builder.scheme(value.removeSuffix(":"))
                            "hostname" -> builder.host(value)
                            "host" -> { val host = parseUrl("${original.scheme}://$value/", ""); builder.host(host.host).port(host.port) }
                            "port" -> builder.port(if (value.isEmpty()) HttpUrl.defaultPort(original.scheme) else value.toInt())
                            "pathname" -> builder.encodedPath(if (value.startsWith('/')) value else "/$value")
                            "search" -> builder.encodedQuery(value.removePrefix("?").ifEmpty { null })
                            "hash" -> builder.encodedFragment(value.removePrefix("#").ifEmpty { null })
                            "username" -> builder.encodedUsername(value)
                            "password" -> builder.encodedPassword(value)
                            else -> throw EngineFailure("UNSUPPORTED_API", "Unsupported URL property")
                        }
                        builder.build().toString()
                    }
                }
            }
            dom.register(runtime, ::guard)
            CryptoBridge.register(runtime, control::check, ::guard)
            runtime.evaluate<Any?>(JsBindings.staticPolyfillCode + "\n" + DomBridge.domParser, "cinetor-host.js")
            control.check()
            // Nuvio's CommonJS wrapper lives exclusively inside QuickJS, never the RN realm.
            runtime.evaluate<Any?>("var module = {exports:{}}; var exports=module.exports;\n(function(){\n$code\n})();", "$id.js")
            control.check()
            val result = runtime.evaluate<String>(if (layout) JsBindings.staticSettingsCallCode else JsBindings.staticCallCode, "cinetor-call.js")
            requireEngine(result.toByteArray(Charsets.UTF_8).size <= Limits.JSON, "LIMIT", "Plugin result exceeds the byte budget")
            nativeFailure.get()?.let { throw it }
            control.check()
            return result
        } catch (error: CancellationException) { throw error } catch (error: Exception) {
            nativeFailure.get()?.let { throw it }
            throw error
        } finally {
            cancelHook.close()
            session.close()
            runtime.close()
            dom.close()
        }
    }

    private fun parseUrl(value: String, base: String): HttpUrl {
        requireEngine(value.length <= 8192 && base.length <= 8192, "LIMIT", "URL exceeds the budget")
        return value.toHttpUrlOrNull() ?: base.toHttpUrlOrNull()?.resolve(value)
            ?: throw EngineFailure("MALFORMED", "Invalid HTTP URL")
    }
}
