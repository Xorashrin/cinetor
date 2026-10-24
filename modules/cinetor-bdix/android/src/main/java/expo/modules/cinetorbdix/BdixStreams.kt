package expo.modules.cinetorbdix

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.FilterReader
import java.io.InputStream
import java.io.Reader
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

internal object Wire {
  private val tlsContext: SSLContext by lazy { SSLContext.getInstance("TLS").apply { init(null, null, null) } }
  fun tls(raw: Socket, host: String, operation: BdixOperation, context: SSLContext = tlsContext): SSLSocket {
    operation.check()
    val name = host.removeSurrounding("[", "]")
    val socket = operation.track(context.socketFactory.createSocket(raw, name, raw.port, true) as SSLSocket)
    socket.useClientMode = true
    socket.soTimeout = Limits.CONNECT_MS
    socket.enabledProtocols = socket.supportedProtocols.filter { it in setOf("TLSv1.2", "TLSv1.3") }.toTypedArray()
    socket.sslParameters = socket.sslParameters.apply {
      endpointIdentificationAlgorithm = "HTTPS"
      if (!name.contains(':') && !Regex("[0-9.]+").matches(name)) serverNames = listOf(SNIHostName(name))
    }
    val handshakeDeadline = NetworkIo.deadlines.schedule({ operation.cancel("timeout") }, Limits.CONNECT_MS.toLong(), java.util.concurrent.TimeUnit.MILLISECONDS)
    try { socket.startHandshake() } catch (_: javax.net.ssl.SSLException) { runCatching { socket.close() }; fail("permission", "tls-verification-failed") }
    finally { handshakeDeadline.cancel(false) }
    operation.check()
    socket.soTimeout = Limits.READ_MS
    return socket
  }
  fun utf8(bytes: ByteArray): String = try {
    Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
  } catch (_: Exception) { fail("malformed", "invalid-utf8") }
  fun prefix(input: InputStream, max: Int, operation: BdixOperation): ByteArray {
    val output = ByteArrayOutputStream(max)
    val buffer = ByteArray(minOf(max, 8192))
    while (output.size() < max) {
      operation.check()
      val count = input.read(buffer, 0, minOf(buffer.size, max - output.size()))
      if (count < 0) break
      if (count == 0) continue
      output.write(buffer, 0, count)
    }
    operation.check()
    return output.toByteArray()
  }
}

internal class LineInput(input: InputStream, private val operation: BdixOperation, private val maxBytes: Int, private val maxLine: Int = 8192) {
  val input = if (input is BufferedInputStream) input else BufferedInputStream(input, 8192)
  var bytes = 0; private set
  fun line(): ByteArray? {
    val output = ByteArrayOutputStream()
    while (true) {
      if (output.size() % 1024 == 0) operation.check()
      val value = input.read()
      if (value == -1) return if (output.size() == 0) null else fail("malformed", "truncated-line")
      if (++bytes > maxBytes || output.size() >= maxLine) fail("size", "wire-line-limit")
      if (value == 10) return output.toByteArray().let { if (it.isNotEmpty() && it.last() == 13.toByte()) it.copyOf(it.size - 1) else it }
      output.write(value)
    }
  }
}

/** Commons Net normally reads control lines without a size ceiling. Bound them before parsing. */
internal class ControlReader(reader: Reader, private val operation: BdixOperation) : FilterReader(reader) {
  private var chars = 0
  private var line = 0
  private fun account(value: Int) {
    if (value < 0) return
    if (++chars > 65536 || ++line > 8192) fail("size", "ftp-control-limit")
    if (value == 10) line = 0
  }
  override fun read(): Int { operation.check(); return super.read().also(::account) }
  override fun read(buffer: CharArray, offset: Int, length: Int): Int {
    operation.check()
    val count = super.read(buffer, offset, minOf(length, 4096))
    if (count > 0) for (i in offset until offset + count) account(buffer[i].code)
    return count
  }
}

internal data class RemoteMetadata(val size: Long, val container: String, val validator: String?, val restart: String) {
  fun toMap(scope: NetworkScope): Map<String, Any> = buildMap {
    put("sizeBytes", size); put("mimeType", PathPolicy.mime(container)); put("container", container)
    put("restart", restart); put("networkContext", scope.toMap()); validator?.let { put("validator", it) }
    put("providerVersion", "1.0.0"); put("providerHash", BuildConfig.BDIX_SOURCE_SHA256)
  }
}
internal class RemoteStream(val input: InputStream, val metadata: RemoteMetadata, val finish: () -> Unit, private val cleanup: () -> Unit) : Closeable {
  override fun close() = cleanup()
}
