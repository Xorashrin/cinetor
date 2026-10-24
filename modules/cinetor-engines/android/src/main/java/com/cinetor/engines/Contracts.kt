// SPDX-License-Identifier: GPL-3.0-or-later
package com.cinetor.engines

import com.fasterxml.jackson.core.JsonFactory
import com.fasterxml.jackson.core.JsonParser
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import java.io.InputStream
import java.security.MessageDigest

internal object Limits {
    const val CODE = 1024 * 1024
    const val JSON = 1024 * 1024
    const val BODY = 1024 * 1024
    const val ARCHIVE = 16 * 1024 * 1024
    const val UNPACKED = 32 * 1024 * 1024
    const val TIMEOUT = 30_000L
    const val MAX_SOURCES = 30
    const val MAX_ITEMS = 200
    const val MAX_EPISODES = 2000
}

internal class EngineFailure(val code: String, override val message: String) : Exception(message)

internal fun requireEngine(condition: Boolean, code: String, message: String) {
    if (!condition) throw EngineFailure(code, message)
}

internal object Json {
    val mapper = ObjectMapper(JsonFactory().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION))
        .enable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS)

    fun parse(text: String, limit: Int = Limits.JSON): JsonNode {
        requireEngine(text.toByteArray(Charsets.UTF_8).size <= limit, "LIMIT", "JSON exceeds the byte budget")
        // Jackson 2.13 predates StreamReadConstraints. Bound structural depth before parsing.
        var depth = 0
        var quoted = false
        var escaped = false
        text.forEach { char ->
            if (quoted) {
                if (escaped) escaped = false
                else if (char == '\\') escaped = true
                else if (char == '"') quoted = false
            } else when (char) {
                '"' -> quoted = true
                '{', '[' -> { depth++; requireEngine(depth <= 32, "LIMIT", "JSON nesting exceeds the budget") }
                '}', ']' -> depth--
            }
        }
        return try {
            mapper.readTree(text) ?: throw EngineFailure("MALFORMED", "Missing JSON value")
        } catch (error: EngineFailure) {
            throw error
        } catch (_: Exception) {
            throw EngineFailure("MALFORMED", "Invalid JSON or duplicate JSON keys")
        }
    }

    fun encode(value: Any?): String = mapper.writeValueAsString(value)

    @Suppress("UNCHECKED_CAST")
    fun map(node: JsonNode): Map<String, Any?> = mapper.convertValue(node, Map::class.java) as Map<String, Any?>
}

internal fun InputStream.readBounded(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream(minOf(limit, 8192))
    val buffer = ByteArray(8192)
    while (true) {
        val count = read(buffer)
        if (count == -1) break
        requireEngine(out.size() + count <= limit, "LIMIT", "Input exceeds the byte budget")
        out.write(buffer, 0, count)
    }
    return out.toByteArray()
}

internal fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }

internal fun Map<String, Any?>.text(key: String, limit: Int = 4096): String {
    val value = this[key] as? String ?: throw EngineFailure("INVALID_REQUEST", "Missing string field $key")
    requireEngine(value.isNotBlank() && value.length <= limit, "INVALID_REQUEST", "Invalid field $key")
    return value
}

internal fun Map<String, Any?>.optionalInt(key: String): Int? {
    val raw = this[key] ?: return null
    requireEngine(raw is Number, "INVALID_REQUEST", "Invalid number field $key")
    val value = (raw as Number).toDouble()
    requireEngine(value.isFinite() && value % 1.0 == 0.0 && value in 0.0..100000.0,
        "INVALID_REQUEST", "Invalid number field $key")
    return value.toInt()
}

internal fun JsonNode.string(key: String): String? = get(key)?.takeIf { it.isTextual }?.asText()

internal fun errorResult(error: Throwable, request: Map<String, Any?> = emptyMap()): Map<String, Any?> {
    val failure = generateSequence(error) { it.cause }.take(8).filterIsInstance<EngineFailure>().firstOrNull()
    val code = when {
        failure != null -> failure.code
        error is TimeoutCancellationException -> "TIMEOUT"
        error is CancellationException -> "CANCELLED"
        error is com.dokar.quickjs.QuickJsInterruptedException -> "TIMEOUT"
        error is LinkageError -> "UNSUPPORTED_ABI"
        error is NotImplementedError || error is UnsupportedOperationException -> "UNSUPPORTED_API"
        else -> "ENGINE_ERROR"
    }
    val status = when {
        code == "TIMEOUT" -> "timeout"
        code == "CANCELLED" -> "cancelled"
        code == "AUTH" -> "auth"
        code.startsWith("UNSUPPORTED") || code == "NOT_REVIEWED" -> "unsupported"
        else -> "error"
    }
    // Plugin errors may contain credentials, request bodies, or signed URLs. Do not bridge them.
    val message = failure?.message ?: when (error) {
        is EngineFailure -> error.message
        is TimeoutCancellationException, is com.dokar.quickjs.QuickJsInterruptedException -> "Engine deadline exceeded"
        is CancellationException -> "Request cancelled"
        is LinkageError -> "Plugin requires an unsupported native API or binary version"
        is NotImplementedError, is UnsupportedOperationException -> "Provider does not implement this API"
        else -> "Engine execution failed; no playable source was published"
    }
    return mapOf("requestId" to request["requestId"], "contentKey" to request["contentKey"],
        "status" to status, "error" to mapOf("code" to code, "message" to message))
}

internal fun result(request: Map<String, Any?>, key: String, value: Any?, empty: Boolean = false): Map<String, Any?> =
    mapOf("requestId" to request["requestId"], "contentKey" to request["contentKey"],
        "status" to if (empty) "empty" else "ok", key to value)
