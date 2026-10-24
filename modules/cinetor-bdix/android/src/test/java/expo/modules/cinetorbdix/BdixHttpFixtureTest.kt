package expo.modules.cinetorbdix

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Owned HTTP fixture drives the real parser/transfer code; it does not replace it with copied logic. */
class BdixHttpFixtureTest {
  private class Fixture(private val response: ByteArray) : Closeable {
    private val server = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val port: Int get() = server.localPort
    val done = CountDownLatch(1)
    @Volatile var request = ""
    private val thread = Thread {
      try {
        server.accept().use { socket ->
          socket.soTimeout = 2000
          val input = socket.getInputStream()
          val requestBytes = java.io.ByteArrayOutputStream()
          while (requestBytes.size() < 8192) {
            val byte = input.read(); if (byte < 0) break
            requestBytes.write(byte)
            if (requestBytes.toString("US-ASCII").endsWith("\r\n\r\n")) break
          }
          request = requestBytes.toString("US-ASCII")
          socket.getOutputStream().write(response); socket.getOutputStream().flush()
        }
      } catch (_: Exception) { } finally { done.countDown() }
    }.apply { isDaemon = true; start() }
    override fun close() { server.close(); thread.join(2500) }
  }
  private fun endpoint(fixture: Fixture): ApprovedEndpoint {
    val root = URI("http://127.0.0.1:${fixture.port}/media/")
    return ApprovedEndpoint("fixture", root, true, false, false, true, setOf(root.resolve("movie.mp4").toASCIIString()))
  }
  private fun stream(endpoint: ApprovedEndpoint, operation: BdixOperation): RemoteStream = HttpTransport.stream(endpoint, operation, endpoint.root.resolve("movie.mp4"), { Socket() }, { InetAddress.getByName("127.0.0.1") })

  @Test fun exactFiniteIdentityBodyUsesOneRequestNoCookiesAndNoReconnect() {
    val bytes = ByteArray(64).apply { "ftyp".toByteArray().copyInto(this, 4) }
    val response = "HTTP/1.1 200 OK\r\nContent-Length: 64\r\nContent-Type: video/mp4\r\nETag: \"owned-v1\"\r\n\r\n".toByteArray() + bytes
    Fixture(response).use { fixture ->
      BdixOperation("http") {}.use { operation ->
        stream(endpoint(fixture), operation).use { source ->
          assertEquals(64L, source.metadata.size); assertEquals("\"owned-v1\"", source.metadata.validator)
          assertArrayEquals(bytes, source.input.readBytes()); source.finish()
        }
      }
      assertTrue(fixture.done.await(3, TimeUnit.SECONDS)); assertTrue(fixture.request.contains("Accept-Encoding: identity"))
      assertFalse(fixture.request.contains("Authorization:")); assertFalse(fixture.request.contains("Cookie:"))
    }
  }
  @Test fun redirectsAmbiguousFramingAndUnboundedMediaAreRejected() {
    for (header in listOf(
      "HTTP/1.1 302 Found\r\nLocation: https://other.example/media/movie.mp4\r\nContent-Length: 0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Length: 32\r\nContent-Length: 64\r\n\r\n",
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Length: 32\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 32\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\n\r\n",
      "HTTP/1.1 206 Partial Content\r\nContent-Length: 32\r\nContent-Range: bytes 16-47/100\r\n\r\n"
    )) Fixture(header.toByteArray()).use { fixture ->
      BdixOperation("bad-http") {}.use { operation ->
        try { stream(endpoint(fixture), operation).close(); org.junit.Assert.fail("Unsafe framing or redirect must fail") } catch (_: BdixFailure) { }
      }
    }
  }
  @Test fun truncatedBodiesAndMalformedChunkedListingsFailInsteadOfAppending() {
    BdixOperation("framing") {}.use { operation ->
      val body = FixedBody(ByteArrayInputStream(byteArrayOf(1, 2)), 16, operation)
      try { body.readBytes(); org.junit.Assert.fail("Truncated fixed body must fail") } catch (error: BdixFailure) { assertEquals("truncated-http-body", error.reason) }
      val chunks = ChunkedBody(ByteArrayInputStream("4\r\ntest\r\n0\r\n\r\n".toByteArray()), operation)
      assertEquals("test", String(chunks.readBytes()))
      for (value in listOf("z\r\n", "4\r\ntestX\r\n0\r\n\r\n", "4\r\nte", "0\r\nETag: changed\r\n\r\n")) {
        try { ChunkedBody(ByteArrayInputStream(value.toByteArray()), operation).readBytes(); org.junit.Assert.fail("Malformed chunk must fail") } catch (_: BdixFailure) { }
      }
    }
  }
}
