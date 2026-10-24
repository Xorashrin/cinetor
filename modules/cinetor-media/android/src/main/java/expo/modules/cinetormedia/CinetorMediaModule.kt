package expo.modules.cinetormedia

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CinetorMediaModule : Module() {
  private var engine: MediaEngine? = null
  private val listener: (Map<String, Any?>) -> Unit = { sendEvent("onDownloadUpdate", it) }
  private fun media(): MediaEngine = engine ?: MediaEngine.get(requireNotNull(appContext.reactContext)).also {
    engine = it; it.listen(listener)
  }

  override fun definition() = ModuleDefinition {
    Name("CinetorMedia")
    Events("onDownloadUpdate")
    AsyncFunction("getDownloads") { media().list() }.runOnQueue(Queues.MAIN)
    AsyncFunction("query") { key: String -> media().query(key) }.runOnQueue(Queues.MAIN)
    AsyncFunction("queue") { options: Map<String, Any?> -> media().queue(options) }.runOnQueue(Queues.MAIN)
    AsyncFunction("restart") { options: Map<String, Any?> -> media().queue(options, true) }.runOnQueue(Queues.MAIN)
    AsyncFunction("pause") { key: String -> media().pause(key) }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancel") { key: String -> media().delete(key) }.runOnQueue(Queues.MAIN)
    AsyncFunction("cancelAttempt") { key: String, id: String -> media().cancelAttempt(key, id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("delete") { key: String -> media().delete(key) }.runOnQueue(Queues.MAIN)
    AsyncFunction("deleteLocalFile") { uri: String -> media().deleteLocalFile(uri) }.runOnQueue(Queues.MAIN)
    AsyncFunction("getStorageInfo") { media().storageInfo() }.runOnQueue(Queues.MAIN)
    AsyncFunction("getCapabilities") { media().capabilities() }.runOnQueue(Queues.MAIN)
    AsyncFunction("setDownloadPolicy") { policy: Map<String, Boolean> -> media().setPolicy(policy["wifiOnly"] ?: true) }.runOnQueue(Queues.MAIN)
    OnDestroy {
      engine?.let { current -> current.handler.post { current.unlisten(listener) } }
      engine = null
      // The service owns the manager and cache, not the React runtime. Do not release ongoing work.
    }
    View(OfflineVideoView::class) {
      Events("onFirstFrame", "onTimeUpdate", "onState", "onEnd", "onTracks")
      Prop("uri") { view: OfflineVideoView, value: String? -> view.setUri(value) }
      Prop("headers") { view: OfflineVideoView, value: Map<String, String>? -> view.setHeaders(value) }
      Prop("headerOrigin") { view: OfflineVideoView, value: String? -> view.setHeaderOrigin(value) }
      Prop("container") { view: OfflineVideoView, value: String? -> view.setContainer(value) }
      Prop("subtitleTracks") { view: OfflineVideoView, value: List<Map<String, String>>? -> view.setSubtitles(value) }
      Prop("paused") { view: OfflineVideoView, value: Boolean -> view.setPaused(value) }
      Prop("position") { view: OfflineVideoView, value: Double -> view.setPosition(value) }
      Prop("rate") { view: OfflineVideoView, value: Double -> view.setRate(value) }
      Prop("audioTrackId") { view: OfflineVideoView, value: String? -> view.setAudioTrack(value) }
      Prop("subtitleTrackId") { view: OfflineVideoView, value: String? -> view.setSubtitleTrack(value) }
      Prop("videoTrackId") { view: OfflineVideoView, value: String? -> view.setVideoTrack(value) }
      OnViewDidUpdateProps { view: OfflineVideoView -> view.updateSource() }
      OnViewDestroys { view: OfflineVideoView -> view.releasePlayer() }
    }
  }
}
