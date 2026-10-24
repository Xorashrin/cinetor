package expo.modules.cinetormedia

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetAddress

class MediaSafetyTest {
  @Test fun onlyPublicDestinationsOrNativeRegisteredExactCapabilities() {
    assertTrue(MediaSafety.checkedUrl("https://media.example/video.mp4").isHttps)
    listOf("http://media.example/video.mp4", "https://127.0.0.1/video.mp4", "https://10.0.0.1/video.mp4",
      "https://[::1]/video.mp4", "https://user:password@media.example/video.mp4", "https://100.64.0.1/video.mp4",
      "file:///data/video.mp4", "content://video/1", "magnet:?xt=urn:btih:fixture").forEach { value ->
      fails { MediaSafety.checkedUrl(value) }
    }
    val uri = "http://127.0.0.1:43210/media/0123456789abcdefghijklmnopqrstuvwxyz_ABCD/video.mp4"
    fails { MediaSafety.checkedUrl(uri) }
    TrustedLoopbackSources.register(uri)
    assertTrue(TrustedLoopbackSources.allows(uri))
    assertFalse(TrustedLoopbackSources.allows(uri.replace("video.mp4", "other.mp4")))
    assertFalse(TrustedLoopbackSources.allows(uri.replace(":43210", ":43211")))
    assertTrue(MediaSafety.checkedUrl(uri).host == "127.0.0.1")
    TrustedLoopbackSources.revoke(uri)
    fails { MediaSafety.checkedUrl(uri) }
  }

  @Test fun credentialOriginsNeverSilentlyFollowResolvedMediaUrls() {
    val root = MediaSafety.checkedUrl("https://cdn.example/video.mp4")
    assertTrue(MediaSafety.credentialOrigin("https://source.example", root) == "https://source.example:443")
    assertTrue(MediaSafety.credentialOrigin(null, root) == "https://cdn.example:443")
    fails { MediaSafety.credentialOrigin("https://source.example/path", root) }
    fails { MediaSafety.headers(mapOf("Host" to "private.example")) }
    fails { MediaSafety.headers(mapOf("Authorization" to "value\r\nHost: private.example")) }
    fails { MediaSafety.headers(mapOf("Range" to "bytes=10-")) }
  }

  @Test fun privateAndTransitionAddressesAreRejectedWithoutDnsTraffic() {
    listOf("0.0.0.0", "127.0.0.1", "169.254.1.1", "172.16.1.1", "192.168.1.1", "198.18.1.1",
      "::1", "fc00::1", "fe80::1", "2002:7f00:1::1", "2001:db8::1").forEach {
      assertFalse(it, MediaSafety.publicAddress(InetAddress.getByName(it)))
    }
    assertTrue(MediaSafety.publicAddress(InetAddress.getByName("8.8.8.8")))
  }

  @Test fun finiteClearHlsOnlyAndAes128KeysSupported() {
    val finite = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n"
    ManifestValidation.validate(finite.toByteArray(), "hls")
    ManifestValidation.validate(finite.replace("#EXTINF:", "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXTINF:").toByteArray(), "hls")
    fails { ManifestValidation.validate(finite.replace("#EXT-X-ENDLIST", "").toByteArray(), "hls") }
    fails { ManifestValidation.validate(finite.replace("#EXTINF:", "#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"key.bin\"\n#EXTINF:").toByteArray(), "hls") }
    fails { ManifestValidation.validate("<html>not media</html>".toByteArray(), "hls") }
  }

  @Test fun evolvingOnlineManifestsDoNotWeakenOfflineOrRangeValidation() {
    assertTrue(MediaSafety.allowsManifestRefresh(download = false, ranged = false, recognizedManifest = true))
    assertFalse(MediaSafety.allowsManifestRefresh(download = true, ranged = false, recognizedManifest = true))
    assertFalse(MediaSafety.allowsManifestRefresh(download = false, ranged = true, recognizedManifest = true))
    assertFalse(MediaSafety.allowsManifestRefresh(download = false, ranged = false, recognizedManifest = false))
  }

  private fun fails(block: () -> Unit) {
    try { block(); fail("Unsafe media was accepted") } catch (_: MediaFailure) { }
  }
}
