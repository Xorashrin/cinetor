package expo.modules.cinetorbdix

import android.os.SystemClock
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.OutputStream
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Only exact native-generated file capabilities; no directory, proxy URL, or wildcard route. */
internal class BdixLoopbackProxy(private val lookup: (String) -> BdixSpool) : Closeable {
  private val stopped = AtomicBoolean(false)
  private val server = ServerSocket().apply { reuseAddress = false; bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 8) }
  private val sockets = ConcurrentHashMap.newKeySet<Socket>()
  private val workers = java.util.concurrent.ThreadPoolExecutor(4, 4, 0, TimeUnit.MILLISECONDS,
    java.util.concurrent.SynchronousQueue(), { task -> Thread(task, "bdix-local-reader").apply { isDaemon = true } }, java.util.concurrent.ThreadPoolExecutor.AbortPolicy())
  private val acceptor = Thread({
    while (!stopped.get()) {
      val socket = try { server.accept() } catch (_: Exception) { break }
      if (!socket.inetAddress.isLoopbackAddress) { socket.close(); continue }
      socket.soTimeout = 1500; sockets.add(socket)
      try { workers.execute { serve(socket) } } catch (_: java.util.concurrent.RejectedExecutionException) { sockets.remove(socket); socket.close() }
    }
  }, "bdix-loopback").apply { isDaemon = true; start() }

  fun uri(spool: BdixSpool): String = "http://127.0.0.1:${server.localPort}/media/${spool.token}/video.${spool.metadata.container}"

  private fun line(input: BufferedInputStream, budget: IntArray): String {
    val output = ByteArrayOutputStream()
    while (true) {
      val byte = input.read()
      if (byte < 0) fail("malformed", "truncated-local-request")
      if (++budget[0] > 8192 || output.size() > 2048) fail("size", "local-header-limit")
      if (byte == 10) {
        val value = output.toByteArray()
        if (value.isEmpty() || value.last() != 13.toByte()) fail("malformed", "invalid-local-line")
        return String(value, 0, value.size - 1, Charsets.US_ASCII)
      }
      if (byte > 127 || (byte < 32 && byte !in setOf(9, 13))) fail("malformed", "invalid-local-header")
      output.write(byte)
    }
  }
  private fun response(output: OutputStream, status: Int, reason: String, headers: Map<String, String> = emptyMap()) {
    val all = linkedMapOf("Connection" to "close", "Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff") + headers
    output.write(("HTTP/1.1 $status $reason\r\n" + all.entries.joinToString("") { "${it.key}: ${it.value}\r\n" } + "\r\n").toByteArray(Charsets.US_ASCII))
    output.flush()
  }
  private fun serve(socket: Socket) {
    var spool: BdixSpool? = null
    var replied = false
    val headerTimeout = NetworkIo.deadlines.schedule({ runCatching { socket.close() } }, 1500, TimeUnit.MILLISECONDS)
    try {
      socket.use { client ->
        val input = BufferedInputStream(client.getInputStream(), 4096)
        val budget = intArrayOf(0)
        val start = line(input, budget).split(' ')
        if (start.size != 3 || start[0] !in setOf("GET", "HEAD") || start[2] != "HTTP/1.1") fail("permission", "unsupported-local-request")
        val headers = linkedMapOf<String, String>()
        while (true) {
          val value = line(input, budget)
          if (value.isEmpty()) break
          val colon = value.indexOf(':')
          if (colon <= 0 || value.first().isWhitespace()) fail("malformed", "invalid-local-header")
          val name = value.substring(0, colon).lowercase(Locale.ROOT)
          if (!Regex("[a-z0-9-]+").matches(name) || headers.containsKey(name)) fail("malformed", "ambiguous-local-header")
          headers[name] = value.substring(colon + 1).trim()
          if (headers.size > 32) fail("size", "local-header-limit")
        }
        headerTimeout.cancel(false)
        if (headers["host"] != "127.0.0.1:${server.localPort}" || headers.containsKey("origin") || headers.containsKey("transfer-encoding") ||
            headers["content-length"]?.let { it != "0" } == true || headers.containsKey("authorization") || headers.containsKey("cookie")) fail("permission", "invalid-local-client")
        val route = Regex("/media/([A-Za-z0-9_-]{43})/video\\.(mp4|mkv|webm)").matchEntire(start[1]) ?: fail("permission", "unknown-capability")
        val session = lookup(route.groupValues[1])
        spool = session
        if (route.groupValues[2] != session.metadata.container) fail("permission", "unknown-capability")
        session.reader(client)
        val rangeHeader = headers["range"]
        val ifRange = headers["if-range"]
        if (headers["if-match"]?.let { it != session.etag } == true) {
          response(client.getOutputStream(), 412, "Precondition Failed", mapOf("Content-Length" to "0")); replied = true; return
        }
        // Mismatched If-Range means a full representation, never a partial append of another one.
        val ranged = rangeHeader != null && (ifRange == null || ifRange == session.etag)
        val range = try { RangePolicy.parse(if (ranged) rangeHeader else null, session.metadata.size) } catch (_: BdixFailure) {
          response(client.getOutputStream(), 416, "Range Not Satisfiable", mapOf("Content-Length" to "0", "Content-Range" to "bytes */${session.metadata.size}")); replied = true; return
        }
        if (start[0] == "GET") session.waitFor(range.start, SystemClock.elapsedRealtime() + Limits.BATCH_MS)
        val extra = linkedMapOf(
          "Content-Type" to PathPolicy.mime(session.metadata.container), "Content-Length" to range.length.toString(),
          "Accept-Ranges" to "bytes", "ETag" to session.etag
        )
        if (ranged) extra["Content-Range"] = "bytes ${range.start}-${range.end}/${session.metadata.size}"
        val output = client.getOutputStream()
        session.check()
        response(output, if (ranged) 206 else 200, if (ranged) "Partial Content" else "OK", extra); replied = true
        if (start[0] == "HEAD") return
        val reader = session.reader(RandomAccessFile(session.file, "r"))
        try {
          reader.use { file ->
            var position = range.start
            val buffer = ByteArray(65536)
            file.seek(position)
            while (position <= range.end) {
              session.waitFor(position, SystemClock.elapsedRealtime() + Limits.BATCH_MS)
              session.check()
              val count = minOf(buffer.size.toLong(), session.readable - position, range.end - position + 1).toInt()
              file.readFully(buffer, 0, count)
              // Socket writes have no SO_TIMEOUT: close a stalled local reader explicitly.
              val stalled = NetworkIo.deadlines.schedule({ runCatching { client.close() } }, Limits.BATCH_MS, TimeUnit.MILLISECONDS)
              try { output.write(buffer, 0, count); output.flush() } finally { stalled.cancel(false) }
              position += count
            }
          }
        } finally { session.untrack(reader) }
      }
    } catch (error: Throwable) {
      if (!replied) runCatching { response(socket.getOutputStream(), if ((error as? BdixFailure)?.kind == "timeout") 503 else 404, "Unavailable", mapOf("Content-Length" to "0")) }
    } finally {
      headerTimeout.cancel(false); spool?.untrack(socket); sockets.remove(socket); runCatching { socket.close() }
    }
  }
  override fun close() {
    if (!stopped.compareAndSet(false, true)) return
    runCatching { server.close() }
    sockets.toList().forEach { runCatching { it.close() } }; sockets.clear()
    workers.shutdownNow(); acceptor.interrupt()
  }
}
