import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  engine,
  candidate,
  source,
  response,
  mp4,
  MemoryStorage,
} from "./helpers";
import { CatalogRepository, CATALOG_KEY } from "../../src/engine/catalog";
import { SourceResolver } from "../../src/engine/resolver";
import { SCAN_KEY } from "../../src/engine/scheduler";
import { EngineLifecycle } from "../../src/engine/lifecycle";
import { BackgroundCoordinator } from "../../src/engine/backgroundCoordinator";
import { feedTitles, toChannel, toTitle } from "../../src/engine/ui";
const good = async (url: string) =>
  url.endsWith(".mp4")
    ? response(mp4(), 206, "video/mp4")
    : response(JSON.stringify([candidate()]));
const classification = {
  confidence: "explicit",
  metadata: "complete",
} as const;
const playback = (
  sourceId = "authorized",
  url = "https://media.example/film.mp4",
  season?: number,
  episode?: number,
) =>
  ({
    sourceId,
    url,
    season,
    episode,
    verification: "transport-verified",
    decoder: "unverified",
    method: "mp4-range",
    verifiedAt: 100,
    failedUntil: 0,
  }) as const;
test("end-to-end discovery publishes only classified verified media incrementally", async () => {
  const e = await engine(async (url) =>
    url.endsWith(".mp4")
      ? response(mp4(), 206, "video/mp4")
      : response(
          JSON.stringify([
            candidate(),
            { title: "Directory", url: "/dir/" },
            { ...candidate(), title: "bad", url: "/bad.avi" },
          ]),
        ),
  );
  let updates = 0;
  e.catalog.subscribe(() => updates++);
  await e.scheduler.run("foreground");
  assert.equal(e.catalog.all().length, 1);
  assert.equal(updates, 1);
  assert.equal(e.diagnostics.value.verified, 1);
  assert.equal(e.diagnostics.value.rejected, 2);
  assert.equal(e.diagnostics.value.successful, 1);
});
test("extension is insufficient for publication", async () => {
  const e = await engine(async (url) =>
    url.endsWith(".mp4")
      ? response("not a video", 200, "video/mp4")
      : response(JSON.stringify([candidate()])),
  );
  await e.scheduler.run("foreground");
  assert.equal(e.catalog.all().length, 0);
  assert.equal(e.diagnostics.value.unverified, 1);
});
test("per-source failure does not damage working source or previous valid cache", async () => {
  const e = await engine(
    async (url) =>
      url.includes("bad.example") ? response("", 403) : good(url),
    [
      source(),
      source({
        id: "bad",
        endpoint: "https://bad.example/catalog",
        scopes: [{ origin: "https://bad.example", pathPrefix: "/" }],
      }),
    ],
  );
  await e.scheduler.run("foreground");
  assert.equal(e.catalog.all().length, 1);
  assert.equal(e.diagnostics.value.successful, 1);
  assert.equal(e.diagnostics.value.failed, 1);
  assert.equal(e.diagnostics.snapshot().sources.bad.lastError, "permission");
});
test("same content mirrors dedupe, distinct editions and same-name years remain distinct", async () => {
  const e = await engine(good, [source(), source({ id: "mirror" })]);
  await e.catalog.upsert(candidate(), source(), playback(), classification);
  await e.catalog.upsert(
    candidate(),
    source({ id: "mirror" }),
    playback("mirror", "https://media.example/mirror.mp4"),
    classification,
  );
  assert.equal(e.catalog.all().length, 1);
  assert.equal(e.catalog.all()[0].sources.length, 2);
  await e.catalog.upsert(
    candidate({ edition: "extended" }),
    source(),
    playback(),
    classification,
  );
  await e.catalog.upsert(
    candidate({ year: 2001 }),
    source(),
    playback(),
    classification,
  );
  assert.equal(e.catalog.all().length, 3);
});
test("episodes share series with episode-specific mirror alternatives", async () => {
  const e = await engine(good);
  for (const episode of [1, 2])
    await e.catalog.upsert(
      candidate({ kind: "series", season: 1, episode }),
      source(),
      playback(
        "authorized",
        `https://media.example/e${episode}.mp4`,
        1,
        episode,
      ),
      classification,
    );
  assert.equal(e.catalog.all().length, 1);
  const title = toTitle(e.catalog.all()[0]);
  assert.equal(title.seasons[0].episodes.length, 2);
  assert.equal(
    new SourceResolver(e.catalog, e.registry).alternatives(title.id, 1, 2)[0]
      .url,
    "https://media.example/e2.mp4",
  );
});
test("catalog storage survives process recreation and offline query", async () => {
  const e = await engine(good);
  await e.scheduler.run("foreground");
  const restored = new CatalogRepository(e.store, e.registry);
  await restored.load();
  assert.equal(restored.query("home").length, 1);
  assert.equal(restored.all()[0].id, e.catalog.all()[0].id);
});
test("disk failure preserves existing in-memory and persisted records", async () => {
  const e = await engine(good);
  await e.scheduler.run("foreground");
  const before = e.store.map.get(CATALOG_KEY);
  e.store.fail = true;
  await assert.rejects(
    e.catalog.upsert(
      candidate({ title: "new" }),
      source(),
      playback(),
      classification,
    ),
    { code: "storage" },
  );
  assert.equal(e.catalog.all().length, 1);
  assert.equal(e.store.map.get(CATALOG_KEY), before);
});
test("corrupt primary recovers backup; subsequent writes preserve valid backup", async () => {
  const e = await engine(good);
  await e.catalog.upsert(candidate(), source(), playback(), classification);
  await e.catalog.upsert(
    candidate({ title: "second" }),
    source(),
    playback(),
    classification,
  );
  const backup = e.store.map.get(CATALOG_KEY + ":backup");
  e.store.map.set(CATALOG_KEY, "{broken");
  const recovered = new CatalogRepository(e.store, e.registry);
  await recovered.load();
  assert.equal(recovered.recovery, "backup");
  assert.equal(recovered.all().length, 1);
  await recovered.upsert(
    candidate({ title: "third" }),
    source(),
    playback(),
    classification,
  );
  assert.equal(e.store.map.get(CATALOG_KEY + ":backup"), backup);
});
test("corrupt storage never loops startup or promotes legacy cache", async () => {
  const store = new MemoryStorage();
  store.map.set(CATALOG_KEY, "bad");
  store.map.set("cinator:catalog:v1", JSON.stringify([candidate()]));
  const e = await engine(good, [source()], store);
  await e.catalog.load();
  assert.equal(e.catalog.all().length, 0);
  assert.equal(e.catalog.recovery, "corrupt");
});
test("safe additive v1 schema migration preserves existing evidence", async () => {
  const e = await engine(good);
  await e.scheduler.run("foreground");
  const saved = JSON.parse(e.store.map.get(CATALOG_KEY)!);
  saved.schemaVersion = 1;
  delete saved.records[0].stage;
  e.store.map.set(CATALOG_KEY, JSON.stringify(saved));
  const restored = new CatalogRepository(e.store, e.registry);
  await restored.load();
  assert.equal(restored.all()[0].stage, "published");
});
test("invalid persisted sources or verification evidence are skipped", async () => {
  const e = await engine(good);
  await e.scheduler.run("foreground");
  const saved = JSON.parse(e.store.map.get(CATALOG_KEY)!);
  saved.records[0].sources[0].verification = "extension-only";
  e.store.map.set(CATALOG_KEY, JSON.stringify(saved));
  const restored = new CatalogRepository(e.store, e.registry);
  await restored.load();
  assert.equal(restored.all().length, 0);
});
test("all five feed boundaries and age gate use the same repository", async () => {
  const s = source(),
    adult = source({
      id: "restricted",
      restricted: true,
      legalContentAttested: true,
      category: "adult",
    });
  const e = await engine(good, [s, adult]);
  const rows = [
    candidate(),
    candidate({ title: "Anime", category: "anime" }),
    candidate({
      title: "KDrama",
      kind: "series",
      category: "kdrama",
      language: "ko",
      season: 1,
      episode: 1,
    }),
    candidate({ title: "Channel", kind: "channel", category: "live" }),
    candidate({
      title: "Restricted",
      kind: "channel",
      category: "adult",
      adult: true,
    }),
  ];
  for (const row of rows) {
    const src = row.category === "adult" ? adult : s;
    await e.catalog.upsert(
      row,
      src,
      playback(src.id, row.url, row.season, row.episode),
      classification,
    );
  }
  assert.equal(feedTitles(e.catalog, "home").length, 1);
  assert.equal(feedTitles(e.catalog, "anime").length, 1);
  assert.equal(feedTitles(e.catalog, "kdrama").length, 1);
  assert.equal(e.catalog.query("live")[0].kind, "channel");
  assert.equal(e.catalog.query("adult").length, 0);
  assert.equal(e.catalog.query("adult", true).length, 1);
  assert.equal(toChannel(e.catalog.query("live")[0]).name, "Channel");
  assert(
    !feedTitles(e.catalog, "home").some(
      (t) => t.kind !== "movie" && t.kind !== "series",
    ),
  );
});
test("duplicate jobs share one promise and source request", async () => {
  let calls = 0;
  const e = await engine(async (url) => {
    calls++;
    return good(url);
  });
  const first = e.scheduler.run("foreground"),
    second = e.scheduler.run("background");
  assert.equal(first, second);
  await first;
  assert.equal(calls, 2);
});
test("cooldown prevents retries on same consistently unreachable ISP", async () => {
  let calls = 0;
  const e = await engine(async () => {
    calls++;
    throw new Error("DNS");
  });
  await e.scheduler.run("foreground");
  const before = calls;
  await e.scheduler.run("foreground");
  assert.equal(calls, before);
  assert.equal(e.diagnostics.snapshot().sources.authorized.failures, 1);
});
test("background task bounded and pending candidates resume after recreation", async () => {
  let now = 100000;
  const rows = Array.from({ length: 12 }, (_, i) =>
    candidate({ title: "Film " + i }),
  );
  const e = await engine(
    async (url) =>
      url.endsWith(".mp4")
        ? response(mp4(), 206, "video/mp4")
        : response(JSON.stringify(rows)),
    [source()],
    new MemoryStorage(),
    () => now,
  );
  await e.scheduler.run("background");
  assert.equal(e.catalog.all().length, 8);
  const saved = JSON.parse(e.store.map.get(SCAN_KEY)!);
  assert.equal(saved.sources.authorized.pending.length, 4);
  now += 60001;
  const restored = await engine(good, [source()], e.store, () => now);
  await restored.catalog.load();
  await restored.scheduler.run("foreground");
  assert.equal(restored.catalog.all().length, 12);
});
test("unexpired process lease prevents overlapping work; expired lease recovers", async () => {
  let now = 10000,
    calls = 0;
  const store = new MemoryStorage();
  store.map.set(
    SCAN_KEY,
    JSON.stringify({ schemaVersion: 1, leaseUntil: now + 1000, sources: {} }),
  );
  const e = await engine(
    async (url) => {
      calls++;
      return good(url);
    },
    [source()],
    store,
    () => now,
  );
  await e.scheduler.run("foreground");
  assert.equal(calls, 0);
  now += 1001;
  await e.scheduler.run("foreground");
  assert.equal(calls, 2);
});
test("restricted source never crawled in background or without session age access", async () => {
  let calls = 0;
  const e = await engine(async () => {
    calls++;
    return response("[]");
  }, [
    source({
      id: "adult",
      restricted: true,
      legalContentAttested: true,
      category: "adult",
    }),
  ]);
  await e.scheduler.run("foreground");
  e.scheduler.adultAccess = true;
  await e.scheduler.run("background");
  assert.equal(calls, 0);
  await e.scheduler.run("foreground");
  assert.equal(calls, 1);
});
test("player failures prefer healthy same-content mirror; decoder evidence updates only explicitly", async () => {
  const e = await engine(good, [source(), source({ id: "mirror" })]);
  await e.catalog.upsert(candidate(), source(), playback(), classification);
  await e.catalog.upsert(
    candidate(),
    source({ id: "mirror" }),
    playback("mirror", "https://media.example/mirror.mp4"),
    classification,
  );
  const id = e.catalog.all()[0].id;
  await e.catalog.reportPlayback(id, "https://media.example/film.mp4", false);
  const resolver = new SourceResolver(e.catalog, e.registry);
  assert.equal(
    resolver.alternatives(id)[0].url,
    "https://media.example/mirror.mp4",
  );
  await e.catalog.reportPlayback(id, "https://media.example/mirror.mp4", true);
  assert.equal(resolver.alternatives(id)[0].decoder, "verified");
});
test("diagnostics never expose queue endpoints, auth or signed URL", async () => {
  const e = await engine(good);
  await e.scheduler.run("foreground");
  const dump = JSON.stringify(e.diagnostics.snapshot());
  assert(!dump.includes("https://"));
  assert(!dump.includes("catalog.json"));
});
test("lifecycle start returns immediately; cache initialization before scan; mount duplication prevented", async () => {
  const events: string[] = [];
  let resolve!: () => void;
  const init = new Promise<void>((r) => {
    resolve = r;
  });
  const life = new EngineLifecycle(
    async () => {
      await init;
      events.push("cache");
    },
    async () => {
      events.push("scan");
    },
    () => {},
    () => events.push("scheduled"),
    () => {},
  );
  life.start();
  life.start();
  events.push("render");
  assert.deepEqual(events, ["render"]);
  resolve();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(events, ["render", "cache", "scan", "scheduled"]);
  life.stop();
});
test("foreground return resumes while background cancels foreground work", async () => {
  let runs = 0,
    cancel = 0;
  const life = new EngineLifecycle(
    async () => {},
    async () => {
      runs++;
    },
    () => {
      cancel++;
    },
    () => {},
    () => {},
  );
  life.start();
  await new Promise((r) => setImmediate(r));
  life.change(false);
  assert.equal(cancel, 1);
  life.change(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(runs, 2);
  life.stop();
});
test("scheduled registration duplicate prevention and restoration", async () => {
  let registered = false,
    calls = 0;
  const c = new BackgroundCoordinator({
    available: async () => true,
    registered: async () => registered,
    register: async () => {
      calls++;
      registered = true;
    },
  });
  await Promise.all([c.register(), c.register()]);
  await c.register();
  assert.equal(calls, 1);
  const restored = new BackgroundCoordinator({
    available: async () => true,
    registered: async () => registered,
    register: async () => {
      calls++;
    },
  });
  await restored.register();
  assert.equal(calls, 1);
});
test("unavailable background platform reports unavailable without scheduling", async () => {
  let calls = 0;
  const c = new BackgroundCoordinator({
    available: async () => false,
    registered: async () => false,
    register: async () => {
      calls++;
    },
  });
  assert.equal(await c.register(), false);
  assert.equal(calls, 0);
});
test("registration failure can recover", async () => {
  let fail = true;
  const c = new BackgroundCoordinator({
    available: async () => true,
    registered: async () => false,
    register: async () => {
      if (fail) throw new Error("failure");
    },
  });
  await assert.rejects(c.register());
  fail = false;
  assert.equal(await c.register(), true);
});
test("startup failsafes and normal navigation remain independent of engine", async () => {
  const app = await readFile("App.tsx", "utf8");
  assert(app.includes("1800"));
  assert(app.includes("1000"));
  assert(!app.includes("await initializeEngine"));
  const tabs = await readFile("src/navigation/Tabs.tsx", "utf8");
  assert(!/Parser|FTP|Engine/.test(tabs));
});
test("general feed rejects adult title even without explicit adult flag", async () => {
  const e = await engine(good);
  await assert.rejects(
    e.catalog.upsert(
      candidate({ title: "Pornography channel" }),
      source(),
      playback(),
      classification,
    ),
    { code: "unsupported" },
  );
  assert.equal(e.catalog.all().length, 0);
});
test("HTML nested discovery traverses authorized child directory with source conventions", async () => {
  const s = source({
    adapter: "html-directory",
    endpoint: "https://media.example/media/",
    category: "home",
    kind: "movie",
    expectedContentTypes: ["text/html"],
    maxDepth: 2,
  });
  const calls: string[] = [];
  const e = await engine(
    async (url) => {
      calls.push(url);
      return url.endsWith(".mp4")
        ? response(mp4(), 206, "video/mp4")
        : url.endsWith("/media/")
          ? response(
              '<html><a href="movies/">movies</a><a href="../">parent</a>',
              200,
              "text/html",
            )
          : response(
              '<html><a href="A.Film.2024.mp4">A.Film.2024.mp4</a>',
              200,
              "text/html",
            );
    },
    [s],
  );
  await e.scheduler.run("foreground");
  assert.equal(e.catalog.query("home")[0].title, "A Film");
  assert.equal(calls.length, 3);
});
test("catalog cooldown and network error retain cached content after later failed refresh", async () => {
  let now = 10000,
    bad = false;
  const s = source();
  const e = await engine(
    async (url) => (bad ? response("", 503) : good(url)),
    [s],
    new MemoryStorage(),
    () => now,
  );
  await e.scheduler.run("foreground");
  bad = true;
  now += s.refreshMs + 1;
  await e.scheduler.run("foreground");
  assert.equal(e.diagnostics.value.state, "failed");
  assert.equal(e.catalog.query("home").length, 1);
});
test("bounded source concurrency never exceeds two requests", async () => {
  let active = 0,
    max = 0;
  const e = await engine(
    async (url) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return good(url);
    },
    [source(), source({ id: "two" }), source({ id: "three" })],
  );
  await e.scheduler.run("foreground");
  assert.equal(max, 2);
});
test("malformed refresh never saves cache validator that bypasses future parsing", async () => {
  let now = 1000,
    calls = 0;
  const e = await engine(
    async (_url, init) => {
      calls++;
      assert.equal(init.headers["If-None-Match"], undefined);
      return response("{invalid", 200, "application/json", {
        etag: "invalid-tag",
      });
    },
    [source()],
    new MemoryStorage(),
    () => now,
  );
  await e.scheduler.run("foreground");
  now += 120001;
  await e.scheduler.run("foreground");
  assert.equal(calls, 2);
});
test("cancelled foreground scan persists pending work and resumes", async () => {
  let now = 1000,
    e: Awaited<ReturnType<typeof engine>>,
    cancelled = false;
  e = await engine(
    async (url) => {
      if (url.endsWith(".mp4") && !cancelled) {
        cancelled = true;
        e.scheduler.cancel();
        throw new Error("cancelled");
      }
      return good(url);
    },
    [source()],
    new MemoryStorage(),
    () => now,
  );
  await e.scheduler.run("foreground");
  assert.equal(e.catalog.all().length, 0);
  assert.equal(
    JSON.parse(e.store.map.get(SCAN_KEY)!).sources.authorized.pending.length,
    1,
  );
  now += 60001;
  await e.scheduler.run("foreground");
  assert.equal(e.catalog.all().length, 1);
});
test("identity fields containing delimiters cannot collide", async () => {
  const e = await engine(good);
  await e.catalog.upsert(
    candidate({ title: "Name|2025", year: 2024 }),
    source(),
    playback(),
    classification,
  );
  await e.catalog.upsert(
    candidate({ title: "Name", year: 2025, edition: "2024|theatrical" }),
    source(),
    playback(),
    classification,
  );
  assert.equal(e.catalog.all().length, 2);
});
test("failed initialization schedules recoverable foreground retry", async () => {
  let schedules = 0;
  const life = new EngineLifecycle(
    async () => {
      throw new Error("storage");
    },
    async () => {},
    () => {},
    () => {
      schedules++;
    },
    () => {},
  );
  life.start();
  await new Promise((r) => setImmediate(r));
  assert.equal(schedules, 1);
  life.stop();
});
