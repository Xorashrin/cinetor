package expo.modules.cinetorbdix

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
import java.util.concurrent.Executors

/** Owned loopback protocol fixture only. These tests do not contact an ISP or any public server. */
class BdixFtpFixtureTest {
  private class Fixture(val mlsd: Boolean = true, val rest: Boolean = true, val epsv: Boolean = true, val badPasv: Boolean = false, val huge: Boolean = false) : Closeable {
    private val loopback = InetAddress.getByName("127.0.0.1")
    private val server = ServerSocket(0, 8, loopback)
    private val workers = Executors.newFixedThreadPool(4)
    private val clients = Collections.synchronizedList(mutableListOf<Socket>())
    val commands = Collections.synchronizedList(mutableListOf<String>())
    val port: Int get() = server.localPort
    val bytes = ByteArray(16384) { (it % 251).toByte() }.apply { "ftyp".toByteArray().copyInto(this, 4) }
    private val acceptor = Thread {
      while (!server.isClosed) {
        val socket = try { server.accept() } catch (_: Exception) { break }
        clients.add(socket)
        workers.execute { runClient(socket) }
      }
    }.apply { isDaemon = true; start() }
    private fun runClient(socket: Socket) {
      var passive: ServerSocket? = null
      var offset = 0
      var directory = "/media"
      fun reply(text: String) { socket.getOutputStream().apply { write((text + "\r\n").toByteArray(Charsets.UTF_8)); flush() } }
      try {
        socket.soTimeout = 3000
        val input = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
        reply("220 Owned Cinetor fixture")
        while (true) {
          val line = input.readLine() ?: break
          commands.add(line)
          val command = line.substringBefore(' '); val argument = line.substringAfter(' ', "")
          when (command) {
            "USER" -> if (argument == "anonymous") reply("331 Anonymous password") else reply("530 No guessed users")
            "PASS" -> if (argument.isEmpty()) reply("230 Anonymous login") else reply("530 No guessed password")
            "OPTS" -> reply("200 UTF8 enabled")
            "TYPE" -> if (argument == "I") reply("200 Binary enabled") else reply("504 Binary required")
            "SYST" -> reply("215 UNIX Type: L8")
            "CWD" -> if (argument.startsWith("/media")) { directory = argument; reply("250 Directory changed") } else reply("550 Outside root")
            "PWD" -> reply("257 \"$directory\" is current directory")
            "MLST" -> reply("500 MLST not supported in this fixture")
            "SIZE" -> reply("213 ${bytes.size}")
            "MDTM" -> reply("213 20261024010203")
            "REST" -> if (rest) { offset = argument.toInt(); reply("350 Restart position accepted") } else reply("502 REST unsupported")
            "EPSV" -> {
              if (!epsv) reply("502 EPSV unsupported") else {
                passive?.close(); passive = ServerSocket(0, 1, loopback).apply { soTimeout = 3000 }
                reply("229 Entering Extended Passive Mode (|||${passive.localPort}|)")
              }
            }
            "PASV" -> {
              passive?.close(); passive = ServerSocket(0, 1, loopback).apply { soTimeout = 3000 }
              val address = if (badPasv) "203,0,113,99" else "127,0,0,1"
              reply("227 Entering Passive Mode ($address,${passive.localPort / 256},${passive.localPort % 256})")
            }
            "MLSD", "LIST", "RETR" -> {
              if (command == "MLSD" && !mlsd) { passive?.close(); passive = null; reply("502 MLSD unsupported"); continue }
              reply("150 Opening binary data")
              passive!!.accept().use { data ->
                val output = data.getOutputStream()
                if (command == "RETR") output.write(bytes.copyOfRange(offset, bytes.size))
                else if (huge) output.write(("type=file;size=10; " + "x".repeat(9000) + ".mp4\r\n").toByteArray())
                else if (command == "MLSD") output.write("type=file;size=16384;modify=20261024010203; movie.mp4\r\ntype=dir; TV\r\ntype=cdir; .\r\n".toByteArray())
                else output.write("-rw-r--r-- 1 owner group 16384 Oct 24 2026 movie.mp4\r\nlrwxrwxrwx 1 owner group 8 Oct 24 2026 shortcut -> /private\r\n".toByteArray())
                output.flush()
              }
              offset = 0; passive?.close(); passive = null; reply("226 Transfer complete")
            }
            "QUIT" -> { reply("221 Bye"); break }
            else -> reply("502 Unsupported fixture command")
          }
        }
      } catch (_: Exception) { /* Prefix probes deliberately close control/data before completion. */ }
      finally { runCatching { passive?.close() }; runCatching { socket.close() }; clients.remove(socket) }
    }
    override fun close() {
      server.close(); clients.toList().forEach { runCatching { it.close() } }
      workers.shutdownNow(); acceptor.join(2000)
    }
  }
  private fun endpoint(fixture: Fixture): ApprovedEndpoint {
    val root = URI("ftp://127.0.0.1:${fixture.port}/media/")
    return ApprovedEndpoint("fixture", root, true, true, true, false, setOf(root.resolve("movie.mp4").toASCIIString()))
  }
  private fun client(endpoint: ApprovedEndpoint, operation: BdixOperation) = BdixFtpClient(endpoint, operation, { Socket() }, { InetAddress.getByName("127.0.0.1") })

  @Test fun binaryMlsdAndWholeFileTransferUseProductionClient() {
    Fixture().use { fixture ->
      val endpoint = endpoint(fixture)
      BdixOperation("list") {}.use { operation ->
        client(endpoint, operation).use { ftp ->
          ftp.open()
          val rows = ftp.list(endpoint.root, 65536, 20).first
          assertEquals(2, rows.size); assertEquals("movie.mp4", rows[0]["name"])
          assertEquals("directory", rows[1]["kind"])
        }
      }
      BdixOperation("stream") {}.use { operation ->
        client(endpoint, operation).use { ftp ->
          ftp.open()
          ftp.stream(endpoint.root.resolve("movie.mp4")).use { stream ->
            assertArrayEquals(fixture.bytes, stream.input.readBytes())
            stream.finish()
          }
        }
      }
      assertTrue(fixture.commands.contains("TYPE I")); assertTrue(fixture.commands.contains("USER anonymous"))
      assertFalse(fixture.commands.any { it.startsWith("USER ") && it != "USER anonymous" })
    }
  }
  @Test fun listFallbackAndPasvAreBoundedAndSymlinksAreNotIndexed() {
    Fixture(mlsd = false, epsv = false).use { fixture ->
      val endpoint = endpoint(fixture)
      BdixOperation("fallback") {}.use { operation ->
        client(endpoint, operation).use { ftp ->
          ftp.open()
          val rows = ftp.list(endpoint.root, 65536, 20).first
          assertEquals(1, rows.size); assertEquals("movie.mp4", rows[0]["name"])
        }
      }
      assertTrue(fixture.commands.contains("PASV")); assertTrue(fixture.commands.contains("LIST"))
      assertTrue(fixture.commands.indexOf("SYST") < fixture.commands.indexOf("LIST"))
    }
  }
  @Test fun restartReadsActualOffsetAndUnsupportedRestIsTruthful() {
    for (supported in listOf(true, false)) Fixture(rest = supported).use { fixture ->
      val endpoint = endpoint(fixture)
      BdixOperation("rest") {}.use { operation ->
        client(endpoint, operation).use { ftp ->
          ftp.open()
          if (supported) assertArrayEquals(fixture.bytes.copyOfRange(127, 639), ftp.sample(endpoint.root.resolve("movie.mp4"), 127, 512).second)
          else try { ftp.sample(endpoint.root.resolve("movie.mp4"), 127, 512); org.junit.Assert.fail("REST must not be fabricated") }
          catch (error: BdixFailure) { assertEquals("rest-unsupported", error.reason) }
        }
      }
    }
  }
  @Test fun unrelatedPasvAddressRejectedBeforeAnyDataConnect() {
    Fixture(epsv = false, badPasv = true).use { fixture ->
      val endpoint = endpoint(fixture); var sockets = 0
      BdixOperation("bad-pasv") {}.use { operation ->
        BdixFtpClient(endpoint, operation, { sockets++; Socket() }, { InetAddress.getByName("127.0.0.1") }).use { ftp ->
          ftp.open()
          try { ftp.list(endpoint.root, 65536, 20); org.junit.Assert.fail("Unrelated PASV host must be rejected") }
          catch (error: BdixFailure) { assertEquals("unrelated-pasv-host", error.reason) }
          assertEquals("Only the control socket may exist", 1, sockets)
        }
      }
    }
  }
  @Test fun oversizedListingAndPreabortFailClosed() {
    Fixture(huge = true).use { fixture ->
      val endpoint = endpoint(fixture)
      BdixOperation("huge") {}.use { operation ->
        client(endpoint, operation).use { ftp ->
          ftp.open()
          try { ftp.list(endpoint.root, 65536, 20); org.junit.Assert.fail("Oversized line must fail") }
          catch (error: BdixFailure) { assertEquals("size", error.kind) }
        }
      }
      val operation = BdixOperation("cancelled") {}; operation.cancel()
      var sockets = 0
      try { BdixFtpClient(endpoint, operation, { sockets++; Socket() }, { InetAddress.getByName("127.0.0.1") }).open(); org.junit.Assert.fail("Preabort must fail") }
      catch (error: BdixFailure) { assertEquals("cancelled", error.kind) }
      assertEquals(0, sockets)
    }
  }
}
