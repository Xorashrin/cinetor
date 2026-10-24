package expo.modules.cinetorbdix

import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.InetAddress
import java.net.URI
import java.net.URLEncoder
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

internal class BdixFailure(val kind: String, val reason: String) : IOException(reason)
internal fun fail(kind: String, reason: String): Nothing = throw BdixFailure(kind, reason)

internal object Limits {
  const val CONNECT_MS = 1500
  const val BATCH_MS = 30000L
  const val READ_MS = 5000
  const val PAGE_BYTES = 524288
  const val ITEMS = 1000
  const val FILE_BYTES = 2147483648L
  const val MAX_SPOOLS = 2
  const val SESSION_MS = 4 * 60 * 60 * 1000L
}

internal data class ApprovedEndpoint(
  val id: String, val root: URI, val enabled: Boolean, val anonymous: Boolean,
  val allowPlainFtp: Boolean, val allowCleartextHttp: Boolean, val files: Set<String>
) {
  fun requireEnabled() {
    if (!enabled) fail("permission", "endpoint-not-approved")
    if (root.scheme == "ftp" && !allowPlainFtp) fail("permission", "plain-ftp-consent-required")
    if (root.scheme == "http" && !allowCleartextHttp) fail("permission", "cleartext-http-consent-required")
    if (root.scheme in setOf("ftp", "ftps") && !anonymous) fail("authentication", "anonymous-consent-required")
  }
  fun contain(value: String, base: URI = root, pagination: Boolean = false): URI = PathPolicy.contain(root, value, base, pagination)
  fun pinned(value: String): URI {
    requireEnabled()
    val uri = contain(value)
    if (uri.toASCIIString() !in files) fail("permission", "canonical-mapping-required")
    return uri
  }
}

internal object PathPolicy {
  private val control = Regex("[\\x00-\\x1f\\x7f-\\x9f]")
  private val movie = Regex("tmdb:movie:([1-9][0-9]*)")
  private val episode = Regex("tmdb:tv:([1-9][0-9]*):s(0|[1-9][0-9]*)e([1-9][0-9]*)")
  private const val MAX_JS_INTEGER = 9007199254740991L

  fun contentKey(value: String): String {
    val match = movie.matchEntire(value) ?: episode.matchEntire(value) ?: fail("configuration", "canonical-content-required")
    if (match.groupValues.drop(1).any { (it.toLongOrNull() ?: Long.MAX_VALUE) > MAX_JS_INTEGER }) fail("configuration", "canonical-content-required")
    return value
  }
  fun decode(segment: String): String {
    val bytes = ByteArrayOutputStream()
    var offset = 0
    while (offset < segment.length) {
      if (segment[offset] == '%') {
        if (offset + 2 >= segment.length) fail("scope", "invalid-encoding")
        val byte = segment.substring(offset + 1, offset + 3).toIntOrNull(16) ?: fail("scope", "invalid-encoding")
        bytes.write(byte); offset += 3
      } else {
        val point = segment.codePointAt(offset)
        if (point in 0xd800..0xdfff) fail("scope", "invalid-encoding")
        bytes.write(String(Character.toChars(point)).toByteArray(Charsets.UTF_8)); offset += Character.charCount(point)
      }
    }
    val decoded = try { Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString() }
    catch (_: Exception) { fail("scope", "invalid-encoding") }
    if (control.containsMatchIn(decoded) || decoded.any { it in "\\/%?#" }) fail("scope", "encoded-path-escape")
    if (segment.contains('%') && decoded in setOf(".", "..")) fail("scope", "encoded-path-escape")
    return decoded
  }
  fun encode(segment: String): String = URLEncoder.encode(segment, "UTF-8").replace("+", "%20").replace("*", "%2A").replace("%7E", "~")
  private fun inspect(value: String) {
    if (value.isEmpty() || value.length > 4096 || value != value.trim() || control.containsMatchIn(value) || value.contains('\\')) fail("scope", "invalid-url")
    value.split('/', '?', '#').forEach { decode(it) }
    val authority = Regex("^(?:[A-Za-z][A-Za-z0-9+.-]*:)?//([^/?#]*)").find(value)?.groupValues?.get(1)
    if (authority?.contains('%') == true) fail("scope", "ambiguous-host")
  }
  private fun port(uri: URI): Int = if (uri.port != -1) uri.port else when (uri.scheme.lowercase()) { "https" -> 443; "http" -> 80; else -> 21 }
  private fun sameOrigin(a: URI, b: URI): Boolean = a.scheme.equals(b.scheme, true) && a.host.equals(b.host, true) && port(a) == port(b)
  fun canonical(value: String, base: URI? = null): URI {
    inspect(value)
    val reference = if (base != null && value.startsWith('?')) base.toASCIIString().substringBefore('?') + value else value
    val requested = try { base?.resolve(URI(reference)) ?: URI(reference) } catch (_: Exception) { fail("scope", "invalid-url") }
    if (requested.rawPath?.contains("//") == true) fail("scope", "ambiguous-path")
    val uri = requested.normalize()
    if (uri.scheme?.lowercase() !in setOf("http", "https", "ftp", "ftps") || uri.host.isNullOrEmpty() || uri.rawUserInfo != null || uri.rawFragment != null || uri.port > 65535 || uri.port == 0)
      fail("scope", "unapproved-url")
    val rawPath = uri.rawPath.ifEmpty { "/" }
    if (rawPath.contains("//")) fail("scope", "ambiguous-path")
    val path = rawPath.split('/').joinToString("/") { segment ->
      val decoded = decode(segment)
      if (decoded in setOf(".", "..")) fail("scope", "invalid-path")
      encode(decoded)
    }
    val host = uri.host.lowercase()
    val defaultPort = when (uri.scheme.lowercase()) { "https" -> 443; "http" -> 80; else -> 21 }
    val authority = (if (host.contains(':') && !host.startsWith('[')) "[$host]" else host) + if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
    return URI("${uri.scheme.lowercase()}://$authority$path${uri.rawQuery?.let { "?$it" } ?: ""}")
  }
  fun contain(root: URI, value: String, base: URI = root, pagination: Boolean = false): URI {
    val result = canonical(value, base)
    if (!root.rawPath.endsWith('/') || root.rawQuery != null) fail("scope", "directory-root-required")
    if (!sameOrigin(root, base) || !base.rawPath.startsWith(root.rawPath) || !sameOrigin(root, result) || !result.rawPath.startsWith(root.rawPath)) fail("scope", "endpoint-escape")
    result.rawQuery?.let { query ->
      val parts = query.split('&')
      if (!pagination || result.scheme !in setOf("http", "https") || query.length > 512 || parts.size > 3) fail("scope", "query-not-approved")
      val keys = parts.map { decode(it.substringBefore('=')) }
      if (keys.toSet().size != keys.size || keys.any { it !in setOf("page", "offset", "cursor") }) fail("scope", "query-not-approved")
    }
    return result
  }
  fun parseEndpoints(json: String): Map<String, ApprovedEndpoint> {
    if (json.toByteArray().size > 1048576) fail("size", "configuration-limit")
    val rows = try { JSONArray(json) } catch (_: Exception) { fail("configuration", "invalid-endpoints") }
    if (rows.length() > 16) fail("configuration", "endpoint-limit")
    val result = linkedMapOf<String, ApprovedEndpoint>()
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      val id = row.getString("id")
      if (!Regex("[A-Za-z0-9_-]{1,64}").matches(id) || result.containsKey(id) || row.getString("network") != "wifi") fail("configuration", "invalid-endpoint")
      if (row.has("credentialRef")) fail("unsupported", "authentication-unsupported")
      if (row.get("enabled") !is Boolean || row.get("allowPlainFtp") !is Boolean) fail("configuration", "invalid-consent")
      val root = canonical(row.getString("url"))
      if (!root.rawPath.endsWith('/') || root.rawQuery != null) fail("configuration", "directory-root-required")
      val mappings = row.getJSONArray("mappings")
      if (mappings.length() > Limits.ITEMS) fail("configuration", "mapping-limit")
      val keys = mutableMapOf<String, String>(); val paths = mutableMapOf<String, String>()
      for (j in 0 until mappings.length()) {
        val mapping = mappings.getJSONObject(j)
        val key = contentKey(mapping.getString("contentKey"))
        val path = contain(root, mapping.getString("path")).toASCIIString()
        if (container(URI(path)) == null) fail("unsupported", "progressive-media-required")
        if ((keys.containsKey(key) && keys[key] != path) || (paths.containsKey(path) && paths[path] != key)) fail("configuration", "ambiguous-mapping")
        keys[key] = path; paths[path] = key
      }
      if (row.has("anonymous") && row.get("anonymous") !is Boolean || row.has("allowCleartextHttp") && row.get("allowCleartextHttp") !is Boolean) fail("configuration", "invalid-consent")
      val endpoint = ApprovedEndpoint(id, root, row.getBoolean("enabled"), row.optBoolean("anonymous", false), row.getBoolean("allowPlainFtp"), row.optBoolean("allowCleartextHttp", false), paths.keys.toSet())
      if (endpoint.enabled) endpoint.requireEnabled()
      result[id] = endpoint
    }
    return result
  }
  fun container(uri: URI): String? = when (uri.path.substringAfterLast('.').lowercase()) { "mp4", "m4v", "mov" -> "mp4"; "mkv" -> "mkv"; "webm" -> "webm"; else -> null }
  fun mime(container: String): String = when (container) { "mp4" -> "video/mp4"; "webm" -> "video/webm"; else -> "video/x-matroska" }
  fun sniff(bytes: ByteArray, container: String): Boolean = if (container == "mp4") bytes.size >= 16 && String(bytes, 4, 4, Charsets.US_ASCII) == "ftyp"
    else bytes.size >= 16 && bytes.take(4).map { it.toInt() and 255 } == listOf(0x1a, 0x45, 0xdf, 0xa3)
}

/** Parse and validate before opening any data socket, including a PASV fallback. */
internal object PassivePolicy {
  fun epsv(reply: String): Int {
    val payload = reply.substringAfter('(', "").substringBefore(')', "")
    if (payload.length < 5 || payload[0] != payload[1] || payload[0] != payload[2] || payload[0] != payload.last()) fail("malformed", "invalid-epsv")
    return port(payload.substring(3, payload.length - 1))
  }
  fun pasv(reply: String, controlPeer: InetAddress): Int {
    val fields = reply.substringAfter('(', "").substringBefore(')', "").split(',')
    if (fields.size != 6 || fields.any { !Regex("[0-9]{1,3}").matches(it) }) fail("malformed", "invalid-pasv")
    val values = fields.map { it.toInt() }
    if (values.any { it !in 0..255 }) fail("malformed", "invalid-pasv")
    val address = values.take(4).map { it.toByte() }.toByteArray()
    if (!address.contentEquals(controlPeer.address)) fail("scope", "unrelated-pasv-host")
    return port((values[4] * 256 + values[5]).toString())
  }
  private fun port(value: String): Int {
    if (!Regex("[0-9]{1,5}").matches(value)) fail("malformed", "invalid-data-port")
    return value.toInt().takeIf { it in 1..65535 } ?: fail("malformed", "invalid-data-port")
  }
}

internal data class ByteRange(val start: Long, val end: Long) { val length: Long get() = end - start + 1 }
internal object RangePolicy {
  fun parse(header: String?, size: Long): ByteRange {
    if (size <= 0) fail("size", "invalid-file-size")
    if (header == null) return ByteRange(0, size - 1)
    val match = Regex("bytes=([0-9]*)-([0-9]*)").matchEntire(header) ?: fail("scope", "invalid-range")
    val left = match.groupValues[1]; val right = match.groupValues[2]
    if (left.isEmpty()) {
      val suffix = right.toLongOrNull()?.takeIf { it > 0 } ?: fail("scope", "invalid-range")
      return ByteRange((size - suffix).coerceAtLeast(0), size - 1)
    }
    val start = left.toLongOrNull()?.takeIf { it >= 0 && it < size } ?: fail("scope", "unsatisfiable-range")
    val end = if (right.isEmpty()) size - 1 else right.toLongOrNull()?.coerceAtMost(size - 1) ?: fail("scope", "invalid-range")
    if (end < start) fail("scope", "unsatisfiable-range")
    return ByteRange(start, end)
  }
}
