package expo.modules.cinetorbdix

import org.apache.commons.net.ftp.FTP
import org.apache.commons.net.ftp.FTPClient
import org.apache.commons.net.ftp.FTPReply
import org.apache.commons.net.ftp.parser.DefaultFTPFileEntryParserFactory
import org.apache.commons.net.ftp.parser.MLSxEntryParser
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.Closeable
import java.io.InputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Commons Net's protocol/parser implementation with explicit, network-bound socket ownership.
 * FTPS is RFC 4217 explicit AUTH TLS on the configured port (default 21), never downgraded.
 * Both TLS channels use platform trust and HTTPS endpoint identification for the original host.
 * The stock passive socket implementation is not used: advertised hosts are checked pre-connect.
 */
internal class BdixFtpClient(
  private val endpoint: ApprovedEndpoint,
  private val operation: BdixOperation,
  private val socketFactory: () -> Socket,
  private val resolveHost: (String) -> java.net.InetAddress,
  private val tlsContext: javax.net.ssl.SSLContext? = null
) : FTPClient(), Closeable {
  constructor(endpoint: ApprovedEndpoint, scope: NetworkScope, operation: BdixOperation) : this(
    endpoint, operation, { BoundSocketFactory(scope, operation).createSocket() }, { NetworkIo.resolve(it, scope, operation) }
  )
  private fun newSocket(): Socket = operation.track(socketFactory()).apply { soTimeout = Limits.READ_MS }
  private fun protect(socket: Socket): Socket = tlsContext?.let { Wire.tls(socket, endpoint.root.host, operation, it) } ?: Wire.tls(socket, endpoint.root.host, operation)
  private var rawControl: Socket? = null
  private var protectedControl: Socket? = null
  private var data: Socket? = null
  private val secure = endpoint.root.scheme == "ftps"
  private var utf8 = false
  var listedItems: Int = 0; private set

  fun open() {
    endpoint.requireEnabled(); operation.check()
    operation.track(this)
    val deadline = NetworkIo.deadlines.schedule({ operation.cancel("timeout") }, Limits.CONNECT_MS.toLong(), TimeUnit.MILLISECONDS)
    try {
      val peer = resolveHost(endpoint.root.host)
      val socket = newSocket()
      rawControl = socket
      socket.connect(InetSocketAddress(peer, if (endpoint.root.port == -1) 21 else endpoint.root.port), Limits.CONNECT_MS)
      _hostname_ = endpoint.root.host.removeSurrounding("[", "]")
      installControl(socket)
      if (!FTPReply.isPositiveCompletion(getReply())) fail("network", "ftp-greeting-rejected")
      if (secure) {
        if (sendCommand("AUTH", "TLS") != 234) fail("permission", "ftps-required")
        val tls = protect(socket)
        protectedControl = tls
        installControl(tls)
      }
      operation.check()
    } finally { deadline.cancel(false) }
    if (!login("anonymous", "")) fail("authentication", "anonymous-access-unavailable")
    if (secure) {
      if (sendCommand("PBSZ", "0") != 200 || sendCommand("PROT", "P") != 200) fail("permission", "protected-data-required")
    }
    utf8 = sendCommand("OPTS", "UTF8 ON") in setOf(200, 202)
    if (!setFileType(FTP.BINARY_FILE_TYPE)) fail("unsupported", "binary-mode-unavailable")
  }
  private fun installControl(socket: Socket) {
    // One new FTPClient per connection; its parser/default state is initialized by the constructor.
    _socket_ = socket
    _input_ = socket.getInputStream(); _output_ = socket.getOutputStream()
    controlEncoding = "UTF-8"
    _controlInput_ = BufferedReader(ControlReader(InputStreamReader(_input_, Charsets.UTF_8), operation), 4096)
    _controlOutput_ = BufferedWriter(OutputStreamWriter(_output_, Charsets.UTF_8), 4096)
  }
  private fun path(uri: URI): String {
    val value = endpoint.contain(uri.toASCIIString(), pagination = false).path
    if (!utf8 && value.any { it.code > 127 }) fail("unsupported", "ftp-utf8-unavailable")
    if (value.any { it == '\r' || it == '\n' || it == '\u0000' }) fail("scope", "invalid-ftp-path")
    return value
  }
  private fun cwd(uri: URI) {
    val requested = path(uri).trimEnd('/').ifEmpty { "/" }
    if (!changeWorkingDirectory(requested)) fail("permission", "ftp-directory-unavailable")
    val actual = printWorkingDirectory() ?: fail("unsupported", "ftp-pwd-required")
    // A server-reported canonical path must not escape through an alias or symlink.
    if (actual.trimEnd('/').ifEmpty { "/" } != requested) fail("scope", "ftp-directory-alias")
  }
  private fun openData(command: String, argument: String? = null, offset: Long = 0): InputStream {
    operation.check()
    var port: Int
    val epsvCode = sendCommand("EPSV")
    if (epsvCode == 229) port = PassivePolicy.epsv(replyStrings.last())
    else {
      if (epsvCode !in setOf(500, 501, 502, 504, 522) || remoteAddress.address.size != 4) fail("unsupported", "epsv-unavailable")
      if (sendCommand("PASV") != 227) fail("unsupported", "pasv-unavailable")
      port = PassivePolicy.pasv(replyStrings.last(), remoteAddress)
    }
    val socket = newSocket()
    data = socket
    socket.connect(InetSocketAddress(remoteAddress, port), Limits.CONNECT_MS)
    if (socket.inetAddress != remoteAddress) fail("scope", "unrelated-data-peer")
    if (offset > 0 && sendCommand("REST", offset.toString()) != 350) fail("unsupported", "rest-unsupported")
    val code = if (argument == null) sendCommand(command) else sendCommand(command, argument)
    if (!FTPReply.isPositivePreliminary(code)) {
      runCatching { socket.close() }; data = null
      if (code in setOf(500, 501, 502, 504)) fail("unsupported", "ftp-command-unsupported")
      fail(if (code in setOf(530, 550, 553)) "permission" else "network", "ftp-data-command-rejected")
    }
    val result = if (secure) protect(socket) else socket
    data = result
    operation.check()
    return result.getInputStream()
  }
  private fun finishData() {
    runCatching { data?.close() }; data = null
    operation.check()
    if (!completePendingCommand()) fail("network", "ftp-transfer-incomplete")
  }
  fun list(uri: URI, maxBytes: Int, maxItems: Int): Pair<List<Map<String, Any>>, Int> {
    cwd(uri)
    var parser: org.apache.commons.net.ftp.FTPFileEntryParser = MLSxEntryParser.getInstance()
    val input = try { openData("MLSD") } catch (error: BdixFailure) {
      if (error.kind != "unsupported" || error.reason != "ftp-command-unsupported") throw error
      // SYST must complete before LIST starts; never interleave replies with a pending transfer.
      val system = try { systemType } catch (_: Exception) { fail("unsupported", "ftp-list-system-unavailable") }
      parser = try { DefaultFTPFileEntryParserFactory().createFileEntryParser(system) }
      catch (_: Exception) { fail("unsupported", "ftp-list-format-unsupported") }
      openData("LIST")
    }
    val lines = LineInput(input, operation, maxBytes)
    val result = mutableListOf<Map<String, Any>>()
    var observed = 0
    while (true) {
      val raw = lines.line() ?: break
      if (++observed > maxItems) fail("size", "listing-item-limit")
      val file = parser.parseFTPEntry(Wire.utf8(raw)) ?: continue
      val name = file.name ?: continue
      if (name in setOf(".", "..") || name.isEmpty() || name.length > 512 || name.any { it == '/' || it == '\\' || it.code < 32 || it.code in 127..159 }) continue
      if (!utf8 && name.any { it.code > 127 }) continue
      if (file.isSymbolicLink || (!file.isFile && !file.isDirectory)) continue
      val url = try { endpoint.contain(PathPolicy.encode(name) + if (file.isDirectory) "/" else "", uri) }
      catch (error: BdixFailure) { if (error.kind == "scope") continue else throw error }
      result.add(buildMap {
        put("url", url.toASCIIString()); put("name", name); put("kind", if (file.isDirectory) "directory" else "file")
        if (file.isFile && file.size >= 0) put("sizeBytes", file.size)
      })
    }
    finishData()
    listedItems = observed
    return Pair(result, lines.bytes)
  }
  private fun stat(uri: URI): RemoteMetadata {
    val filePath = path(uri)
    val parent = endpoint.contain("./", uri)
    cwd(parent)
    val mlst = try { mlistFile(filePath) } catch (_: org.apache.commons.net.MalformedServerReplyException) { fail("malformed", "invalid-mlst") }
    if (mlst != null && (!mlst.isFile || mlst.isSymbolicLink)) fail("scope", "regular-file-required")
    if (mlst == null) {
      // LIST/MLSD fallback must identify this exact regular file, not a symlink target.
      val visible = list(parent, Limits.PAGE_BYTES, Limits.ITEMS).first
      val matches = visible.filter { it["url"] == uri.toASCIIString() && it["kind"] == "file" }
      if (matches.isEmpty() || matches.map { it["sizeBytes"] }.distinct().size > 1) fail("unsupported", "regular-file-evidence-required")
    }
    if (sendCommand("SIZE", filePath) != 213) fail("unsupported", "ftp-size-required")
    val size = replyStrings.last().substringAfter(' ', "").trim().toLongOrNull() ?: fail("malformed", "invalid-ftp-size")
    if (size < 16 || size > Limits.FILE_BYTES) fail("size", "file-size-limit")
    val modified = if (sendCommand("MDTM", filePath) == 213) replyStrings.last().substringAfter(' ', "").trim().takeIf { Regex("[0-9]{14}(\\.[0-9]+)?").matches(it) } else null
    val container = PathPolicy.container(uri) ?: fail("unsupported", "progressive-media-required")
    return RemoteMetadata(size, container, modified?.let { "ftp-metadata:$size:$it" }, "unverified")
  }
  fun stream(uri: URI): RemoteStream {
    endpoint.pinned(uri.toASCIIString())
    val metadata = stat(uri)
    val input = openData("RETR", path(uri))
    return RemoteStream(input, metadata, {
      finishData()
      val after = stat(uri)
      if (after.size != metadata.size || after.validator != metadata.validator) fail("scope", "ftp-representation-changed")
    }, { close() })
  }
  fun sample(uri: URI, offset: Long, length: Int): Pair<RemoteMetadata, ByteArray> {
    val metadata = stat(uri)
    val input = openData("RETR", path(uri), offset)
    // A prefix transfer is intentionally terminated, not advertised as a completed download.
    return Pair(metadata, Wire.prefix(input, length, operation))
  }
  override fun close() {
    runCatching { data?.close() }; runCatching { protectedControl?.close() }; runCatching { rawControl?.close() }
    runCatching { disconnect() }
    data = null; rawControl = null; protectedControl = null
  }
}

internal object FtpTransport {
  fun list(endpoint: ApprovedEndpoint, scope: NetworkScope, operation: BdixOperation, uri: URI, maxBytes: Int, maxItems: Int): Map<String, Any> {
    BdixFtpClient(endpoint, scope, operation).use { client ->
      client.open()
      val (entries, bytes) = client.list(uri, maxBytes, maxItems)
      return mapOf("url" to uri.toASCIIString(), "networkContext" to scope.toMap(), "entries" to entries, "bytes" to bytes, "observedItems" to client.listedItems)
    }
  }
  fun stream(endpoint: ApprovedEndpoint, scope: NetworkScope, operation: BdixOperation, uri: URI): RemoteStream {
    val client = BdixFtpClient(endpoint, scope, operation)
    try { client.open(); return client.stream(uri) } catch (error: Throwable) { client.close(); throw error }
  }
  fun probe(endpoint: ApprovedEndpoint, scope: NetworkScope, operation: BdixOperation, uri: URI): RemoteMetadata {
    val (metadata, first) = BdixFtpClient(endpoint, scope, operation).use { client -> client.open(); client.sample(uri, 0, 8192) }
    if (!PathPolicy.sniff(first, metadata.container)) fail("unsupported", "media-signature-mismatch")
    val length = minOf(512, first.size / 2)
    val offset = (1 until minOf(4096, first.size - length)).firstOrNull { !first.copyOfRange(it, it + length).contentEquals(first.copyOfRange(0, length)) }
      ?: return metadata.copy(restart = "unverified")
    val restarted = try {
      BdixFtpClient(endpoint, scope, operation).use { client -> client.open(); client.sample(uri, offset.toLong(), length) }
    } catch (error: BdixFailure) {
      if (error.kind == "unsupported" && error.reason == "rest-unsupported") return metadata.copy(restart = "unsupported")
      throw error
    }
    operation.check()
    val matches = restarted.first.size == metadata.size && restarted.first.validator == metadata.validator && restarted.second.contentEquals(first.copyOfRange(offset, offset + length))
    return metadata.copy(restart = if (matches) "verified" else "unsupported")
  }
}
