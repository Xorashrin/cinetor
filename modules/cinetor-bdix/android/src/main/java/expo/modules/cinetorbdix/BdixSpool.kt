package expo.modules.cinetorbdix

import android.content.Context
import android.os.SystemClock
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** One stream, one spool, one capability: partial data is never appended after a reconnect. */
internal class BdixSpool(
  val token: String,
  val file: File,
  val metadata: RemoteMetadata,
  val scope: NetworkScope,
  val operation: BdixOperation,
  val expiresAt: Long,
  private val onInvalid: (BdixSpool) -> Unit
) : Closeable {
  private val lock = java.lang.Object()
  private val ready = CountDownLatch(1)
  private val closed = AtomicBoolean(false)
  private val created = SystemClock.elapsedRealtime()
  @Volatile var available = 0L; private set
  @Volatile var state = "transferring"; private set
  @Volatile var reason: String? = null; private set
  @Volatile var sha256: String? = null; private set
  // Withhold the final byte until EOF, completion reply, metadata, and fsync are verified.
  val readable: Long get() = if (state == "complete") available else minOf(available, metadata.size - 1)
  @Volatile var uri: String? = null
  @Volatile var expiry: ScheduledFuture<*>? = null
  @Volatile private var future: java.util.concurrent.Future<*>? = null
  fun ownFuture(value: java.util.concurrent.Future<*>) {
    future = value
    if (closed.get()) value.cancel(true)
  }
  private val representationUuid = java.util.UUID.randomUUID().toString()
  val representationId: String get() = "bdix-spool:$representationUuid"
  val etag: String get() = "\"bdix-$representationUuid\""
  private val readers = ConcurrentHashMap.newKeySet<Closeable>()

  fun run(remote: RemoteStream) {
    try {
      val hash = MessageDigest.getInstance("SHA-256")
      remote.use { source ->
        FileOutputStream(file, false).use { output ->
          val first = Wire.prefix(source.input, minOf(8192L, metadata.size).toInt(), operation)
          if (!PathPolicy.sniff(first, metadata.container)) fail("unsupported", "media-signature-mismatch")
          output.write(first); hash.update(first)
          synchronized(lock) { available = first.size.toLong(); lock.notifyAll() }
          ready.countDown()
          val buffer = ByteArray(65536)
          while (available < metadata.size) {
            check()
            val count = source.input.read(buffer, 0, minOf(buffer.size.toLong(), metadata.size - available).toInt())
            if (count < 0) fail("network", "truncated-transfer")
            if (count == 0) continue
            output.write(buffer, 0, count); hash.update(buffer, 0, count)
            synchronized(lock) { available += count; lock.notifyAll() }
          }
          check()
          if (source.input.read() != -1) fail("size", "transfer-size-mismatch")
          source.finish()
          output.fd.sync()
        }
      }
      check()
      synchronized(lock) { sha256 = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }; state = "complete"; lock.notifyAll() }
    } catch (error: Throwable) {
      reason = (error as? BdixFailure)?.reason ?: "transfer-failed"
      state = "failed"
      ready.countDown()
      synchronized(lock) { lock.notifyAll() }
      onInvalid(this)
    } finally {
      if (closed.get()) file.delete()
    }
  }
  fun awaitReady() {
    while (!ready.await(50, TimeUnit.MILLISECONDS)) operation.check()
    check()
    operation.extendTransfer()
  }
  fun check() {
    operation.check()
    if (closed.get() || state == "failed") fail("cancelled", reason ?: "transfer-released")
    if (SystemClock.elapsedRealtime() - created >= Limits.SESSION_MS) fail("cancelled", "capability-expired")
  }
  fun waitFor(position: Long, deadline: Long) {
    synchronized(lock) {
      while (readable <= position && state == "transferring") {
        check()
        val remaining = deadline - SystemClock.elapsedRealtime()
        if (remaining <= 0) fail("timeout", "range-not-buffered")
        lock.wait(minOf(remaining, 100L))
      }
      check()
      if (readable <= position) fail("network", "range-unavailable")
    }
  }
  fun <T : Closeable> reader(value: T): T {
    synchronized(lock) { check(); readers.add(value); return value }
  }
  fun untrack(value: Closeable) { readers.remove(value) }
  fun status(): Map<String, Any> = buildMap {
    put("state", state); put("bytes", available); put("sizeBytes", metadata.size); reason?.let { put("reason", it) }
    put("representationId", representationId); sha256?.takeIf { state == "complete" }?.let { put("sha256", it) }
  }
  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    expiry?.cancel(false)
    future?.cancel(true)
    operation.cancel()
    if (state != "complete") { state = "failed"; reason = reason ?: "transfer-released" }
    readers.toList().forEach { runCatching { it.close() } }; readers.clear()
    ready.countDown()
    synchronized(lock) { lock.notifyAll() }
    file.delete()
  }
}

internal class SpoolStore(private val context: Context, private val scopeValid: (NetworkScope) -> Unit) : Closeable {
  private val root = File(context.noBackupFilesDir, "cinetor-bdix-spool").apply { mkdirs() }
  private val sessions = ConcurrentHashMap<String, BdixSpool>()
  private val transferPool = java.util.concurrent.ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS,
    java.util.concurrent.SynchronousQueue(), { task -> Thread(task, "bdix-transfer").apply { isDaemon = true } }, java.util.concurrent.ThreadPoolExecutor.AbortPolicy())
  private val proxyDelegate = lazy { BdixLoopbackProxy(::get) }
  private val proxy: BdixLoopbackProxy get() = proxyDelegate.value
  private val random = SecureRandom()
  init { root.listFiles()?.filter { it.isFile }?.forEach { it.delete() } }

  @Synchronized fun prepare(remote: RemoteStream, scope: NetworkScope, operation: BdixOperation, maxBytes: Long): BdixSpool {
    scopeValid(scope); operation.check()
    operation.track(remote)
    if (maxBytes < remote.metadata.size || remote.metadata.size > Limits.FILE_BYTES || sessions.size >= Limits.MAX_SPOOLS ||
        sessions.values.sumOf { it.metadata.size } + remote.metadata.size > Limits.FILE_BYTES) {
      remote.close(); fail("size", "spool-quota")
    }
    val reservedRemaining = sessions.values.sumOf { (it.metadata.size - it.available).coerceAtLeast(0) }
    if (root.usableSpace < remote.metadata.size + reservedRemaining + 16 * 1024 * 1024) { remote.close(); fail("storage", "insufficient-spool-space") }
    val token = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(random::nextBytes))
    val file = File.createTempFile("session-", ".partial", root)
    val spool = BdixSpool(token, file, remote.metadata, scope, operation, System.currentTimeMillis() + Limits.SESSION_MS, ::invalid)
    sessions[token] = spool
    try {
      spool.ownFuture(transferPool.submit { spool.run(remote) })
      spool.expiry = NetworkIo.deadlines.schedule({ release(token) }, Limits.SESSION_MS, TimeUnit.MILLISECONDS)
      return spool
    } catch (error: Throwable) { sessions.remove(token); remote.close(); spool.close(); throw error }
  }
  fun publish(spool: BdixSpool): Map<String, Any> {
    spool.awaitReady(); scopeValid(spool.scope)
    val uri = proxy.uri(spool)
    spool.uri = uri
    TrustedMediaRegistry.register(uri)
    // Revocation can race registration; recheck after registration and undo on failure.
    try { spool.check(); scopeValid(spool.scope) } catch (error: Throwable) { TrustedMediaRegistry.revoke(uri); release(spool.token); throw error }
    return spool.metadata.toMap(spool.scope) + mapOf("uri" to uri, "token" to spool.token, "expiresAt" to spool.expiresAt,
      "representationId" to spool.representationId, "representationValidator" to spool.etag)
  }
  fun get(token: String): BdixSpool {
    val spool = sessions[token] ?: fail("permission", "unknown-capability")
    scopeValid(spool.scope); spool.check()
    return spool
  }
  fun status(token: String): Map<String, Any> = get(token).status()
  private fun invalid(spool: BdixSpool) {
    spool.uri?.let(TrustedMediaRegistry::revoke)
    // A failed source cannot stay readable, including already-buffered bytes.
    spool.close()
    sessions.remove(spool.token, spool)
  }
  fun release(token: String) {
    val spool = sessions.remove(token) ?: return
    spool.uri?.let(TrustedMediaRegistry::revoke)
    spool.close()
  }
  fun copySnapshot(token: String, operation: BdixOperation): Map<String, Any> {
    val spool = get(token)
    if (spool.metadata.container != "mp4") fail("unsupported", "snapshot-container-unsupported")
    if (spool.state != "complete" || spool.available != spool.metadata.size || spool.sha256 == null) fail("unsupported", "snapshot-not-complete")
    val outputRoot = File(context.filesDir, "cinetor-bdix-snapshots").apply { mkdirs() }
    // Copy is a separate immutable completed object, not an append/resume target.
    if (outputRoot.usableSpace < spool.metadata.size + 16 * 1024 * 1024) fail("storage", "insufficient-snapshot-space")
    val destination = File.createTempFile("copy-", ".partial", outputRoot)
    val completed = File(destination.path.removeSuffix(".partial") + ".mp4")
    try {
      val hash = MessageDigest.getInstance("SHA-256")
      var total = 0L
      val input = spool.reader(RandomAccessFile(spool.file, "r"))
      try {
        input.use { source ->
          FileOutputStream(destination, false).use { output ->
            val buffer = ByteArray(65536)
            while (true) {
              operation.check(); scopeValid(spool.scope); spool.check()
              val count = source.read(buffer)
              if (count < 0) break
              total += count
              if (total > spool.metadata.size) fail("size", "snapshot-size-mismatch")
              output.write(buffer, 0, count); hash.update(buffer, 0, count)
            }
            output.fd.sync()
          }
        }
      } finally { spool.untrack(input) }
      val digest = hash.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
      if (total != spool.metadata.size || digest != spool.sha256) fail("scope", "snapshot-identity-mismatch")
      operation.check(); scopeValid(spool.scope); spool.check()
      if (!destination.renameTo(completed)) fail("storage", "snapshot-commit-failed")
      operation.check()
      return mapOf("uri" to completed.toURI().toString(), "sizeBytes" to total, "sha256" to digest, "mimeType" to "video/mp4")
    } catch (error: Throwable) { destination.delete(); completed.delete(); throw error }
  }
  fun discardUnpublishedSnapshot(uri: String) {
    val file = File(java.net.URI(uri)).canonicalFile
    val root = File(context.filesDir, "cinetor-bdix-snapshots").canonicalFile
    if (file.parentFile == root && file.name.startsWith("copy-") && file.extension == "mp4") file.delete()
  }
  fun invalidate() { sessions.keys.toList().forEach(::release) }
  override fun close() { invalidate(); if (proxyDelegate.isInitialized()) proxy.close(); transferPool.shutdownNow() }
}

/** Optional native-to-native trust handoff, never exposed as a JS URL allowlist. */
internal object TrustedMediaRegistry {
  private fun call(method: String, uri: String) {
    try { Class.forName("expo.modules.cinetormedia.TrustedLoopbackSources").getMethod(method, String::class.java).invoke(null, uri) }
    catch (_: ClassNotFoundException) { /* Standalone Expo playback does not need the download registry. */ }
  }
  fun register(uri: String) = call("register", uri)
  fun revoke(uri: String) { runCatching { call("revoke", uri) } }
}
