package expo.modules.cinetormedia

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OfflineVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true
  val onFirstFrame by EventDispatcher<Map<String, Any?>>()
  val onTimeUpdate by EventDispatcher<Map<String, Any?>>()
  val onState by EventDispatcher<Map<String, Any?>>()
  val onEnd by EventDispatcher<Map<String, Any?>>()
  val onTracks by EventDispatcher<Map<String, Any?>>()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val playerView = PlayerView(context).apply {
    useController = false
    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
    setShutterBackgroundColor(Color.BLACK)
    setBackgroundColor(Color.BLACK)
    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
  }
  private var player: ExoPlayer? = null
  private var session: SourceSession? = null
  private var requestedUri: String? = null
  private var requestedHeaders: Map<String, String> = emptyMap()
  private var requestedOrigin: String? = null
  private var requestedContainer: String? = null
  private var requestedSubtitles: List<Map<String, String>> = emptyList()
  private var requestedPaused = true
  private var requestedPosition: Double? = null
  private var requestedRate = 1.0
  private var audioTrack: String? = null
  private var subtitleTrack: String? = "off"
  private var videoTrack: String? = "auto"
  private var dirtySource = false
  private var attached = false
  private var firstFrame = false
  private var releasePosition = 0L
  private var periodic = false
  private val clock = object : Runnable {
    override fun run() {
      val current = player ?: return
      onTimeUpdate(mapOf("currentTime" to current.currentPosition.coerceAtLeast(0) / 1000.0,
        "duration" to if (current.duration > 0) current.duration / 1000.0 else 0.0))
      if (periodic) mainHandler.postDelayed(this, 500L)
    }
  }

  init { setBackgroundColor(Color.BLACK); addView(playerView) }

  fun setUri(value: String?) { if (requestedUri != value) { requestedUri = value; requestedPosition = requestedPosition ?: 0.0; dirtySource = true } }
  fun setHeaders(value: Map<String, String>?) { if (requestedHeaders != value.orEmpty()) { requestedHeaders = value.orEmpty(); dirtySource = true } }
  fun setHeaderOrigin(value: String?) { if (requestedOrigin != value) { requestedOrigin = value; dirtySource = true } }
  fun setContainer(value: String?) { if (requestedContainer != value) { requestedContainer = value; dirtySource = true } }
  fun setSubtitles(value: List<Map<String, String>>?) { if (requestedSubtitles != value.orEmpty()) { requestedSubtitles = value.orEmpty(); dirtySource = true } }
  fun setPaused(value: Boolean) { requestedPaused = value; player?.playWhenReady = !value && hasWindowFocus(); emitState() }
  fun setPosition(value: Double) {
    if (!value.isFinite() || value !in 0.0..604800.0) return
    requestedPosition = value
  }
  fun setRate(value: Double) {
    if (!value.isFinite() || value !in 0.25..3.0) return
    requestedRate = value; player?.setPlaybackSpeed(value.toFloat())
  }
  fun setAudioTrack(value: String?) { audioTrack = value; applyTracks() }
  fun setSubtitleTrack(value: String?) { subtitleTrack = value ?: "off"; applyTracks() }
  fun setVideoTrack(value: String?) { videoTrack = value ?: "auto"; applyTracks() }

  fun updateSource() {
    if (!attached) return
    if (!dirtySource && player != null) {
      requestedPosition?.let { player?.seekTo((it * 1000).toLong()); requestedPosition = null }
      return
    }
    releasePlayer()
    requestedPosition?.let { releasePosition = (it * 1000).toLong(); requestedPosition = null }
    val uri = requestedUri ?: return
    try {
      if (requestedContainer != null && requestedContainer !in setOf("mp4", "hls", "dash", "mkv", "webm")) throw MediaFailure("unsupported_format", "Unsupported playback container")
      val engine = MediaEngine.get(context)
      val factory: DefaultMediaSourceFactory
      val item: MediaItem
      when {
        uri.startsWith("cinetor-offline://") -> {
          if (requestedSubtitles.isNotEmpty()) throw MediaFailure("offline_only", "External captions are unavailable offline")
          val record = engine.offlineRecord(uri) ?: throw MediaFailure("missing_file", "This offline download is unavailable")
          factory = DefaultMediaSourceFactory(context).setDataSourceFactory(engine.cacheFactory(record.id))
          item = engine.mediaItem(record)
        }
        uri.startsWith("file:") -> {
          if (requestedSubtitles.isNotEmpty()) throw MediaFailure("offline_only", "External captions are unavailable offline")
          engine.allowedFile(uri)
          factory = DefaultMediaSourceFactory(context).setDataSourceFactory(engine.privateFileFactory())
          // Legacy local HLS also uses the restricted file-only source for every key/segment.
          item = MediaItem.Builder().setUri(uri).apply { requestedContainer?.let { setMimeType(MediaEngine.mime(it)) } }.build()
        }
        else -> {
          val source = SourceSession(context, uri, requestedHeaders, requestedOrigin, container = requestedContainer ?: "mp4")
          session = source
          factory = DefaultMediaSourceFactory(context).setDataSourceFactory(SafeHttpDataSource.Factory(source))
          item = MediaItem.Builder().setUri(uri).apply {
            requestedContainer?.let { setMimeType(MediaEngine.mime(it)) }
            if (requestedSubtitles.size > 32) throw MediaFailure("subtitle_limit", "Too many external caption tracks")
            setSubtitleConfigurations(requestedSubtitles.mapIndexed { index, row ->
              val caption = MediaSafety.checkedUrl(row["url"] ?: "")
              val mime = row["mimeType"] ?: when {
                caption.encodedPath.endsWith(".vtt", true) -> "text/vtt"
                caption.encodedPath.endsWith(".srt", true) -> "application/x-subrip"
                else -> throw MediaFailure("subtitle_format", "Unsupported external caption format")
              }
              if (mime !in setOf("text/vtt", "application/x-subrip", "application/ttml+xml")) throw MediaFailure("subtitle_format", "Unsupported external caption format")
              MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(caption.toString()))
                .setId("external-$index").setMimeType(mime).setLanguage(row["language"]?.take(64)).setLabel(row["label"]?.take(128)).build()
            })
          }.build()
        }
      }
      val current = ExoPlayer.Builder(context).setMediaSourceFactory(factory).build()
      player = current; playerView.player = current; firstFrame = false; dirtySource = false
      current.addListener(object : Player.Listener {
        override fun onRenderedFirstFrame() {
          if (!firstFrame && player === current) { firstFrame = true; onFirstFrame(emptyMap()) }
        }
        override fun onPlaybackStateChanged(state: Int) {
          if (player !== current) return
          emitState()
          if (state == Player.STATE_ENDED) onEnd(emptyMap())
        }
        override fun onIsPlayingChanged(isPlaying: Boolean) { if (player === current) emitState() }
        override fun onTracksChanged(tracks: Tracks) {
          if (player !== current) return
          if (tracks.groups.any { group -> (0 until group.length).any { group.getTrackFormat(it).drmInitData != null } }) {
            onState(mapOf("state" to "error", "error" to "DRM-protected playback is not supported"))
            current.stop(); return
          }
          reportTracks(tracks); applyTracks()
        }
        override fun onPlayerError(error: PlaybackException) {
          if (player !== current) return
          val failure = generateSequence<Throwable>(error) { it.cause }.filterIsInstance<MediaFailure>().firstOrNull()
          onState(mapOf("state" to "error", "error" to (failure?.message ?: "Media could not be played")))
        }
      })
      current.trackSelectionParameters = current.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subtitleTrack == "off").build()
      current.setMediaItem(item)
      if (releasePosition > 0) current.seekTo(releasePosition)
      current.setPlaybackSpeed(requestedRate.toFloat())
      current.playWhenReady = !requestedPaused && hasWindowFocus()
      current.prepare()
      periodic = true; mainHandler.post(clock)
    } catch (error: Exception) {
      releasePlayer()
      onState(mapOf("state" to "error", "error" to ((error as? MediaFailure)?.message ?: "Media could not be opened")))
    }
  }

  private fun emitState() {
    val current = player ?: return
    val state = when (current.playbackState) {
      Player.STATE_BUFFERING -> "loading"
      Player.STATE_ENDED -> "ended"
      Player.STATE_READY -> if (current.isPlaying) "playing" else if (!current.playWhenReady) "paused" else "ready"
      else -> "idle"
    }
    onState(mapOf("state" to state))
  }

  private fun reportTracks(tracks: Tracks) {
    val audio = mutableListOf<Map<String, Any?>>()
    val subtitles = mutableListOf<Map<String, Any?>>()
    val video = mutableListOf<Map<String, Any?>>()
    tracks.groups.forEachIndexed { groupIndex, group ->
      for (track in 0 until group.length) {
        if (!group.isTrackSupported(track)) continue
        val format = group.getTrackFormat(track)
        val row = mapOf("id" to "$groupIndex:$track", "label" to format.label, "language" to format.language,
          "width" to format.width.takeIf { it > 0 }, "height" to format.height.takeIf { it > 0 }, "bitrate" to format.bitrate.takeIf { it > 0 })
          .filterValues { it != null }
        when (group.type) {
          C.TRACK_TYPE_AUDIO -> audio.add(row)
          C.TRACK_TYPE_TEXT -> subtitles.add(row)
          C.TRACK_TYPE_VIDEO -> video.add(row)
        }
      }
    }
    onTracks(mapOf("audio" to audio, "subtitles" to subtitles, "video" to video))
  }

  private fun applyTracks() {
    val current = player ?: return
    val builder = current.trackSelectionParameters.buildUpon()
    fun select(type: Int, id: String?) {
      builder.clearOverridesOfType(type)
      builder.setTrackTypeDisabled(type, type == C.TRACK_TYPE_TEXT && (id == null || id == "off"))
      if (id == null || id == "auto" || id == "off") return
      val indices = id.split(':').mapNotNull { it.toIntOrNull() }
      if (indices.size != 2) return
      val group = current.currentTracks.groups.getOrNull(indices[0]) ?: return
      val track = indices[1]
      if (group.type != type || track !in 0 until group.length || !group.isTrackSupported(track)) return
      builder.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, listOf(track)))
    }
    select(C.TRACK_TYPE_AUDIO, audioTrack)
    select(C.TRACK_TYPE_TEXT, subtitleTrack)
    select(C.TRACK_TYPE_VIDEO, videoTrack)
    val parameters = builder.build()
    if (parameters != current.trackSelectionParameters) current.trackSelectionParameters = parameters
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); attached = true; updateSource() }
  override fun onDetachedFromWindow() { attached = false; releasePlayer(); super.onDetachedFromWindow() }
  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    player?.playWhenReady = hasWindowFocus && !requestedPaused
  }
  fun releasePlayer() {
    periodic = false; mainHandler.removeCallbacks(clock)
    player?.let { releasePosition = it.currentPosition.coerceAtLeast(0); playerView.player = null; it.release() }
    player = null; session?.cancel(); session = null
  }
}
