package expo.modules.cinetormedia

import org.junit.Assert.assertEquals
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

  @Test fun finiteClearAndAes128IdentityHlsAreAcceptedButDrmIsRejected() {
    val finite = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n"
    ManifestValidation.validate(finite.toByteArray(), "hls")
    assertTrue(ManifestValidation.hlsEncryptionKeyUris(finite).isEmpty())
    ManifestValidation.validate(finite.replace("#EXTINF:", "#EXT-X-KEY:METHOD=NONE\n#EXTINF:").toByteArray(), "hls")
    val encrypted = finite.replace("#EXTINF:", "#EXT-X-KEY:URI=\"key.bin\",METHOD=AES-128,KEYFORMAT=\"identity\"\n#EXTINF:")
    ManifestValidation.validate(encrypted.toByteArray(), "hls")
    assertEquals(listOf("key.bin"), ManifestValidation.hlsEncryptionKeyUris(encrypted))
    ManifestValidation.validateAes128KeyLength(16)
    fails { ManifestValidation.validate(finite.replace("#EXT-X-ENDLIST", "").toByteArray(), "hls") }
    fails { ManifestValidation.validate(finite.replace("#EXTINF:", "#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"key.bin\"\n#EXTINF:").toByteArray(), "hls") }
    fails { ManifestValidation.validate(finite.replace("#EXTINF:", "#EXT-X-KEY:KEYFORMAT=\"com.widevine\",URI=\"key.bin\",METHOD=AES-128\n#EXTINF:").toByteArray(), "hls") }
    fails { ManifestValidation.validate("<html>not media</html>".toByteArray(), "hls") }
  }

  @Test fun uriFirstRotatedKeysAreRegisteredAndBadLengthsRejected() {
    val playlist = "#EXTM3U\n#EXT-X-TARGETDURATION:6\n" +
      "#EXT-X-KEY:METHOD=AES-128,URI=\"first.key\"\n#EXTINF:6,\na.ts\n" +
      "#EXT-X-KEY:URI=\"late.key\",METHOD=AES-128\n#EXTINF:6,\nb.ts\n" +
      "#EXT-X-KEY:METHOD=NONE\n#EXTINF:6,\nc.ts\n#EXT-X-ENDLIST\n"
    ManifestValidation.validate(playlist.toByteArray(), "hls")
    val keys = ManifestValidation.hlsEncryptionKeyUris(playlist)
    assertEquals(listOf("first.key", "late.key"), keys)
    val lengths = mapOf("first.key" to 16L, "late.key" to 15L)
    ManifestValidation.validateAes128KeyLength(lengths.getValue(keys.first()))
    fails { ManifestValidation.validateAes128KeyLength(lengths.getValue(keys.last())) }
    fails { ManifestValidation.validateAes128KeyLength(17) }
    assertEquals(listOf("first,session.key"), ManifestValidation.hlsEncryptionKeyUris(
      "#EXT-X-SESSION-KEY:URI=\"first,session.key\",METHOD=AES-128,KEYFORMAT=\"identity\""))
  }

  @Test fun onlineRangesAllowMissingEtagsButDownloadsAndKnownIdentitiesStayStrict() {
    val plain = ResourceIdentity(null, 1024, "https://media.example/video.mp4")
    MediaSafety.validateRepresentation(download = false, ranged = true, existing = null, received = plain)
    MediaSafety.validateRepresentation(download = false, ranged = true, existing = plain, received = plain)
    fails { MediaSafety.validateRepresentation(download = true, ranged = true, existing = null, received = plain) }
    val stable = plain.copy(etag = "\"stable\"")
    fails { MediaSafety.validateRepresentation(download = true, ranged = true, existing = plain, received = stable) }
    MediaSafety.validateRepresentation(download = true, ranged = true, existing = stable, received = stable)
    fails { MediaSafety.validateRepresentation(download = false, ranged = true, existing = stable, received = plain) }
    fails { MediaSafety.validateRepresentation(download = false, ranged = true, existing = stable, received = stable.copy(etag = "\"changed\"")) }
    fails { MediaSafety.validateRepresentation(download = false, ranged = true, existing = plain, received = plain.copy(total = 1025)) }
    fails { MediaSafety.validateRepresentation(download = false, ranged = true, existing = plain, received = plain.copy(destination = "https://media.example/other.mp4")) }
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
