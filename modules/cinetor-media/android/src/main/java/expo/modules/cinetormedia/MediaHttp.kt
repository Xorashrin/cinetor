package expo.modules.cinetormedia

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.StatFs
import androidx.media3.common.C
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import okhttp3.Call
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.io.PushbackInputStream
import java.net.InetAddress
import java.net.Proxy
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Only the trusted native BDIX server registers the exact capability it actually issued. */
object TrustedLoopbackSources {
  private val sources = ConcurrentHashMap.newKeySet<String>()

  @JvmStatic fun register(uri: String) {
    val url = uri.toHttpUrlOrNull() ?: throw IllegalArgumentException("Invalid local capability")
    require(url.scheme == "http" && url.host == "127.0.0.1" && url.port in 1024..65535)
    require(url.username.isEmpty() && url.password.isEmpty() && url.fragment == null && url.query == null)
    require(Regex("/media/[A-Za-z0-9_-]{32,128}/video\\.(mp4|mkv|webm)").matches(url.encodedPath))
    sources.add(url.toString())
  }

  @JvmStatic fun revoke(uri: String) { uri.toHttpUrlOrNull()?.let { sources.remove(it.toString()) } }
  @JvmStatic fun allows(uri: String): Boolean = uri.toHttpUrlOrNull()?.let { sources.contains(it.toString()) } ?: false
}

internal class MediaFailure(val code: String, message: String) : IOException(message)

internal object MediaSafety {
  const val RESERVE_BYTES = 128L * 1024 * 1024
  private val forbiddenHeaders = setOf("host", "connection", "content-length", "transfer-encoding", "range", "if-range", "accept-encoding", "proxy-authorization", "proxy-connection")
  private val downloadSlots = Semaphore(2, true)
  private val hostSlots = ConcurrentHashMap<String, Semaphore>()

  fun checkedUrl(value: String): HttpUrl {
    val url = value.toHttpUrlOrNull() ?: throw MediaFailure("unsupported_source", "Unsupported media address")
    if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.fragment != null) {
      throw MediaFailure("unsafe_source", "Credentials in media addresses are not supported")
    }
    if (url.scheme == "http" && TrustedLoopbackSources.allows(url.toString())) return url
    if (url.scheme != "https" || url.host == "localhost" || url.host.endsWith(".localhost") ||
      url.host.endsWith(".local") || url.host.endsWith(".internal") || (!url.host.contains('.') && !url.host.contains(':'))) {
      throw MediaFailure("unsafe_source", "Media requires public HTTPS or a selected local source")
    }
    // Literal addresses are checked before DNS as well. DNS below validates every resolved address.
    if (url.host.contains(':') || Regex("[0-9.]+").matches(url.host)) {
      if (!publicAddress(InetAddress.getByName(url.host))) throw MediaFailure("unsafe_source", "Private network media is not allowed")
    }
    return url
  }

  fun origin(url: HttpUrl) = "${url.scheme}://${url.host}:${url.port}"

  fun credentialOrigin(value: String?, root: HttpUrl): String {
    if (value == null) return origin(root)
    val url = value.toHttpUrlOrNull() ?: throw MediaFailure("unsafe_headers", "Invalid source header origin")
    if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.encodedPath != "/" || url.query != null || url.fragment != null ||
      (url.scheme != "https" && !(root.scheme == "http" && origin(url) == origin(root)))) {
      throw MediaFailure("unsafe_headers", "Invalid source header origin")
    }
    return origin(url)
  }

  fun allowsManifestRefresh(download: Boolean, ranged: Boolean, recognizedManifest: Boolean): Boolean =
    !download && !ranged && recognizedManifest

  fun validateRepresentation(
    download: Boolean,
    ranged: Boolean,
    existing: ResourceIdentity?,
    received: ResourceIdentity,
    refreshableManifest: Boolean = false,
  ) {
    if (download && ranged && received.etag == null) {
      throw MediaFailure("unverifiable_range", "This source has no strong validator for safe offline byte ranges")
    }
    if (!refreshableManifest && existing != null && (existing.destination != received.destination ||
        existing.etag != null && existing.etag != received.etag ||
        existing.total >= 0 && received.total >= 0 && existing.total != received.total ||
        download && ranged && existing.etag == null)) {
      throw MediaFailure("representation_changed", "The media representation changed. Restart from zero.")
    }
  }

  fun headers(input: Map<String, String>): Map<String, String> {
    if (input.size > 32) throw MediaFailure("unsafe_headers", "Too many source headers")
    return input.entries.associate { (name, value) ->
      if (!Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}").matches(name) || value.length > 8192 ||
        value.any { it == '\r' || it == '\n' || it == '\u0000' } || name.lowercase(Locale.US) in forbiddenHeaders || name.startsWith("If-", true)) {
        throw MediaFailure("unsafe_headers", "Unsupported source header")
      }
      name to value
    }
  }

  fun publicAddress(address: InetAddress): Boolean {
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isSiteLocalAddress || address.isMulticastAddress) return false
    val bytes = address.address.map { it.toInt() and 255 }
    if (bytes.size == 4) {
      val a = bytes[0]; val b = bytes[1]
      return !(a == 0 || a == 10 || a == 127 || a >= 224 || a == 169 && b == 254 ||
        a == 172 && b in 16..31 || a == 192 && (b == 168 || b == 0) ||
        a == 100 && b in 64..127 || a == 198 && (b in 18..19 || b == 51 && bytes[2] == 100) ||
        a == 203 && b == 0 && bytes[2] == 113)
    }
    // Only globally routed IPv6 unicast. Reject transition/documentation/special-use prefixes.
    return bytes.size == 16 && (bytes[0] and 0xe0) == 0x20 &&
      !(bytes[0] == 0x20 && bytes[1] == 0x02) &&
      !(bytes[0] == 0x20 && bytes[1] == 0x01 && (bytes[2] == 0 && bytes[3] <= 0x1f || bytes[2] == 0x0d && bytes[3] == 0xb8))
  }

  private val publicDns = object : Dns {
    override fun lookup(hostname: String): List<InetAddress> = Dns.SYSTEM.lookup(hostname).also { addresses ->
      if (addresses.isEmpty() || addresses.any { !publicAddress(it) }) throw MediaFailure("unsafe_source", "Media DNS resolved to a private destination")
    }
  }
  private val baseClient = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
    .proxy(Proxy.NO_PROXY).connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
    .build()
  val publicClient: OkHttpClient = baseClient.newBuilder().dns(publicDns).build()
  val loopbackClient: OkHttpClient = baseClient.newBuilder().dns(object : Dns {
    override fun lookup(hostname: String): List<InetAddress> {
      if (hostname != "127.0.0.1") throw MediaFailure("unsafe_source", "Invalid local destination")
      return listOf(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
    }
  }).build()

  fun acquire(host: String): () -> Unit {
    val perHost = hostSlots.getOrPut(host.lowercase(Locale.US).trimEnd('.')) { Semaphore(1, true) }
    perHost.acquire()
    try { downloadSlots.acquire() } catch (error: InterruptedException) { perHost.release(); throw error }
    return { downloadSlots.release(); perHost.release() }
  }

  fun checkSpace(context: Context, needed: Long = 0) {
    if (StatFs(context.noBackupFilesDir.absolutePath).availableBytes < RESERVE_BYTES + needed.coerceAtLeast(0)) {
      throw MediaFailure("low_storage", "Not enough free storage. Free space and restart the download.")
    }
  }

  fun wifiNetwork(context: Context): Network {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = manager.activeNetwork ?: throw MediaFailure("wifi_required", "Connect to Wi-Fi before downloading")
    val capabilities = manager.getNetworkCapabilities(network)
    if (capabilities == null || !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
      throw MediaFailure("wifi_required", "Connect to Wi-Fi before downloading")
    }
    return network
  }

  fun boundClient(network: Network): OkHttpClient = publicClient.newBuilder().socketFactory(network.socketFactory)
    .connectionPool(okhttp3.ConnectionPool(0, 1, TimeUnit.SECONDS))
    .dns(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> = network.getAllByName(hostname).toList().also { addresses ->
        if (addresses.isEmpty() || addresses.any { !publicAddress(it) }) throw MediaFailure("unsafe_source", "Media DNS resolved to a private destination")
      }
    }).build()

  fun wifiConnected(context: Context): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
    return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
  }
}

internal data class ResourceIdentity(val etag: String?, val total: Long, val destination: String)

/** Attempt-local identities are never reused after pause, restart, or process death. */
internal class SourceSession(
  val context: Context,
  uri: String,
  inputHeaders: Map<String, String> = emptyMap(),
  headerOrigin: String? = null,
  val download: Boolean = false,
  val container: String = "mp4",
  val wifiOnly: () -> Boolean = { false },
) {
  val root = MediaSafety.checkedUrl(uri)
  val rootOrigin = MediaSafety.credentialOrigin(headerOrigin, root)
  val headers = MediaSafety.headers(inputHeaders)
  private val pinnedNetwork = if (download && wifiOnly() && root.scheme == "https") MediaSafety.wifiNetwork(context) else null
  val publicClient = pinnedNetwork?.let { MediaSafety.boundClient(it) } ?: MediaSafety.publicClient
  val stopped = AtomicBoolean(false)
  private val calls = ConcurrentHashMap.newKeySet<Call>()
  val identities = ConcurrentHashMap<String, ResourceIdentity>()
  val manifests = ConcurrentHashMap<String, ByteArray>()
  val encryptionKeys = ConcurrentHashMap.newKeySet<String>()
  private val beganAt = System.currentTimeMillis()
  private var manifestBytes = 0L
  @Volatile var failure: MediaFailure? = null
    private set

  fun reject(error: MediaFailure) {
    failure = error
    calls.forEach { it.cancel() }
  }

  fun check() {
    failure?.let { throw it }
    if (stopped.get() || Thread.currentThread().isInterrupted) throw InterruptedIOException("Media transfer stopped")
    if (download) {
      if (wifiOnly() && !MediaSafety.wifiConnected(context)) throw MediaFailure("wifi_required", "Download paused until Wi-Fi is available. Restart begins from zero.")
      if (System.currentTimeMillis() - beganAt > TimeUnit.HOURS.toMillis(5)) throw MediaFailure("time_limit", "Download time limit reached. Restart when ready.")
    }
    if (root.scheme == "http" && !TrustedLoopbackSources.allows(root.toString())) throw MediaFailure("local_source_expired", "The selected local source has expired")
  }

  fun add(call: Call) { check(); calls.add(call); if (stopped.get()) call.cancel() }
  fun remove(call: Call) { calls.remove(call) }
  fun cancel() { stopped.set(true); calls.forEach { it.cancel() } }

  @Synchronized fun freezeManifest(uri: String, bytes: ByteArray) {
    if (!manifests.containsKey(uri)) {
      manifestBytes += bytes.size
      if (manifestBytes > 16 * 1024 * 1024 || manifests.size >= 128) throw MediaFailure("manifest_limit", "The offline manifest is too large")
      manifests[uri] = bytes
    }
  }
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class SafeHttpDataSource(private val session: SourceSession) : BaseDataSource(true) {
  class Factory(private val session: SourceSession) : DataSource.Factory {
    override fun createDataSource(): DataSource = SafeHttpDataSource(session)
  }

  private var response: Response? = null
  private var input: InputStream? = null
  private var call: Call? = null
  private var releaseSlot: (() -> Unit)? = null
  private var opened = false
  private var sourceUri: android.net.Uri? = null
  private var remaining = C.LENGTH_UNSET.toLong()
  private var received = 0L
  private var expected = C.LENGTH_UNSET.toLong()
  private var responseHeaders: Map<String, List<String>> = emptyMap()

  override fun open(dataSpec: DataSpec): Long {
    close()
    transferInitializing(dataSpec)
    session.check()
    if (dataSpec.httpMethod != DataSpec.HTTP_METHOD_GET || dataSpec.httpBody != null) throw MediaFailure("unsafe_method", "Only read-only media requests are supported")
    val original = MediaSafety.checkedUrl(dataSpec.uri.toString())
    // A local capability is a single file, not a route to other local or remote resources.
    if (session.root.scheme == "http" && original != session.root) throw MediaFailure("unsafe_source", "A local source cannot redirect or load other resources")
    sourceUri = dataSpec.uri
    try {
      val frozen = session.manifests[original.toString()]
      if (frozen != null) {
        val start = dataSpec.position
        if (start > frozen.size) throw MediaFailure("invalid_range", "Offline manifest range is invalid")
        val available = frozen.size.toLong() - start
        remaining = if (dataSpec.length == C.LENGTH_UNSET.toLong()) available else minOf(dataSpec.length, available)
        sourceUri = android.net.Uri.parse(session.identities[original.toString()]?.destination ?: original.toString())
        input = ByteArrayInputStream(frozen, start.toInt(), remaining.toInt())
        expected = remaining
        opened = true; transferStarted(dataSpec)
        return remaining
      }
      var current = original
      var redirects = 0
      val existing = session.identities[original.toString()]
      val ranged = dataSpec.position != 0L || dataSpec.length != C.LENGTH_UNSET.toLong()
      while (true) {
        session.check()
        MediaSafety.checkedUrl(current.toString())
        if (session.root.scheme == "http" && current != session.root) throw MediaFailure("unsafe_redirect", "Local media redirects are not supported")
        if (current.scheme == "http" && current != session.root) throw MediaFailure("unsafe_redirect", "Redirect to local media is not allowed")
        if (session.download) releaseSlot = MediaSafety.acquire(current.host)
        session.check()
        val builder = Request.Builder().url(current).get().header("Accept-Encoding", "identity")
        // Every provider header, including Referer and Origin, is confined to its original origin.
        if (MediaSafety.origin(current) == session.rootOrigin) session.headers.forEach { (name, value) -> builder.header(name, value) }
        if (ranged) {
          val end = if (dataSpec.length == C.LENGTH_UNSET.toLong()) "" else {
            if (dataSpec.position > Long.MAX_VALUE - dataSpec.length) throw MediaFailure("invalid_range", "Media range overflow")
            (dataSpec.position + dataSpec.length - 1).toString()
          }
          builder.header("Range", "bytes=${dataSpec.position}-$end")
          existing?.etag?.let { builder.header("If-Range", it) }
        }
        val client = if (current.scheme == "http") MediaSafety.loopbackClient else session.publicClient
        val requestCall = client.newCall(builder.build())
        call = requestCall; session.add(requestCall)
        val next = requestCall.execute()
        if (next.code in listOf(301, 302, 303, 307, 308)) {
          val location = next.header("Location")
          next.close(); session.remove(requestCall); call = null
          releaseSlot?.invoke(); releaseSlot = null
          if (++redirects > 5 || location == null) throw MediaFailure("unsafe_redirect", "Media redirected too many times")
          current = MediaSafety.checkedUrl(current.resolve(location)?.toString() ?: "")
          continue
        }
        response = next
        break
      }
      val result = response!!
      sourceUri = android.net.Uri.parse(current.toString())
      responseHeaders = result.headers.toMultimap()
      val contentEncoding = result.header("Content-Encoding")
      if (contentEncoding != null && !contentEncoding.equals("identity", true)) throw MediaFailure("invalid_encoding", "Encoded media transfer cannot be verified")
      val etag = result.header("ETag")?.takeIf { it.startsWith('"') && it.endsWith('"') && !it.startsWith("W/") }
      val lengthHeader = result.header("Content-Length")
      if (lengthHeader != null && result.header("Transfer-Encoding") != null) throw MediaFailure("invalid_length", "Ambiguous media response length")
      val length = lengthHeader?.toLongOrNull() ?: C.LENGTH_UNSET.toLong()
      if (lengthHeader != null && length < 0) throw MediaFailure("invalid_length", "Invalid media length")
      var total = length
      if (result.code == 416) {
        val total416 = Regex("bytes \\*/([0-9]+)").matchEntire(result.header("Content-Range") ?: "")?.groupValues?.get(1)?.toLongOrNull()
        if (ranged && total416 != null && existing != null && total416 == existing.total && dataSpec.position == total416) {
          MediaSafety.validateRepresentation(session.download, true, existing, ResourceIdentity(etag, total416, current.toString()))
          remaining = 0; expected = 0; input = ByteArrayInputStream(ByteArray(0))
          opened = true; transferStarted(dataSpec)
          return 0
        }
        throw MediaFailure("invalid_range", "The server rejected this media range. Restart from zero.")
      }
      if (ranged) {
        if (result.code != 206) throw MediaFailure("range_ignored", "The server ignored a media range. Restart from zero.")
        val match = Regex("bytes ([0-9]+)-([0-9]+)/([0-9]+)").matchEntire(result.header("Content-Range") ?: "")
          ?: throw MediaFailure("invalid_range", "Invalid media range response")
        val start = match.groupValues[1].toLongOrNull() ?: -1
        val end = match.groupValues[2].toLongOrNull() ?: -1
        total = match.groupValues[3].toLongOrNull() ?: -1
        if (start != dataSpec.position || end < start || total <= end ||
          length != C.LENGTH_UNSET.toLong() && length != end - start + 1 ||
          dataSpec.length != C.LENGTH_UNSET.toLong() && end != minOf(start + dataSpec.length - 1, total - 1)) {
          throw MediaFailure("invalid_range", "The server returned the wrong media range")
        }
        remaining = end - start + 1
      } else {
        if (result.code != 200) throw MediaFailure("http_error", "The media server returned HTTP ${result.code}")
        remaining = length
      }
      val contentType = result.header("Content-Type")?.substringBefore(';')?.lowercase(Locale.US) ?: ""
      val refreshableManifest = MediaSafety.allowsManifestRefresh(session.download, ranged,
        original.encodedPath.endsWith(".m3u8", true) || original.encodedPath.endsWith(".mpd", true) ||
          contentType.contains("mpegurl") || contentType.contains("dash+xml") ||
          original == session.root && session.container in setOf("hls", "dash"))
      val receivedIdentity = ResourceIdentity(etag, total, current.toString())
      MediaSafety.validateRepresentation(session.download, ranged, existing, receivedIdentity, refreshableManifest)
      if (session.identities.size >= 100_000 && !session.identities.containsKey(original.toString())) throw MediaFailure("manifest_limit", "This presentation contains too many resources")
      session.identities[original.toString()] = receivedIdentity
      if (contentType.contains("text/html") || contentType.contains("application/json")) throw MediaFailure("not_media", "The server returned a page instead of media")
      input = result.body?.byteStream() ?: throw MediaFailure("empty_media", "The server returned no media")
      expected = remaining
      received = 0
      if (session.download) MediaSafety.checkSpace(session.context, if (remaining > 0) minOf(remaining, 16L * 1024 * 1024) else 0)
      // Download manifests are frozen after validation, so helper preparation and packaging see
      // exactly the same finite presentation even if a server changes an unversioned URL.
      var looksLikeManifest = false
      if (session.download && dataSpec.position == 0L && session.container in setOf("hls", "dash")) {
        val probe = PushbackInputStream(input, 256)
        val prefix = ByteArray(256)
        var count = 0
        while (count < prefix.size) {
          session.check()
          val read = probe.read(prefix, count, prefix.size - count)
          if (read < 0) break
          count += read
        }
        if (count > 0) {
          probe.unread(prefix, 0, count)
          val text = prefix.copyOf(count).toString(Charsets.UTF_8).removePrefix("﻿").trimStart()
          if (text.isEmpty()) throw MediaFailure("invalid_manifest", "An adaptive media resource starts with excessive whitespace")
          looksLikeManifest = text.startsWith("#EXTM3U") || text.startsWith("<?xml") || text.startsWith("<MPD")
        }
        input = probe
      }
      val manifest = session.download && dataSpec.position == 0L &&
        (looksLikeManifest || original.encodedPath.endsWith(".m3u8", true) || original.encodedPath.endsWith(".mpd", true) ||
          contentType.contains("mpegurl") || contentType.contains("dash+xml") ||
          original == session.root && session.container in setOf("hls", "dash"))
      if (manifest) {
        val bytes = readManifest(input!!)
        ManifestValidation.validate(bytes, session.container)
        session.freezeManifest(original.toString(), bytes)
        val playlist = bytes.toString(Charsets.UTF_8)
        if (playlist.removePrefix("﻿").trimStart().startsWith("#EXTM3U")) {
          ManifestValidation.hlsEncryptionKeyUris(playlist).forEach { key ->
            val resolved = current.resolve(key) ?: throw MediaFailure("invalid_key", "Invalid offline encryption key address")
            MediaSafety.checkedUrl(resolved.toString())
            if (session.encryptionKeys.size >= 100_000) throw MediaFailure("manifest_limit", "Too many offline encryption keys")
            session.encryptionKeys.add(resolved.toString())
          }
        }
        if (current != original) {
          session.freezeManifest(current.toString(), bytes)
          session.identities[current.toString()] = ResourceIdentity(etag, total, current.toString())
        }
        input?.close(); response?.close(); response = null
        call?.let { session.remove(it) }; call = null
        input = ByteArrayInputStream(bytes)
        remaining = bytes.size.toLong(); expected = remaining
      }
      if (session.download && original.toString() in session.encryptionKeys) {
        if (expected >= 0) ManifestValidation.validateAes128KeyLength(expected)
        val key = ByteArray(17)
        var size = 0
        while (size < key.size) {
          session.check()
          val count = input!!.read(key, size, key.size - size)
          if (count < 0) break
          size += count
        }
        ManifestValidation.validateAes128KeyLength(size.toLong())
        input?.close(); response?.close(); response = null
        call?.let { session.remove(it) }; call = null
        input = ByteArrayInputStream(key.copyOf(16)); remaining = 16; expected = 16
      }
      opened = true; transferStarted(dataSpec)
      return remaining
    } catch (error: Exception) {
      close()
      if (error is InterruptedException) { Thread.currentThread().interrupt(); throw InterruptedIOException("Media transfer stopped") }
      if (error is MediaFailure) session.reject(error)
      if (error is IOException) throw error
      throw MediaFailure("transfer_failed", "Media transfer could not start")
    }
  }

  private fun readManifest(stream: InputStream): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16384)
    var count: Int
    while (true) {
      session.check()
      count = stream.read(buffer)
      if (count < 0) break
      if (output.size() + count > 2 * 1024 * 1024) throw MediaFailure("manifest_limit", "The offline manifest is too large")
      output.write(buffer, 0, count)
    }
    if (expected >= 0 && output.size().toLong() != expected) throw EOFException("Incomplete media manifest")
    return output.toByteArray()
  }

  override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
    session.check()
    if (length == 0) return 0
    if (remaining == 0L) return C.RESULT_END_OF_INPUT
    if (session.download && received / (1024 * 1024) != (received + length) / (1024 * 1024)) MediaSafety.checkSpace(session.context)
    val count = input?.read(buffer, offset, if (remaining < 0) length else minOf(length.toLong(), remaining).toInt()) ?: -1
    if (count == -1) {
      if (remaining > 0) throw EOFException("Incomplete media response")
      return C.RESULT_END_OF_INPUT
    }
    if (remaining > 0) remaining -= count
    received += count
    bytesTransferred(count)
    return count
  }

  override fun getUri(): android.net.Uri? = sourceUri
  override fun getResponseHeaders(): Map<String, List<String>> = responseHeaders
  override fun close() {
    try { input?.close() } catch (_: IOException) { }
    input = null
    response?.close(); response = null
    call?.let { it.cancel(); session.remove(it) }; call = null
    releaseSlot?.invoke(); releaseSlot = null
    if (opened) { opened = false; transferEnded() }
    sourceUri = null; responseHeaders = emptyMap(); remaining = -1; received = 0; expected = -1
  }
}
