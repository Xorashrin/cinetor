import { test } from "node:test";
import assert from "node:assert/strict";
import { PlayableVerifier } from "../../src/engine/verifier";
import { candidate, source, network, response, mp4, ts } from "./helpers";
const signal = () => new AbortController().signal;
test("MP4 verification requires actual ftyp brand; decoder honestly unverified", async () => {
  const v = await new PlayableVerifier(
    network(async () => response(mp4(), 206, "video/mp4")),
  ).verify(candidate(), source(), signal());
  assert.equal(v.method, "mp4-range");
  assert.equal(v.verification, "transport-verified");
  assert.equal(v.decoder, "unverified");
});
for (const [name, bytes] of [
  [
    "HTML masquerading as MP4",
    new TextEncoder().encode("<html>login error</html>"),
  ],
  ["empty", new Uint8Array()],
  ["unknown container", new Uint8Array(100)],
  ["truncated ftyp", new TextEncoder().encode("0000ftyp")],
] as const)
  test(
    "strict gate rejects " + name,
    async () =>
      await assert.rejects(
        new PlayableVerifier(
          network(async () => response(bytes, 200, "video/mp4")),
        ).verify(candidate(), source(), signal()),
        { code: "unsupported" },
      ),
  );
test("unsupported file extension rejected without a network request", async () => {
  let calls = 0;
  await assert.rejects(
    new PlayableVerifier(
      network(async () => {
        calls++;
        return response(mp4(), 200, "video/mp4");
      }),
    ).verify(candidate({ url: "/fake.avi" }), source(), signal()),
    { code: "unsupported" },
  );
  assert.equal(calls, 0);
});
test("HLS media playlist verifies bounded TS segment", async () => {
  const calls: string[] = [];
  const net = network(async (url) => {
    calls.push(url);
    return url.endsWith(".ts")
      ? response(ts(), 206, "video/mp2t")
      : response(
          "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nsegment.ts",
          200,
          "application/vnd.apple.mpegurl",
        );
  });
  const v = await new PlayableVerifier(net).verify(
    candidate({ url: "/live.m3u8" }),
    source(),
    signal(),
  );
  assert.equal(v.method, "hls-segment");
  assert.equal(calls.length, 2);
});
test("HLS master resolves only authorized variant", async () => {
  const net = network(async (url) =>
    url.endsWith("master.m3u8")
      ? response(
          "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nchild.m3u8",
          200,
          "application/x-mpegurl",
        )
      : url.endsWith("child.m3u8")
        ? response(
            "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nx.ts",
            200,
            "application/x-mpegurl",
          )
        : response(ts(), 206, "video/mp2t"),
  );
  assert.equal(
    (
      await new PlayableVerifier(net).verify(
        candidate({ url: "/master.m3u8" }),
        source(),
        signal(),
      )
    ).method,
    "hls-segment",
  );
});
for (const [name, body] of [
  ["malformed", "garbage"],
  ["DRM", "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES"],
  ["manifest without media", "#EXTM3U\n#EXT-X-TARGETDURATION:10"],
  [
    "outside scope",
    "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttps://evil.example/x.ts",
  ],
])
  test(
    "HLS gate rejects " + name,
    async () =>
      await assert.rejects(
        new PlayableVerifier(
          network(async () => response(body, 200, "application/x-mpegurl")),
        ).verify(candidate({ url: "/live.m3u8" }), source(), signal()),
      ),
  );
test("HLS loop bounded", async () => {
  let calls = 0;
  await assert.rejects(
    new PlayableVerifier(
      network(async () => {
        calls++;
        return response(
          "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nlive.m3u8",
          200,
          "application/x-mpegurl",
        );
      }),
    ).verify(candidate({ url: "/live.m3u8" }), source(), signal()),
    { code: "malformed" },
  );
  assert.equal(calls, 1);
});
test("HLS rejects fake segment even if playlist request succeeds", async () =>
  await assert.rejects(
    new PlayableVerifier(
      network(async (url) =>
        url.endsWith(".ts")
          ? response("<html>login</html>", 200, "video/mp2t")
          : response(
              "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nx.ts",
              200,
              "application/x-mpegurl",
            ),
      ),
    ).verify(candidate({ url: "/live.m3u8" }), source(), signal()),
    { code: "unsupported" },
  ));
test("fragmented MP4 HLS requires scoped MP4 init and fragment signatures", async () => {
  const fragment = mp4();
  fragment.set(new TextEncoder().encode("moof"), 4);
  const net = network(async (url) =>
    url.endsWith("init.mp4")
      ? response(mp4(), 206, "video/mp4")
      : url.endsWith("frag.mp4")
        ? response(fragment, 206, "video/mp4")
        : response(
            '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10,\nfrag.mp4',
            200,
            "application/x-mpegurl",
          ),
  );
  assert.equal(
    (
      await new PlayableVerifier(net).verify(
        candidate({ url: "/live.m3u8" }),
        source(),
        signal(),
      )
    ).method,
    "hls-segment",
  );
});
