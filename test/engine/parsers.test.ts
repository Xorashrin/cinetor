import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JsonCatalogParser,
  HtmlDirectoryParser,
  M3uParser,
  ParserRegistry,
} from "../../src/engine/parsers";
import { source, candidate, MemoryStorage } from "./helpers";
import { SourceRegistry } from "../../src/engine/sources";
import { authorizedUrl, redact } from "../../src/engine/security";
import { extractMetadata, identity } from "../../src/engine/metadata";
import { classify } from "../../src/engine/classifier";
const s = source();
test("JSON valid Unicode titles, relative paths and entry failure isolation", () => {
  const p = new JsonCatalogParser().parse(
    JSON.stringify({
      items: [
        { ...candidate(), title: "  বাংলা 日本語  ", url: "/বাংলা নাম.mp4" },
        null,
        { title: "no URL" },
      ],
    }),
    s,
    s.endpoint,
  );
  assert.equal(p.candidates.length, 1);
  assert.equal(p.rejected, 2);
  assert.match(p.candidates[0].url, /%E0/);
  assert.equal(extractMetadata(p.candidates[0], s).title, "বাংলা 日本語");
});
for (const [name, body] of [
  ["broken", "{"],
  ["wrong envelope", '{"data":[]}'],
  ["primitive", "7"],
])
  test("JSON rejects " + name, () =>
    assert.throws(() => new JsonCatalogParser().parse(body, s, s.endpoint)),
  );
test("JSON bounds candidate count", () => {
  const p = new JsonCatalogParser().parse(
    JSON.stringify(Array.from({ length: 700 }, () => candidate())),
    s,
    s.endpoint,
  );
  assert.equal(p.candidates.length, 500);
  assert.equal(p.rejected, 200);
});
test("HTML decodes entities, supports malformed markup and bounds downward traversal", () => {
  const html =
    '<html><a href="/dir/子/">child</a><a href="../">parent</a><a href="Movie%20Name.2024.mp4">Movie Name.2024.mp4</a><a href="fake.exe">bad</a><a href="javascript:alert(1)">x</a>';
  const p = new HtmlDirectoryParser().parse(
    html,
    s,
    "https://media.example/dir/",
  );
  assert.equal(p.directories.length, 1);
  assert.equal(p.candidates.length, 1);
  assert.equal(p.rejected, 1);
  assert.equal(extractMetadata(p.candidates[0], s).title, "Movie Name");
});
test("HTML never executes downloaded script or publishes directories", () => {
  const p = new HtmlDirectoryParser().parse(
    '<html><script>throw new Error()</script><a href="/d/">Directory</a><a href="/a.mp4">A &amp; B.mp4</a>',
    s,
    s.endpoint,
  );
  assert.equal(p.candidates[0].title, "A & B.mp4");
  assert.equal(p.directories.length, 0);
});
test("HTML rejects non markup", () =>
  assert.throws(() =>
    new HtmlDirectoryParser().parse("garbage", s, s.endpoint),
  ));
test("M3U Unicode, logos, comma in attributes and isolated malformed entry", () => {
  const p = new M3uParser().parse(
    '#EXTM3U\n#EXTINF:-1 tvg-id="bd.tv" tvg-logo="/logo.png" group-title="News,Local",বাংলা TV\n/live.m3u8\n#EXTINF:-1,Bad\nftp://media.example/a\n#EXTINF:-1,Truncated',
    s,
    s.endpoint,
  );
  assert.equal(p.candidates.length, 1);
  assert.equal(p.candidates[0].kind, "channel");
  assert.equal(p.candidates[0].poster, "/logo.png");
  assert.equal(p.rejected, 2);
});
for (const body of ["hello", "#EXTM3U\n#EXT-X-TARGETDURATION:10"])
  test("M3U rejects catalog/manifest confusion " + body.length, () =>
    assert.throws(() => new M3uParser().parse(body, s, s.endpoint)),
  );
test("M3U marks restricted entries for classifier rejection in general source", () => {
  const p = new M3uParser().parse(
    '#EXTM3U\n#EXTINF:-1 group-title="Adult",Restricted\n/live.m3u8',
    s,
    s.endpoint,
  );
  assert.equal(classify(p.candidates[0], s), null);
});
test("direct adapter requires explicit metadata and media reference", () => {
  const p = new ParserRegistry().parse(
    "direct",
    "",
    source({
      adapter: "direct",
      endpoint: "https://media.example/a.mp4",
      directMetadata: { title: "A", kind: "movie", category: "home" },
    }),
    s.endpoint,
  );
  assert.equal(p.candidates.length, 1);
  assert.equal(
    new ParserRegistry().parse(
      "direct",
      "",
      source({ adapter: "direct" }),
      s.endpoint,
    ).rejected,
    1,
  );
});
for (const [name, patch] of [
  ["FTP", { protocol: "ftp", endpoint: "ftp://media.example/" }],
  ["unauthorized", { authorized: false }],
  ["embedded credentials", { endpoint: "https://u:p@media.example/a" }],
  ["unknown adapter", { adapter: "xml" }],
  [
    "private default",
    {
      endpoint: "https://192.168.1.2/a",
      scopes: [{ origin: "https://192.168.1.2", pathPrefix: "/" }],
    },
  ],
  ["secret query", { endpoint: "https://media.example/a?token=secret" }],
  ["missing scopes", { scopes: [] }],
  ["restricted without attestation", { restricted: true, category: "adult" }],
  ["excess retry", { retries: 20 }],
  [
    "origin with path",
    { scopes: [{ origin: "https://media.example/path", pathPrefix: "/" }] },
  ],
])
  test("source validation rejects " + name, () => {
    const r = new SourceRegistry(new MemoryStorage());
    assert.throws(() => r.validate({ ...s, ...patch }));
  });
test("explicit private destination opt-in succeeds", () => {
  const r = new SourceRegistry(new MemoryStorage());
  assert.equal(
    r.validate({
      ...s,
      endpoint: "http://192.168.1.2/media/",
      protocol: "http",
      allowPrivateNetwork: true,
      scopes: [{ origin: "http://192.168.1.2", pathPrefix: "/media" }],
    }).allowPrivateNetwork,
    true,
  );
});
for (const input of [
  "https://evil.example/a",
  "https://media.example/outside/a",
  "https://media.example/mediaevil/a",
  "/media/%252e%252e/x",
  "/media/%2e%2e/private",
  "/media/%5cfoo",
  "data:text/html,x",
  "https://media.example/media/a?X-Amz-Signature=secret",
])
  test("scope rejects " + input, () =>
    assert.throws(() =>
      authorizedUrl(
        input,
        source({
          endpoint: "https://media.example/media/",
          scopes: [{ origin: "https://media.example", pathPrefix: "/media" }],
        }),
      ),
    ),
  );
test("credentials and signed URLs are redacted", () => {
  const text = redact(
    "https://u:pass@media.example/a?token=abc Authorization=Bearer token=secret",
  );
  assert(!text.includes("abc"));
  assert(!text.includes("secret"));
  assert(!text.includes("pass@"));
});
test("filename coordinates and Unicode normalization do not guess anime or movies", () => {
  const c = extractMetadata(
    candidate({
      title: "বাংলা.Show.S02E03.2025.1080p.mp4",
      kind: undefined,
      category: undefined,
    }),
    s,
  );
  assert.equal(c.title, "বাংলা Show");
  assert.equal(c.kind, "series");
  assert.equal(c.season, 2);
  assert.equal(c.episode, 3);
  assert.equal(c.category, undefined);
  assert.equal(classify(c, s), null);
});
test("explicit metadata overrides filename conventions", () => {
  const c = extractMetadata(
    candidate({ title: "A.2024.mp4", year: 2001, season: 7, episode: 8 }),
    s,
  );
  assert.equal(c.year, 2001);
  assert.equal(c.season, 7);
});
test("Korean film remains Home, not K-Drama", () =>
  assert(classify(candidate({ language: "ko" }), s)));
for (const patch of [
  { kind: "movie", category: "kdrama", language: "ko" },
  { kind: "series", category: "kdrama", language: "ja", season: 1, episode: 1 },
  { kind: "channel", category: "home" },
  { kind: "movie", category: "live" },
  { kind: "series", season: undefined, episode: undefined },
  { category: "adult" },
  { genres: ["Porn"] },
])
  test("classification rejects invalid boundary " + JSON.stringify(patch), () =>
    assert.equal(classify(candidate(patch), s), null),
  );
test("K-Drama requires Korean series coordinates", () =>
  assert(
    classify(
      candidate({
        kind: "series",
        category: "kdrama",
        language: "ko",
        season: 1,
        episode: 1,
      }),
      s,
    ),
  ));
test("explicit anime movie supported", () =>
  assert(classify(candidate({ category: "anime" }), s)));
test("stable identities distinguish editions and episodes share one series record", () => {
  assert.notEqual(
    identity(candidate(), s),
    identity(candidate({ edition: "directors cut" }), s),
  );
  assert.equal(
    identity(candidate({ kind: "series", season: 1, episode: 1 }), s),
    identity(candidate({ kind: "series", season: 1, episode: 2 }), s),
  );
});
test("unknown edition/year avoids accidental cross-source grouping", () =>
  assert.notEqual(
    identity(candidate({ year: undefined, edition: undefined }), s),
    identity(
      candidate({ year: undefined, edition: undefined }),
      source({ id: "mirror" }),
    ),
  ));
