package expo.modules.cinetormedia

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import androidx.core.app.NotificationManagerCompat
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.StreamKey
import androidx.media3.database.DatabaseProvider
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.FileDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.ContentMetadata
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.common.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.offline.DefaultDownloadIndex
import androidx.media3.exoplayer.offline.DefaultDownloaderFactory
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadHelper
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.offline.Downloader
import androidx.media3.exoplayer.offline.DownloaderFactory
import androidx.media3.exoplayer.scheduler.Requirements
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
internal class MediaEngine private constructor(val context: Context) {
  companion object {
    const val STOP_PAUSED = 1
    private var instance: MediaEngine? = null
    fun get(context: Context): MediaEngine {
      check(Looper.myLooper() == Looper.getMainLooper())
      // Media3 diagnostic exceptions can contain signed URLs. The bridge emits sanitized errors.
      Log.setLogLevel(Log.LOG_LEVEL_OFF)
      return instance ?: MediaEngine(context.applicationContext).also { instance = it }
    }
    fun mime(container: String): String = when (container) {
      "hls" -> MimeTypes.APPLICATION_M3U8
      "dash" -> MimeTypes.APPLICATION_MPD
      "mkv" -> MimeTypes.VIDEO_MATROSKA
      "webm" -> MimeTypes.VIDEO_WEBM
      else -> MimeTypes.VIDEO_MP4
    }
    fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  val handler = Handler(Looper.getMainLooper())
  val store = PrivateMediaStore(context)
  private val dbHelper = object : SQLiteOpenHelper(context, File(store.root, "media3.db").absolutePath, null, 1) {
    override fun onCreate(db: SQLiteDatabase) { }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) { }
  }
  private val database = object : DatabaseProvider {
    override fun getWritableDatabase(): SQLiteDatabase = dbHelper.writableDatabase
    override fun getReadableDatabase(): SQLiteDatabase = dbHelper.readableDatabase
  }
  val cache = SimpleCache(File(store.root, "cache"), NoOpCacheEvictor(), database)
  private val index = DefaultDownloadIndex(database, "cinetor")
  private val sessions = ConcurrentHashMap<String, SourceSession>()
  private val listeners = mutableSetOf<(Map<String, Any?>) -> Unit>()
  private val cleanupExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
  private val staged = ConcurrentHashMap<String, Pair<String, Long>>()
  val manager: DownloadManager
  @Volatile private var wifiOnly = store.wifiOnly
  @Volatile private var verifiedFiles: Map<String, Long> = emptyMap()

  init {
    // Media3 normally resumes queued bytes. Do not let it do so without an immutable persisted
    // representation: all incomplete entries are stopped BEFORE constructing the manager.
    index.getDownloads().use { cursor ->
      while (cursor.moveToNext()) {
        val download = cursor.download
        if (!download.isTerminalState) {
          index.putDownload(Download(download.request, Download.STATE_STOPPED, download.startTimeMs,
            System.currentTimeMillis(), download.contentLength, STOP_PAUSED, Download.FAILURE_REASON_NONE))
        }
      }
    }
    store.records.values.forEach { record ->
      if (record.status == "queued" || record.status == "downloading") {
        record.status = "paused"; record.errorCode = "interrupted"
        record.error = "Download interrupted. Restart begins from zero."; record.updatedAt = System.currentTimeMillis()
        record.bytes = 0; record.total = -1; record.progress = null; record.progressKind = "indeterminate"
      }
      if (record.status != "downloaded") {
        record.bytes = 0; record.total = -1; record.progress = null; record.progressKind = "indeterminate"
      }
      if (record.status == "downloaded" && record.container == "mp4") validateCompletedFile(record)
    }
    store.save()
    updateVerifiedFiles()
    // Only completed representations survive a cold start. Sweep orphaned and interrupted
    // bytes before new transfers use distinct IDs; never walk outside private native storage.
    val keptIds = store.records.values.filter { it.status == "downloaded" }.map { it.id }.toSet()
    val orphanKeys = cache.keys.filter { it.substringBefore(':') !in keptIds }
    val orphanFiles = File(store.root, "exports").listFiles()?.filter { it.extension == "part" || it.nameWithoutExtension !in keptIds }.orEmpty()
    cleanupExecutor.execute {
      orphanKeys.forEach { key -> runCatching { cache.removeResource(key) } }
      orphanFiles.forEach { it.delete() }
    }
    manager = DownloadManager(context, index, DownloaderFactory { request ->
      PersistentDownloader(this, request.id)
    })
    manager.maxParallelDownloads = 2
    // No implicit partial-byte retries. A user restart creates a new representation/cache UUID.
    manager.minRetryCount = 0
    // Connectivity loss is a terminal attempt, not an implicit Media3 partial-byte resume.
    manager.setRequirements(Requirements(0))
    manager.addListener(object : DownloadManager.Listener {
      override fun onDownloadChanged(manager: DownloadManager, download: Download, finalException: Exception?) {
        val record = store.records.values.firstOrNull { it.id == download.request.id }
        if (record == null) {
          if (download.state != Download.STATE_REMOVING && download.state != Download.STATE_RESTARTING) manager.removeDownload(download.request.id)
          return
        }
        if (download.state == Download.STATE_REMOVING || download.state == Download.STATE_RESTARTING) return
        if (record.status == "paused") {
          if (download.state == Download.STATE_QUEUED || download.state == Download.STATE_DOWNLOADING) manager.setStopReason(record.id, STOP_PAUSED)
          if (download.state == Download.STATE_COMPLETED) {
            staged.remove(record.id)
            val stoppedId = record.id
            cleanupExecutor.execute { runCatching { removeResources(stoppedId) } }
          }
          return
        }
        when (download.state) {
          Download.STATE_DOWNLOADING -> record.status = "downloading"
          Download.STATE_QUEUED -> record.status = "queued"
          Download.STATE_STOPPED -> record.status = "paused"
          Download.STATE_COMPLETED -> {
            val complete = staged.remove(record.id)
            if (complete == null) {
              record.status = "failed"; record.errorCode = "verification_failed"
              record.error = "Offline media verification did not finish. Restart the download."
            } else {
              record.localUri = complete.first; record.bytes = complete.second; record.total = complete.second
              record.progress = 1.0; record.status = "downloaded"; record.error = null; record.errorCode = null
            }
            sessions.remove(record.id)
          }
          Download.STATE_FAILED -> {
            val failure = generateSequence<Throwable>(finalException) { it.cause }.filterIsInstance<MediaFailure>().firstOrNull()
            record.status = if (failure?.code == "wifi_required") "paused" else "failed"
            record.errorCode = failure?.code ?: "transfer_failed"
            record.error = failure?.message ?: "Download failed. Restart begins from zero."
            record.bytes = 0; record.total = -1; record.progress = null; record.progressKind = "indeterminate"
            sessions.remove(record.id)?.cancel()
            val failedId = record.id
            cleanupExecutor.execute { runCatching { removeResources(failedId) } }
          }
        }
        record.updatedAt = System.currentTimeMillis()
        store.save(); emit(record)
      }
      override fun onDownloadRemoved(manager: DownloadManager, download: Download) {
        sessions.remove(download.request.id)?.cancel(); staged.remove(download.request.id)
      }
    })
    val incompleteIds = store.records.values.filter { it.status != "downloaded" }.map { it.id }
    incompleteIds.forEach { manager.setStopReason(it, STOP_PAUSED) }
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    connectivity.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
      private fun checkPolicy() {
        if (wifiOnly && !MediaSafety.wifiConnected(context)) {
          sessions.values.forEach { it.reject(MediaFailure("wifi_required", "Wi-Fi disconnected. Restart begins from zero.")) }
          handler.post {
            if (!wifiOnly || MediaSafety.wifiConnected(context)) return@post
            store.records.values.toList().filter { it.status == "queued" || it.status == "downloading" }.forEach {
              pause(it.key)
              it.errorCode = "wifi_required"; it.error = "Wi-Fi disconnected. Restart begins from zero."
              emit(it)
            }
            store.save()
          }
        }
      }
      override fun onLost(network: Network) {
        sessions.values.forEach { it.reject(MediaFailure("connection_lost", "The connection changed. Restart begins from zero.")) }
        checkPolicy()
      }
      override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) = checkPolicy()
    })
  }

  fun listen(listener: (Map<String, Any?>) -> Unit) { listeners.add(listener) }
  fun unlisten(listener: (Map<String, Any?>) -> Unit) { listeners.remove(listener) }
  private fun updateVerifiedFiles() {
    verifiedFiles = store.records.values.filter { it.status == "downloaded" && it.container == "mp4" && it.localUri != null }
      .associate { store.exportFile(it.id).absolutePath to it.bytes }
  }
  private fun emit(record: MediaRecord, removed: Boolean = false) {
    updateVerifiedFiles()
    listeners.toList().forEach { it(record.publicMap(removed)) }
  }
  fun list(): List<Map<String, Any?>> = store.records.values.map { record ->
    if (record.status == "downloaded" && record.container == "mp4") validateCompletedFile(record)
    record.publicMap()
  }
  fun query(key: String): Map<String, Any?>? {
    val record = store.records[key] ?: return null
    if (record.status == "downloaded" && record.container == "mp4") {
      validateCompletedFile(record)
      if (record.status != "downloaded") { store.save(); emit(record) }
    }
    return record.publicMap()
  }

  fun queue(options: Map<String, Any?>, restart: Boolean = false): Map<String, Any?> {
    val key = options["key"] as? String ?: throw MediaFailure("invalid_key", "A profile-qualified download key is required")
    if (key.length !in 3..512 || !key.contains(':') || key.any { it.isISOControl() }) throw MediaFailure("invalid_key", "Invalid download key")
    query(key)
    val previous = store.records[key]
    if (!restart && previous?.status in setOf("queued", "downloading", "downloaded")) return previous!!.publicMap()
    val suppliedUrl = options["url"] as? String
    val url = suppliedUrl ?: previous?.url ?: throw MediaFailure("invalid_source", "Select a source before downloading")
    val checked = MediaSafety.checkedUrl(url)
    @Suppress("UNCHECKED_CAST")
    val suppliedHeaders = options["headers"] as? Map<String, String>
    // A replacement URL never inherits credentials from a previous source.
    val headers = MediaSafety.headers(suppliedHeaders ?: if (suppliedUrl == null) previous?.headers ?: emptyMap() else emptyMap())
    val headerOrigin = (options["headerOrigin"] as? String) ?: if (suppliedUrl == null) previous?.headerOrigin else null
    MediaSafety.credentialOrigin(headerOrigin, checked)
    val container = (options["container"] as? String) ?: (if (suppliedUrl == null) previous?.container else null)
      ?: when {
        checked.encodedPath.endsWith(".m3u8", true) -> "hls"
        checked.encodedPath.endsWith(".mpd", true) -> "dash"
        checked.encodedPath.endsWith(".mp4", true) -> "mp4"
        else -> throw MediaFailure("unsupported_format", "This source is not supported for offline downloads")
      }
    if (container !in setOf("mp4", "hls", "dash")) throw MediaFailure("unsupported_format", "Only MP4 and finite clear HLS/DASH can be saved offline")
    if (wifiOnly && !MediaSafety.wifiConnected(context)) throw MediaFailure("wifi_required", "Connect to Wi-Fi before downloading")
    MediaSafety.checkSpace(context)
    if (previous?.status == "downloaded") throw MediaFailure("already_saved", "Delete the saved copy before replacing it")
    if (previous == null && store.records.size >= 500) throw MediaFailure("queue_limit", "Remove an old download before adding another")
    val record = MediaRecord(key = key, url = checked.toString(), headers = headers, container = container, headerOrigin = headerOrigin)
    if (previous != null) {
      sessions[previous.id]?.cancel()
      manager.removeDownload(previous.id)
    }
    store.records[key] = record
    store.save()
    // Only an opaque ID goes into Media3's SQLite index and Android service intent.
    val request = DownloadRequest.Builder(record.id, Uri.parse("cinetor-source://${record.id}"))
      .setMimeType(mime(container)).build()
    try {
      DownloadService.sendAddDownload(context, CinetorDownloadService::class.java, request, true)
    } catch (_: Exception) {
      record.status = "paused"; record.errorCode = "foreground_required"
      record.error = "Open the app to start this download. Android blocked background work."
      record.updatedAt = System.currentTimeMillis(); store.save(); emit(record)
      return record.publicMap()
    }
    emit(record)
    return record.publicMap()
  }

  fun pause(key: String): Map<String, Any?>? {
    val record = store.records[key] ?: return null
    if (record.status == "downloaded") return record.publicMap()
    sessions[record.id]?.cancel()
    record.status = "paused"; record.errorCode = "paused"; record.error = "Download paused. Restart begins from zero."
    record.bytes = 0; record.total = -1; record.progress = null; record.progressKind = "indeterminate"
    record.updatedAt = System.currentTimeMillis()
    manager.setStopReason(record.id, STOP_PAUSED)
    store.save(); emit(record)
    return record.publicMap()
  }

  fun pauseAll(message: String) {
    store.records.values.filter { it.status == "queued" || it.status == "downloading" }.forEach {
      pause(it.key); it.error = message; it.errorCode = "platform_limit"; emit(it)
    }
    store.save()
  }

  fun cancelAttempt(key: String, id: String) {
    if (store.records[key]?.id == id) delete(key)
  }

  fun delete(key: String) {
    val record = store.records.remove(key) ?: return
    sessions[record.id]?.cancel()
    store.save()
    record.status = "failed"; record.errorCode = "canceled"; record.error = "Download canceled"; record.updatedAt = System.currentTimeMillis()
    emit(record, true)
    // Downloader.remove executes after the writer has stopped; never remove a live cache span.
    manager.removeDownload(record.id)
  }

  fun setPolicy(value: Boolean) {
    wifiOnly = value; store.wifiOnly = value; store.save()
    if (value && !MediaSafety.wifiConnected(context)) store.records.values.toList().forEach {
      if (it.status == "queued" || it.status == "downloading") pause(it.key)
    }
  }

  fun storageInfo(): Map<String, Any> {
    val stat = StatFs(store.root.absolutePath)
    val exports = File(store.root, "exports").listFiles()?.sumOf { it.length() } ?: 0L
    val legacy = File(context.filesDir, "downloads").walkTopDown().maxDepth(3).filter { it.isFile }.sumOf { it.length() }
    return mapOf("freeBytes" to stat.availableBytes, "totalBytes" to stat.totalBytes,
      "usedBytes" to cache.cacheSpace + exports + legacy, "reservedBytes" to MediaSafety.RESERVE_BYTES)
  }
  fun capabilities(): Map<String, Any> = mapOf("available" to true, "platform" to "android", "maxParallelDownloads" to 2,
    "perHostLimit" to 1, "notificationsAllowed" to NotificationManagerCompat.from(context).areNotificationsEnabled())

  private fun validateCompletedFile(record: MediaRecord) {
    val file = store.exportFile(record.id)
    if (!file.isFile || file.length() != record.bytes || record.bytes < 16) {
      record.status = "failed"; record.localUri = null; record.errorCode = "missing_file"; record.error = "The saved video is missing or incomplete"
    }
  }

  /** Only verified native exports or the original app-private downloads directory are accepted. */
  fun allowedFile(uri: String): File {
    val parsed = Uri.parse(uri)
    if (parsed.scheme != "file" || !parsed.authority.isNullOrEmpty() || parsed.query != null || parsed.fragment != null) throw MediaFailure("unsafe_file", "Only private offline files can be opened")
    val file = File(parsed.path ?: "").canonicalFile
    val legacy = File(context.filesDir, "downloads").canonicalFile
    val native = File(store.root, "exports").canonicalFile
    val insideLegacy = file.path.startsWith(legacy.path + File.separator)
    val insideNative = file.path.startsWith(native.path + File.separator) && verifiedFiles[file.absolutePath] == file.length()
    if ((!insideLegacy && !insideNative) || !file.isFile) throw MediaFailure("missing_file", "The private offline file is unavailable")
    return file
  }

  fun deleteLocalFile(uri: String) {
    if (uri.startsWith("cinetor-offline://")) {
      offlineRecord(uri)?.let { delete(it.key) }
      return
    }
    store.records.values.firstOrNull { it.localUri == uri }?.let { delete(it.key); return }
    val file = allowedFile(uri)
    if (file.name == "index.m3u8" && file.parentFile?.name?.endsWith("-hls") == true) {
      if (!file.parentFile!!.deleteRecursively()) throw MediaFailure("delete_failed", "The offline folder could not be removed")
    } else if (!file.delete()) throw MediaFailure("delete_failed", "The offline file could not be removed")
  }

  fun offlineRecord(uri: String): MediaRecord? {
    val parsed = Uri.parse(uri)
    if (parsed.scheme != "cinetor-offline" || parsed.host != "download" || parsed.query != null || parsed.fragment != null) return null
    val id = parsed.path?.removePrefix("/") ?: return null
    return store.records.values.firstOrNull { it.id == id && it.status == "downloaded" }
  }

  fun cacheFactory(id: String, session: SourceSession? = null): CacheDataSource.Factory = CacheDataSource.Factory()
    .setCache(cache)
    .setCacheKeyFactory { dataSpec -> "$id:${hash(dataSpec.uri.toString())}" }
    .setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE)
    .apply {
      if (session == null) { setUpstreamDataSourceFactory(null); setCacheWriteDataSinkFactory(null) }
      else setUpstreamDataSourceFactory(SafeHttpDataSource.Factory(session))
    }

  fun mediaItem(record: MediaRecord): MediaItem = MediaItem.Builder().setUri(record.url).setMimeType(mime(record.container))
    .setStreamKeys(record.streamKeys.map { StreamKey(it.first, it.second, it.third) }).build()

  fun privateFileFactory(): DataSource.Factory = DataSource.Factory {
    object : DataSource {
      private val fileSource = FileDataSource()
      override fun addTransferListener(listener: androidx.media3.datasource.TransferListener) = fileSource.addTransferListener(listener)
      override fun open(dataSpec: DataSpec): Long {
        allowedFile(dataSpec.uri.toString())
        return fileSource.open(dataSpec)
      }
      override fun read(buffer: ByteArray, offset: Int, length: Int) = fileSource.read(buffer, offset, length)
      override fun getUri(): Uri? = fileSource.uri
      override fun close() = fileSource.close()
    }
  }

  private fun record(id: String): MediaRecord = onMain {
    store.records.values.firstOrNull { it.id == id }?.copy() ?: throw MediaFailure("canceled", "Download canceled")
  }

  private fun <T> onMain(block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) return block()
    val latch = CountDownLatch(1)
    var value: T? = null
    var failure: Throwable? = null
    handler.post { try { value = block() } catch (error: Throwable) { failure = error } finally { latch.countDown() } }
    if (!latch.await(30, TimeUnit.SECONDS)) throw MediaFailure("native_timeout", "Native media did not respond")
    failure?.let { throw it }
    @Suppress("UNCHECKED_CAST") return value as T
  }

  private fun removeResources(id: String) {
    cache.keys.filter { it.startsWith("$id:") }.forEach { cache.removeResource(it) }
    store.temporaryFile(id).delete(); store.exportFile(id).delete()
  }

  private class PersistentDownloader(private val engine: MediaEngine, private val id: String) : Downloader {
    private val canceled = AtomicBoolean(false)
    @Volatile private var delegate: Downloader? = null
    @Volatile private var session: SourceSession? = null
    @Volatile private var helper: DownloadHelper? = null
    private var lastProgressAt = 0L

    override fun download(listener: Downloader.ProgressListener?) {
      val record = engine.record(id)
      if (record.status !in setOf("queued", "downloading")) throw InterruptedIOException("Download is not active")
      val source = SourceSession(engine.context, record.url, record.headers, record.headerOrigin, download = true,
        container = record.container, wifiOnly = { engine.wifiOnly })
      session = source; engine.sessions[id] = source
      var promoted = false
      try {
        checkCanceled()
        val request = if (record.container == "mp4") DownloadRequest.Builder(id, Uri.parse(record.url)).setMimeType(MimeTypes.VIDEO_MP4).build()
          else prepare(record, source)
        checkCanceled()
        engine.onMain {
          engine.store.records[record.key]?.takeIf { it.id == id }?.let {
            it.streamKeys = request.streamKeys.map { key -> Triple(key.periodIndex, key.groupIndex, key.streamIndex) }
            engine.store.save()
          }
        }
        val factory = DefaultDownloaderFactory(engine.cacheFactory(id, source), Executor { it.run() })
        delegate = factory.createDownloader(request)
        delegate!!.download { total, downloaded, percent ->
          checkCanceled()
          listener?.onProgress(total, downloaded, percent)
          val now = System.currentTimeMillis()
          if (now - lastProgressAt >= 500) {
            lastProgressAt = now
            engine.handler.post {
              engine.store.records[record.key]?.takeIf { it.id == id && it.status in setOf("queued", "downloading") }?.let {
                it.bytes = downloaded
                it.total = if (record.container == "mp4") total else -1L
                it.progress = if (percent >= 0) minOf(0.99, percent / 100.0) else null
                it.progressKind = if (percent < 0) "indeterminate" else if (record.container == "mp4") "bytes" else "segments"
                it.updatedAt = now
                engine.emit(it)
              }
            }
          }
        }
        checkCanceled()
        // A second cache-only pass proves the selected manifests, media, and AES keys need no
        // network. A hole is an error, never permission to fall back to streaming.
        delegate = DefaultDownloaderFactory(engine.cacheFactory(id), Executor { it.run() }).createDownloader(request)
        delegate!!.download(null)
        source.check()
        checkCanceled()
        val result = if (record.container == "mp4") exportMp4(record, source) else {
          val bytes = engine.cache.keys.filter { it.startsWith("$id:") }.sumOf { key -> engine.cache.getCachedSpans(key).sumOf { it.length } }
          if (bytes <= 0) throw MediaFailure("empty_media", "The offline presentation is empty")
          "cinetor-offline://download/$id" to bytes
        }
        checkCanceled()
        engine.staged[id] = result
        promoted = true
      } finally {
        helper?.let { current -> engine.handler.post { current.release() } }; helper = null
        try { if (!promoted) engine.removeResources(id) } finally { source.cancel() }
      }
    }

    private fun prepare(record: MediaRecord, source: SourceSession): DownloadRequest {
      val latch = CountDownLatch(1)
      var request: DownloadRequest? = null
      var failure: IOException? = null
      engine.handler.post {
        if (canceled.get()) { latch.countDown(); return@post }
        try {
          val downloadHelper = DownloadHelper.Factory()
            .setDataSourceFactory(SafeHttpDataSource.Factory(source))
            .setRenderersFactory(DefaultRenderersFactory(engine.context))
            .setTrackSelectionParameters(DownloadHelper.DEFAULT_TRACK_SELECTOR_PARAMETERS)
            .create(engine.mediaItem(record))
          helper = downloadHelper
          downloadHelper.prepare(object : DownloadHelper.Callback {
            override fun onPrepared(helper: DownloadHelper, tracksInfoAvailable: Boolean) {
              try {
                source.check()
                if (!tracksInfoAvailable || helper.periodCount == 0) throw MediaFailure("unsupported_tracks", "This presentation has no supported offline tracks")
                for (period in 0 until helper.periodCount) {
                  val groups = helper.getTrackGroups(period)
                  for (group in 0 until groups.length) for (track in 0 until groups[group].length) {
                    if (groups[group].getFormat(track).drmInitData != null) throw MediaFailure("drm_unsupported", "DRM-protected media is not supported offline")
                  }
                  val mapped = helper.getMappedTrackInfo(period)
                  val hasSelectedVideo = (0 until mapped.rendererCount).any { renderer ->
                    mapped.getRendererType(renderer) == C.TRACK_TYPE_VIDEO && helper.getTrackSelections(period, renderer).isNotEmpty()
                  }
                  if (!hasSelectedVideo) throw MediaFailure("unsupported_tracks", "No supported video track is available for offline playback")
                }
                request = helper.getDownloadRequest(id, null)
              } catch (error: IOException) { failure = error }
              catch (_: Exception) { failure = MediaFailure("invalid_manifest", "The presentation could not be prepared") }
              finally { helper.release(); this@PersistentDownloader.helper = null; latch.countDown() }
            }
            override fun onPrepareError(helper: DownloadHelper, error: IOException) {
              failure = if (error is DownloadHelper.LiveContentUnsupportedException) MediaFailure("live_unsupported", "Live media cannot be saved offline") else error
              helper.release(); this@PersistentDownloader.helper = null; latch.countDown()
            }
          })
        } catch (error: Exception) {
          failure = if (error is IOException) error else MediaFailure("preparation_failed", "The media could not be prepared")
          latch.countDown()
        }
      }
      try {
        if (!latch.await(90, TimeUnit.SECONDS)) throw MediaFailure("preparation_timeout", "Media preparation timed out")
      } finally {
        helper?.let { current -> engine.handler.post { current.release() } }; helper = null
      }
      checkCanceled()
      failure?.let { throw it }
      return request ?: throw MediaFailure("preparation_failed", "The media could not be prepared")
    }

    private fun exportMp4(record: MediaRecord, source: SourceSession): Pair<String, Long> {
      val key = "$id:${hash(record.url)}"
      val length = ContentMetadata.getContentLength(engine.cache.getContentMetadata(key))
      val identity = source.identities[record.url]
      if (length < 16 || identity?.total?.let { it >= 0 && it != length } == true) throw MediaFailure("verification_failed", "Downloaded media length did not match the representation")
      MediaSafety.checkSpace(engine.context, length)
      val temp = engine.store.temporaryFile(id)
      val destination = engine.store.exportFile(id)
      val dataSource = engine.cacheFactory(id).createDataSource()
      var bytes = 0L
      try {
        dataSource.open(DataSpec.Builder().setUri(record.url).build())
        FileOutputStream(temp).use { output ->
          val buffer = ByteArray(128 * 1024)
          while (true) {
            checkCanceled(); source.check(); MediaSafety.checkSpace(engine.context)
            val count = dataSource.read(buffer, 0, buffer.size)
            if (count == C.RESULT_END_OF_INPUT) break
            output.write(buffer, 0, count); bytes += count
          }
          output.fd.sync()
        }
        val header = ByteArray(16)
        val read = FileInputStream(temp).use { it.read(header) }
        if (read != 16 || header.copyOfRange(4, 8).toString(Charsets.US_ASCII) != "ftyp" || bytes != length || temp.length() != length) {
          throw MediaFailure("verification_failed", "The completed file is not a verified MP4 video")
        }
        checkCanceled()
        val extractor = MediaExtractor()
        try {
          extractor.setDataSource(temp.absolutePath)
          if (!extractor.psshInfo.isNullOrEmpty()) throw MediaFailure("drm_unsupported", "DRM-protected media is not supported offline")
          var video = false
          for (track in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(track)
            if (format.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true) video = true
            if (format.containsKey("crypto-key") || format.containsKey("crypto-mode")) throw MediaFailure("drm_unsupported", "Encrypted media is not supported offline")
          }
          if (!video) throw MediaFailure("verification_failed", "The downloaded MP4 has no readable video track")
        } finally { extractor.release() }
        if (!temp.renameTo(destination)) throw MediaFailure("storage_failed", "The private video could not be saved")
        // The verified private file is the direct download, so do not retain a second cached copy.
        engine.cache.removeResource(key)
        return Uri.fromFile(destination).toString() to bytes
      } finally { dataSource.close(); temp.delete() }
    }

    private fun checkCanceled() {
      if (canceled.get() || Thread.currentThread().isInterrupted) throw InterruptedIOException("Download stopped")
    }
    override fun cancel() { canceled.set(true); session?.cancel(); delegate?.cancel(); helper?.let { current -> engine.handler.post { current.release() } } }
    override fun remove() { engine.removeResources(id) }
  }
}
