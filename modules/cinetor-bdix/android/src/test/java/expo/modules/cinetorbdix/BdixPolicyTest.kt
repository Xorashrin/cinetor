package expo.modules.cinetorbdix

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.net.URI

class BdixPolicyTest {
  private val root = URI("https://owned.example/media/")
  private fun rejected(action: () -> Unit) {
    try { action(); org.junit.Assert.fail("Expected scoped policy rejection") } catch (_: BdixFailure) { }
  }
  @Test fun pathsRemainWithinExactOriginAndDirectory() {
    assertEquals("https://owned.example/media/movie.mp4", PathPolicy.contain(root, "TV/../movie.mp4").toASCIIString())
    assertEquals("https://owned.example/media/Caf%C3%A9%20cut.mp4", PathPolicy.contain(root, "Caf%C3%A9%20cut.mp4").toASCIIString())
    assertEquals("https://owned.example/media/director%27s%20cut.mp4", PathPolicy.contain(root, "director's%20cut.mp4").toASCIIString())
    for (value in listOf("../movie.mp4", "/media-other/a.mp4", "//evil.example/a.mp4", "https://owned.example:444/media/a.mp4",
      "http://owned.example/media/a.mp4", "%2e%2e/a.mp4", "%252e%252e/a.mp4", "a%2Fb.mp4", "a%5cb.mp4", "a%00.mp4", "a%0d%0a.mp4",
      "a%zz.mp4", "https://user:password@owned.example/media/a.mp4", "a.mp4?password=hidden")) rejected { PathPolicy.contain(root, value) }
    rejected { PathPolicy.contain(URI("ftps://one.example/media/"), "ftps://two.example/media/a.mp4") }
    rejected { PathPolicy.contain(root, "?page=1&page=2", pagination = true) }
    assertEquals("page=2", PathPolicy.contain(root, "?page=2", pagination = true).rawQuery)
  }
  @Test fun passiveHostValidationHappensBeforeOpeningDataSocket() {
    val peer = InetAddress.getByAddress(byteArrayOf(10, 2, 3, 4))
    assertEquals(1930, PassivePolicy.pasv("227 Entering Passive Mode (10,2,3,4,7,138)", peer))
    assertEquals(2121, PassivePolicy.epsv("229 Entering Extended Passive Mode (|||2121|)"))
    for (reply in listOf("227 (127,0,0,1,7,138)", "227 (10,2,3,5,7,138)", "227 (0,0,0,0,7,138)",
      "227 (10,2,3,4,256,1)", "227 (10,2,3,4,0,0)", "227 (10,2,3,4,1)")) rejected { PassivePolicy.pasv(reply, peer) }
    for (reply in listOf("229 (|||0|)", "229 (|||65536|)", "229 (|!|2000|)", "229 (|||abc|)")) rejected { PassivePolicy.epsv(reply) }
  }
  @Test fun rangesAreSingleFiniteAndOverflowSafe() {
    assertEquals(ByteRange(0, 99), RangePolicy.parse(null, 100))
    assertEquals(ByteRange(20, 39), RangePolicy.parse("bytes=20-39", 100))
    assertEquals(ByteRange(20, 99), RangePolicy.parse("bytes=20-", 100))
    assertEquals(ByteRange(90, 99), RangePolicy.parse("bytes=-10", 100))
    assertEquals(ByteRange(0, 99), RangePolicy.parse("bytes=-999", 100))
    assertEquals(ByteRange(80, 99), RangePolicy.parse("bytes=80-999", 100))
    for (range in listOf("bytes=0-1,3-4", "bytes=100-", "bytes=5-1", "bytes=-0", "bytes=999999999999999999999-", "bytes=--1", "bytes=-", "bytes= 0-1")) rejected { RangePolicy.parse(range, 100) }
  }
  @Test fun canonicalEpisodeKeysIncludeSpecialSeasonZero() {
    assertEquals("tmdb:tv:123:s0e2", PathPolicy.contentKey("tmdb:tv:123:s0e2"))
    for (key in listOf("tmdb:tv:123", "tmdb:tv:123:s1e0", "tmdb:movie:0123", "tmdb:movie:9007199254740992", "tmdb:tv:123:s-1e2")) rejected { PathPolicy.contentKey(key) }
  }
  @Test fun containerEvidenceDoesNotAcceptAnHtmlErrorPage() {
    val mp4 = ByteArray(32).apply { "ftyp".toByteArray().copyInto(this, 4) }
    assertTrue(PathPolicy.sniff(mp4, "mp4"))
    assertFalse(PathPolicy.sniff("<html>access denied</html>".toByteArray(), "mp4"))
    assertNull(PathPolicy.container(URI("https://owned.example/media/live.m3u8")))
  }
}
