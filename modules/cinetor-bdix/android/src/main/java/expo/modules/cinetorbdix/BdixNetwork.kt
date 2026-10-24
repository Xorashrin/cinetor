package expo.modules.cinetorbdix

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.SystemClock
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Future
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.SocketFactory

internal data class NetworkScope(val network: Network, val epoch: Long) {
  fun toMap(): Map<String, Any> = mapOf("id" to network.networkHandle.toString(), "epoch" to epoch, "transport" to "wifi")
}

/** Selection is explicit; a lost or changed route is never replaced by cellular or a VPN. */
internal class SelectedNetwork(context: Context, private val invalidate: () -> Unit) : Closeable {
  private val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private var epoch = 0L
  private var selected: Network? = null
  private var capabilityKey: String? = null
  private var linkKey: String? = null
  private var registered = false
  private val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onLost(network: Network) = changed(network)
    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
      val different = synchronized(this@SelectedNetwork) { selected == network && capabilityKey != capabilities.toString() }
      if (different) changed(network)
    }
    override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
      val different = synchronized(this@SelectedNetwork) { selected == network && linkKey != properties.toString() }
      if (different) changed(network)
    }
    override fun onBlockedStatusChanged(network: Network, blocked: Boolean) { if (blocked) changed(network) }
  }
  private fun eligible(network: Network): Boolean = manager.getNetworkCapabilities(network)?.let {
    it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) && it.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
  } == true
  @Synchronized fun list(): List<Map<String, Any>> = manager.allNetworks.filter(::eligible).map {
    mapOf("id" to it.networkHandle.toString(), "label" to "Wi-Fi network ${it.networkHandle}", "selected" to (it == selected))
  }
  fun select(id: String): NetworkScope {
    val value = synchronized(this) {
      val network = manager.allNetworks.firstOrNull { it.networkHandle.toString() == id && eligible(it) } ?: fail("offline", "selected-wifi-unavailable")
      if (!registered) {
        manager.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_TRUSTED).build(), callback)
        registered = true
      }
      epoch++; selected = network
      capabilityKey = manager.getNetworkCapabilities(network)?.toString()
      linkKey = manager.getLinkProperties(network)?.toString()
      NetworkScope(network, epoch)
    }
    invalidate()
    return value
  }
  @Synchronized fun current(): NetworkScope? = selected?.takeIf {
    eligible(it) && manager.getNetworkCapabilities(it)?.toString() == capabilityKey && manager.getLinkProperties(it)?.toString() == linkKey
  }?.let { NetworkScope(it, epoch) }
  fun requireCurrent(): NetworkScope = current() ?: fail("offline", "select-wifi-network")
  fun check(scope: NetworkScope) {
    val valid = synchronized(this) {
      selected == scope.network && epoch == scope.epoch && eligible(scope.network) &&
        manager.getNetworkCapabilities(scope.network)?.toString() == capabilityKey && manager.getLinkProperties(scope.network)?.toString() == linkKey
    }
    if (!valid) fail("cancelled", "network-context-changed")
  }
  private fun changed(network: Network) {
    val notify = synchronized(this) {
      if (selected != network) false else { selected = null; epoch++; capabilityKey = null; linkKey = null; true }
    }
    if (notify) invalidate()
  }
  override fun close() {
    synchronized(this) {
      if (registered) { runCatching { manager.unregisterNetworkCallback(callback) }; registered = false }
      selected = null; epoch++
    }
    invalidate()
  }
}

/** Cancels sockets, DNS futures, and queued work, rather than only rejecting a JS promise. */
internal class BdixOperation(val id: String, private val valid: () -> Unit) : Closeable {
  private val stopped = AtomicBoolean(false)
  private val resources = ConcurrentHashMap.newKeySet<Closeable>()
  @Volatile private var reason = "cancelled"
  @Volatile private var expires = SystemClock.elapsedRealtime() + Limits.BATCH_MS
  @Volatile var timer: ScheduledFuture<*>? = null
  fun check() {
    if (stopped.get()) fail(if (reason == "timeout") "timeout" else "cancelled", reason)
    if (SystemClock.elapsedRealtime() > expires) fail("timeout", "timeout")
    valid()
  }
  fun <T : Closeable> track(value: T): T {
    val accepted = synchronized(this) { if (stopped.get()) false else { resources.add(value); true } }
    if (!accepted) { runCatching { value.close() }; check() }
    return value
  }
  fun untrack(value: Closeable) { resources.remove(value) }
  fun trackFuture(value: Future<*>): Closeable = track(Closeable { value.cancel(true) })
  fun extendTransfer() { check(); expires = SystemClock.elapsedRealtime() + Limits.SESSION_MS; timer?.cancel(false); timer = null }
  fun cancel(why: String = "cancelled") {
    val closing = synchronized(this) {
      if (!stopped.compareAndSet(false, true)) return
      reason = why; timer?.cancel(false)
      resources.toList().also { resources.clear() }
    }
    // Resource cleanup can call back into a spool. Never close while holding this lock.
    closing.forEach { runCatching { it.close() } }
  }
  override fun close() = cancel()
}

internal object NetworkIo {
  // Bounded DNS workers: an Android resolver call that ignores interruption cannot grow the pool.
  private val dns = java.util.concurrent.ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS,
    java.util.concurrent.ArrayBlockingQueue(4), { runnable -> Thread(runnable, "bdix-dns").apply { isDaemon = true } }, java.util.concurrent.ThreadPoolExecutor.AbortPolicy())
  val deadlines = java.util.concurrent.ScheduledThreadPoolExecutor(2,
    { runnable -> Thread(runnable, "bdix-deadlines").apply { isDaemon = true } }).apply { removeOnCancelPolicy = true }
  fun resolve(host: String, scope: NetworkScope, operation: BdixOperation): InetAddress {
    operation.check()
    val future = try { dns.submit<Array<InetAddress>> { scope.network.getAllByName(host.removeSurrounding("[", "]")) } }
    catch (_: java.util.concurrent.RejectedExecutionException) { fail("rate-limit", "dns-pool-full") }
    val cancel = operation.trackFuture(future)
    return try {
      val addresses = future.get(Limits.CONNECT_MS.toLong(), TimeUnit.MILLISECONDS)
      operation.check()
      // No loopback/multicast destinations. Private and public unicast remain per-endpoint opt-in.
      addresses.firstOrNull { !it.isAnyLocalAddress && !it.isLoopbackAddress && !it.isMulticastAddress } ?: fail("scope", "invalid-server-address")
    } catch (_: java.util.concurrent.TimeoutException) { future.cancel(true); fail("timeout", "dns-timeout") }
    finally { operation.untrack(cancel); if (!future.isDone) future.cancel(true) }
  }
}

/** Every FTP control/data socket is bound before connect; no process-wide bind is used. */
internal class BoundSocketFactory(private val scope: NetworkScope, private val operation: BdixOperation) : SocketFactory() {
  override fun createSocket(): Socket {
    operation.check()
    return operation.track(scope.network.socketFactory.createSocket()).apply { soTimeout = Limits.READ_MS }
  }
  override fun createSocket(host: String, port: Int): Socket = createSocket().apply { connect(InetSocketAddress(NetworkIo.resolve(host, scope, operation), port), Limits.CONNECT_MS) }
  override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket = createSocket().apply {
    bind(InetSocketAddress(local, localPort)); connect(InetSocketAddress(NetworkIo.resolve(host, scope, operation), port), Limits.CONNECT_MS)
  }
  override fun createSocket(address: InetAddress, port: Int): Socket = createSocket().apply { connect(InetSocketAddress(address, port), Limits.CONNECT_MS) }
  override fun createSocket(address: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket = createSocket().apply {
    bind(InetSocketAddress(local, localPort)); connect(InetSocketAddress(address, port), Limits.CONNECT_MS)
  }
}
