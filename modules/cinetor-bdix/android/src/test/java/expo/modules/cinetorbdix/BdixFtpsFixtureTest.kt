package expo.modules.cinetorbdix

import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test
import java.io.BufferedReader
import java.io.Closeable
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.Collections
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

/** CI-only generated certificates. No production trust override or secret is exposed through Expo. */
class BdixFtpsFixtureTest {
  private data class Certificates(val server: SSLContext, val trustedClient: SSLContext, val unrelatedClient: SSLContext)
  private fun certificates(): Certificates {
    val certificate = HeldCertificate.Builder().commonName("Owned fixture").addSubjectAlternativeName("localhost").build()
    val other = HeldCertificate.Builder().commonName("Other fixture").addSubjectAlternativeName("localhost").build()
    fun context(builder: HandshakeCertificates): SSLContext = SSLContext.getInstance("TLS").apply {
      init(arrayOf(builder.keyManager), arrayOf(builder.trustManager), null)
    }
    return Certificates(
      context(HandshakeCertificates.Builder().heldCertificate(certificate).build()),
      context(HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()),
      context(HandshakeCertificates.Builder().addTrustedCertificate(other.certificate).build())
    )
  }
  private class Fixture(private val context: SSLContext, private val auth: Boolean = true, private val protectedData: Boolean = true) : Closeable {
    private val loopback = InetAddress.getByName("127.0.0.1")
    private val server = ServerSocket(0, 1, loopback)
    val port get() = server.localPort
    val commands = Collections.synchronizedList(mutableListOf<String>())
    @Volatile private var control: Socket? = null
    private val worker = Thread {
      var passive: ServerSocket? = null
      try {
        var socket = server.accept(); control = socket; socket.soTimeout = 3000
        fun reader() = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
        var input = reader()
        fun reply(value: String) { socket.getOutputStream().apply { write((value + "\r\n").toByteArray()); flush() } }
        reply("220 Owned explicit FTPS fixture")
        while (true) {
          val line = input.readLine() ?: break
          commands.add(line)
          when (line.substringBefore(' ')) {
            "AUTH" -> if (!auth) reply("502 AUTH unsupported") else {
              reply("234 TLS accepted")
              val tls = context.socketFactory.createSocket(socket, "localhost", socket.port, true) as SSLSocket
              tls.useClientMode = false; tls.soTimeout = 3000; tls.startHandshake()
              socket = tls; control = tls; input = reader()
            }
            "USER" -> reply("331 Password required")
            "PASS" -> reply("230 Anonymous login")
            "PBSZ" -> reply("200 PBSZ accepted")
            "PROT" -> if (protectedData) reply("200 PROT P accepted") else reply("534 Protected data unavailable")
            "OPTS" -> reply("200 UTF8 enabled")
            "TYPE" -> reply("200 Binary mode")
            "CWD" -> reply("250 Directory changed")
            "PWD" -> reply("257 \"/media\" current directory")
            "EPSV" -> {
              passive = ServerSocket(0, 1, loopback).apply { soTimeout = 3000 }
              reply("229 Entering Extended Passive Mode (|||${passive.localPort}|)")
            }
            "MLSD" -> {
              reply("150 Protected listing")
              val raw = passive!!.accept()
              val tls = context.socketFactory.createSocket(raw, "localhost", raw.port, true) as SSLSocket
              tls.useClientMode = false; tls.soTimeout = 3000; tls.startHandshake()
              tls.use { it.getOutputStream().write("type=file;size=16384; movie.mp4\r\n".toByteArray()) }
              passive?.close(); passive = null; reply("226 Listing complete")
            }
            else -> reply("502 Unsupported fixture command")
          }
        }
      } catch (_: Exception) { /* Rejection cases deliberately terminate the TLS handshake. */ }
      finally { runCatching { passive?.close() }; runCatching { control?.close() } }
    }.apply { isDaemon = true; start() }
    override fun close() { server.close(); runCatching { control?.close() }; worker.join(3500) }
  }
  private fun endpoint(fixture: Fixture, host: String = "localhost"): ApprovedEndpoint =
    ApprovedEndpoint("owned-ftps", URI("ftps://$host:${fixture.port}/media/"), true, true, false, false, emptySet())
  private fun client(endpoint: ApprovedEndpoint, operation: BdixOperation, trust: SSLContext) =
    BdixFtpClient(endpoint, operation, { Socket() }, { InetAddress.getByName("127.0.0.1") }, trust)

  @Test fun explicitTlsVerifiesControlAndProtectedListingWithOwnedCertificate() {
    val certificates = certificates()
    Fixture(certificates.server).use { fixture ->
      val endpoint = endpoint(fixture)
      BdixOperation("ftps") {}.use { operation ->
        client(endpoint, operation, certificates.trustedClient).use { ftp ->
          ftp.open(); assertEquals("movie.mp4", ftp.list(endpoint.root, 65536, 10).first.single()["name"])
        }
      }
      assertTrue(fixture.commands.contains("AUTH TLS")); assertTrue(fixture.commands.contains("PBSZ 0")); assertTrue(fixture.commands.contains("PROT P"))
      assertTrue(fixture.commands.indexOf("AUTH TLS") < fixture.commands.indexOf("USER anonymous"))
    }
  }
  @Test fun untrustedOrWrongHostnameTlsDoesNotReachLogin() {
    val certificates = certificates()
    for (wrongHost in listOf(true, false)) Fixture(certificates.server).use { fixture ->
      val endpoint = endpoint(fixture, if (wrongHost) "wrong.example" else "localhost")
      BdixOperation("reject-tls") {}.use { operation ->
        client(endpoint, operation, if (wrongHost) certificates.trustedClient else certificates.unrelatedClient).use { ftp ->
          try { ftp.open(); org.junit.Assert.fail("TLS trust and hostname failures must reject") }
          catch (error: BdixFailure) { assertEquals("tls-verification-failed", error.reason) }
        }
      }
      assertFalse(fixture.commands.any { it.startsWith("USER") })
    }
  }
  @Test fun authOrProtectedChannelFailureNeverFallsBackToCleartext() {
    val certificates = certificates()
    for (auth in listOf(true, false)) Fixture(certificates.server, auth = auth, protectedData = false).use { fixture ->
      val endpoint = endpoint(fixture)
      BdixOperation("no-downgrade") {}.use { operation ->
        client(endpoint, operation, certificates.trustedClient).use { ftp ->
          try { ftp.open(); org.junit.Assert.fail("FTPS protection failure must reject") }
          catch (error: BdixFailure) { assertEquals(if (auth) "protected-data-required" else "ftps-required", error.reason) }
        }
      }
      assertFalse(fixture.commands.contains("PROT C"))
      if (!auth) assertFalse(fixture.commands.any { it.startsWith("USER") })
    }
  }
}
