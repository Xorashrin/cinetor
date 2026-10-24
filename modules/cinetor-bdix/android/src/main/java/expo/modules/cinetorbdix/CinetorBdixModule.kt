package expo.modules.cinetorbdix

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Closeable
import java.net.SocketTimeoutException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.FutureTask
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class CinetorBdixModule : Module() {
  private val generation = AtomicLong(0)
  @Volatile private var endpoints: Map<String, ApprovedEndpoint> = emptyMap()
  private val operations = ConcurrentHashMap<String, BdixOperation>()
  private val cancelled = linkedSetOf<String>()
  private val admission = Any()
  private val workers = ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, ArrayBlockingQueue(16),
    { task -> Thread(task, "bdix-request").apply { isDaemon = true } }, ThreadPoolExecutor.AbortPolicy())
  private val selectedDelegate = lazy {
    SelectedNetwork(requireContext()) {
      invalidate()
      sendEvent("onNetworkContext", emptyMap<String, Any>())
    }
  }
  private val selected: SelectedNetwork get() = selectedDelegate.value
  private val storeDelegate = lazy { SpoolStore(requireContext(), selected::check) }
  private val store: SpoolStore get() = storeDelegate.value
  private fun requireContext() = appContext.reactContext ?: fail("configuration", "android-context-unavailable")

  override fun definition() = ModuleDefinition {
    Name("CinetorBdix")
    Events("onNetworkContext")
    Constants("sourceVersion" to "1.0.0", "sourceSha256" to BuildConfig.BDIX_SOURCE_SHA256)

    AsyncFunction("configure") { json: String, promise: Promise ->
      try {
        val next = PathPolicy.parseEndpoints(json)
        synchronized(admission) {
          invalidate()
          endpoints = next
        }
        promise.resolve(null)
      } catch (error: Throwable) { reject(promise, error) }
    }
    AsyncFunction("getNetworks") { promise: Promise -> try { promise.resolve(selected.list()) } catch (error: Throwable) { reject(promise, error) } }
    AsyncFunction("selectNetwork") { id: String, promise: Promise -> try { promise.resolve(selected.select(id).toMap()) } catch (error: Throwable) { reject(promise, error) } }
    AsyncFunction("getNetworkContext") { promise: Promise -> try { promise.resolve(selected.current()?.toMap()) } catch (error: Throwable) { reject(promise, error) } }

    AsyncFunction("list") { id: String, endpointId: String, value: String, maxBytes: Int, maxItems: Int, promise: Promise ->
      request(id, promise) { operation, scope ->
        val endpoint = endpoint(endpointId)
        val uri = endpoint.contain(value, pagination = true)
        if (maxBytes !in 1..Limits.PAGE_BYTES || maxItems !in 1..Limits.ITEMS) fail("configuration", "invalid-listing-limits")
        when (uri.scheme) {
          "http", "https" -> HttpTransport.list(endpoint, scope, operation, uri, maxBytes)
          else -> FtpTransport.list(endpoint, scope, operation, uri, maxBytes, maxItems)
        }
      }
    }
    AsyncFunction("probe") { id: String, endpointId: String, value: String, promise: Promise ->
      request(id, promise) { operation, scope ->
        val endpoint = endpoint(endpointId)
        val uri = endpoint.pinned(value)
        val result = if (uri.scheme in setOf("http", "https")) HttpTransport.probe(endpoint, scope, operation, uri) else FtpTransport.probe(endpoint, scope, operation, uri)
        result.toMap(scope)
      }
    }
    AsyncFunction("preparePlayback") { id: String, endpointId: String, value: String, maxBytes: Double, promise: Promise ->
      request(id, promise, retain = true) { operation, scope ->
        if (!maxBytes.isFinite() || maxBytes != maxBytes.toLong().toDouble() || maxBytes < 16 || maxBytes > Limits.FILE_BYTES) fail("configuration", "invalid-file-limit")
        val endpoint = endpoint(endpointId)
        val uri = endpoint.pinned(value)
        val remote = if (uri.scheme in setOf("http", "https")) HttpTransport.stream(endpoint, scope, operation, uri) else FtpTransport.stream(endpoint, scope, operation, uri)
        val spool = try { store.prepare(remote, scope, operation, maxBytes.toLong()) } catch (error: Throwable) { remote.close(); throw error }
        // Retain this rollback with the spool's operation, including a late JS cancellation.
        operation.track(Closeable { store.release(spool.token) })
        try {
          val result = store.publish(spool)
          operation.check()
          result
        } catch (error: Throwable) { store.release(spool.token); throw error }
      }
    }
    AsyncFunction("transferStatus") { token: String, promise: Promise -> try { promise.resolve(store.status(token)) } catch (error: Throwable) { reject(promise, error) } }
    AsyncFunction("copySnapshot") { id: String, token: String, promise: Promise ->
      request(id, promise, rollback = { value -> (value as? Map<*, *>)?.get("uri")?.let { uri -> store.discardUnpublishedSnapshot(uri.toString()) } }) { operation, _ ->
        store.copySnapshot(token, operation)
      }
    }
    AsyncFunction("release") { token: String, promise: Promise ->
      try { if (storeDelegate.isInitialized()) store.release(token); promise.resolve(null) } catch (error: Throwable) { reject(promise, error) }
    }
    Function("cancel") { id: String ->
      synchronized(admission) {
        operations[id]?.cancel() ?: synchronized(cancelled) {
          if (cancelled.size >= 256) cancelled.remove(cancelled.first())
          cancelled.add(id)
        }
      }
    }
    OnDestroy {
      invalidate()
      if (storeDelegate.isInitialized()) store.close()
      if (selectedDelegate.isInitialized()) selected.close()
      workers.shutdownNow()
    }
  }
  private fun endpoint(id: String): ApprovedEndpoint = endpoints[id]?.also { it.requireEnabled() } ?: fail("permission", "endpoint-not-approved")
  private fun invalidate() {
    synchronized(admission) {
      generation.incrementAndGet()
      operations.values.toList().forEach { it.cancel("context-invalidated") }
      if (storeDelegate.isInitialized()) store.invalidate()
    }
  }
  private fun reject(promise: Promise, error: Throwable) {
    val failure = when (error) {
      is BdixFailure -> error
      is SocketTimeoutException -> BdixFailure("timeout", "socket-timeout")
      is javax.net.ssl.SSLException -> BdixFailure("permission", "tls-verification-failed")
      is SecurityException -> BdixFailure("permission", "network-permission-required")
      is org.json.JSONException -> BdixFailure("configuration", "invalid-endpoints")
      else -> BdixFailure("network", "native-operation-failed")
    }
    // Do not pass server responses, source URLs, or exception traces into the JS diagnostics.
    promise.reject("ERR_BDIX_${failure.kind.uppercase()}", failure.reason, null)
  }
  private fun request(id: String, promise: Promise, retain: Boolean = false, rollback: (Any) -> Unit = {}, action: (BdixOperation, NetworkScope) -> Any) {
    var operation: BdixOperation? = null
    try {
      if (!Regex("[A-Za-z0-9_-]{1,100}").matches(id)) fail("configuration", "invalid-request-id")
      val scope: NetworkScope
      val admitted: BdixOperation
      synchronized(admission) {
        if (operations.size >= 20) fail("rate-limit", "native-request-limit")
        if (operations.containsKey(id)) fail("configuration", "duplicate-request-id")
        synchronized(cancelled) { if (cancelled.remove(id)) fail("cancelled", "cancelled") }
        scope = selected.requireCurrent()
        val version = generation.get()
        admitted = BdixOperation(id) {
          if (generation.get() != version) fail("cancelled", "consent-changed")
          selected.check(scope)
        }
        operations[id] = admitted
        operation = admitted
        admitted.timer = NetworkIo.deadlines.schedule({ admitted.cancel("timeout") }, Limits.BATCH_MS, TimeUnit.MILLISECONDS)
      }
      // Cancellation completes queued requests promptly and closes active I/O before rejecting.
      val started = AtomicBoolean(false)
      val settled = AtomicBoolean(false)
      lateinit var cancellation: Closeable
      val task = FutureTask<Unit>(java.util.concurrent.Callable {
        started.set(true)
        var success = false
        var result: Any? = null
        try {
          admitted.check()
          val value = action(admitted, scope)
          result = value
          admitted.check()
          if (settled.compareAndSet(false, true)) { promise.resolve(value); success = true }
        } catch (error: Throwable) {
          val reason = try { admitted.check(); error } catch (cancelled: Throwable) { cancelled }
          if (settled.compareAndSet(false, true)) reject(promise, reason)
        } finally {
          admitted.untrack(cancellation)
          operations.remove(id, admitted)
          if (!success) result?.let { runCatching { rollback(it) } }
          if (!retain || !success) admitted.close()
        }
      })
      cancellation = Closeable {
        task.cancel(true)
        if (!started.get()) workers.remove(task)
        operations.remove(id, admitted)
        if (settled.compareAndSet(false, true)) {
          val reason = try { admitted.check(); BdixFailure("cancelled", "cancelled") } catch (error: Throwable) { error }
          reject(promise, reason)
        }
      }
      admitted.track(cancellation)
      try { workers.execute(task) } catch (error: Throwable) { admitted.untrack(cancellation); throw error }
    } catch (error: Throwable) {
      operation?.let { operations.remove(id, it); it.close() }
      if (error is RejectedExecutionException) reject(promise, BdixFailure("rate-limit", "native-request-limit")) else reject(promise, error)
    }
  }
}
