import assert from 'node:assert/strict';
import test from 'node:test';
import { TmdbClient, CINEHD_METADATA_PROXY, TMDB_API_BASE, type FetchLike, type TmdbResponse } from '../../src/providers/client';
import { CineHdCatalog, CINEHD_METADATA_KEY, tmdbImage } from '../../src/providers/metadata';
import { EngineError, type Storage } from '../../src/engine/model';

class MemoryStorage implements Storage {
  map = new Map<string, string>();
  async getItem(key: string) { return this.map.get(key) ?? null; }
  async setItem(key: string, value: string) { this.map.set(key, value); }
}
function response(input: unknown, status = 200, type = 'application/json', raw = false): TmdbResponse {
  const bytes = new TextEncoder().encode(raw ? String(input) : JSON.stringify(input));
  let done = false;
  return {
    status, headers: { get: key => key === 'content-type' ? type : null },
    body: { getReader: () => ({
      read: async () => {
        if (done) return { done: true };
        done = true;
        return { done: false, value: bytes };
      },
      cancel: async () => { done = true; },
    }) },
  };
}
const movie = {
  id: 872585, media_type: 'movie', title: 'Oppenheimer', adult: false,
  release_date: '2023-07-19', genre_ids: [18, 36], original_language: 'en',
  overview: 'The story of J. Robert Oppenheimer and his role in the development of the atomic bomb.',
  poster_path: '/ptpr0kGAckfQkJeJIt8st5dglvd.jpg', backdrop_path: '/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg',
  vote_average: 8.061, popularity: 51.456,
};
const tv = {
  id: 1399, media_type: 'tv', name: 'Game of Thrones', adult: false,
  first_air_date: '2011-04-17', genre_ids: [18, 10765], original_language: 'en',
  overview: 'Seven noble families fight for control of the mythical land of Westeros.',
  poster_path: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
};
function isCode(code: string) {
  return (error: unknown) => error instanceof EngineError && error.code === code;
}

test('APK-observed metadata proxy works without a key and preserves nested search characters', async () => {
  const queries = ['Oppenheimer', 'A & B + C? #', '日本語'];
  let calls = 0;
  const client = new TmdbClient(async () => null, async url => {
    assert.ok(url.startsWith(CINEHD_METADATA_PROXY + TMDB_API_BASE + '/search/multi?'));
    const target = new URL(url).searchParams.get('url');
    assert.ok(target);
    const nested = new URL(target);
    assert.equal(nested.searchParams.get('language'), 'en-US');
    assert.equal(nested.searchParams.get('include_adult'), 'false');
    assert.equal(nested.searchParams.get('query'), queries[calls]);
    assert.equal(nested.searchParams.has('api_key'), false);
    calls++;
    return response({ results: [movie] });
  });
  for (const query of queries) await client.request('/search/multi', { query, include_adult: false });
  assert.equal(calls, 3);
});

test('configured API key uses direct TMDB and cached responses cannot mutate other consumers', async () => {
  let now = 10;
  let calls = 0;
  const client = new TmdbClient(async () => 'user_owned_key_1234', async (url, init) => {
    calls++;
    assert.equal(new URL(url).origin, 'https://api.themoviedb.org');
    assert.equal(new URL(url).searchParams.get('api_key'), 'user_owned_key_1234');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    return response({ results: [movie] });
  }, { now: () => now, cacheTtlMs: 5 });
  const first = await client.request('/trending/movie/week');
  assert.ok(typeof first === 'object' && first !== null);
  if ('results' in first) first.results = [];
  const second = await client.request('/trending/movie/week');
  assert.deepEqual(second, { results: [movie] });
  assert.equal(calls, 1);
  now = 16;
  await client.request('/trending/movie/week');
  assert.equal(calls, 2);
});

test('coalesced callers cancel independently, and all-caller cancellation aborts transport', async () => {
  let complete: ((value: TmdbResponse) => void) | undefined;
  let transportSignal: AbortSignal | undefined;
  let calls = 0;
  const client = new TmdbClient(async () => null, (_url, init) => {
    calls++;
    transportSignal = init.signal;
    return new Promise(resolve => { complete = resolve; });
  });
  const controller = new AbortController();
  const first = client.request('/movie/872585', {}, controller.signal);
  const second = client.request('/movie/872585');
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(first, isCode('cancelled'));
  assert.equal(transportSignal?.aborted, false);
  complete?.(response(movie));
  assert.deepEqual(await second, movie);
  assert.equal(calls, 1);
  const only = new AbortController();
  const abandoned = client.request('/tv/1399', {}, only.signal);
  await new Promise(resolve => setImmediate(resolve));
  only.abort();
  await assert.rejects(abandoned, isCode('cancelled'));
  assert.equal(transportSignal?.aborted, true);
});

test('timeout includes credentials and response readers; malformed and oversized payloads are rejected', async () => {
  const credentialHang = new TmdbClient(() => new Promise(() => undefined), async () => response(movie), { timeoutMs: 100 });
  await assert.rejects(credentialHang.request('/movie/872585'), isCode('timeout'));
  const readHang = new TmdbClient(async () => null, async () => ({
    status: 200, headers: { get: () => 'application/json' },
    body: { getReader: () => ({ read: () => new Promise(() => undefined), cancel: async () => undefined }) },
  }), { timeoutMs: 100 });
  await assert.rejects(readHang.request('/movie/872585'), isCode('timeout'));
  const invalid = new TmdbClient(async () => null, async () => response('{broken', 200, 'application/json', true));
  await assert.rejects(invalid.request('/movie/872585'), isCode('malformed'));
  const wrongType = new TmdbClient(async () => null, async () => response(movie, 200, 'text/html'));
  await assert.rejects(wrongType.request('/movie/872585'), isCode('malformed'));
  const oversized = new TmdbClient(async () => null, async () => response({ data: 'x'.repeat(1100) }), { maxResponseBytes: 1024 });
  await assert.rejects(oversized.request('/movie/872585'), isCode('size'));
  const unsafe = new TmdbClient(async () => null, async () => response(movie));
  await assert.rejects(unsafe.request('//attacker.test/movie/872585'), isCode('configuration'));
});

test('catalog search publishes real movie/TV metadata, excludes adults and people, and deduplicates typed IDs', async () => {
  const storage = new MemoryStorage();
  let calls = 0;
  const catalog = new CineHdCatalog(storage, async () => null, async () => {
    calls++;
    return response({ results: [movie, tv, movie, { ...movie, id: 1399 }, { id: 100, media_type: 'person', name: 'A Person' }, { ...movie, id: 22, adult: true }] });
  });
  let publishes = 0;
  const unsubscribe = catalog.subscribe(() => publishes++);
  const rows = await catalog.search('Oppenheimer');
  assert.deepEqual(rows.map(row => row.id), ['tmdb:movie:872585', 'tmdb:tv:1399', 'tmdb:movie:1399']);
  assert.equal(rows[0]?.year, 2023);
  assert.equal(rows[0]?.name, 'Oppenheimer');
  assert.deepEqual(rows[0]?.genres, ['Drama', 'History']);
  assert.equal(rows[0]?.posterUrl, 'https://image.tmdb.org/t/p/w500/ptpr0kGAckfQkJeJIt8st5dglvd.jpg');
  assert.equal(rows[0]?.runtime, 0);
  assert.deepEqual(rows[0]?.quality, []);
  assert.deepEqual(rows[0]?.sources, []);
  assert.equal(rows[0]?.video, '');
  assert.equal(publishes, 1);
  await catalog.search('Oppenheimer');
  assert.equal(calls, 1);
  assert.ok(storage.map.has(CINEHD_METADATA_KEY));
  unsubscribe();
  const loaded = new CineHdCatalog(storage, async () => null);
  await loaded.load();
  assert.equal(loaded.all().length, 3);
  assert.deepEqual(loaded.get('tmdb:movie:872585')?.sources, []);
});

test('refresh caps concurrency at two and retains existing metadata after partial HTTP failures', async () => {
  let active = 0;
  let peak = 0;
  let fail = false;
  const fetcher: FetchLike = async url => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    const target = new URL(new URL(url).searchParams.get('url') ?? url);
    if (target.pathname.endsWith('/search/multi')) return response({ results: [movie] });
    if (fail && target.pathname.includes('/trending/movie')) return response({}, 503);
    if (target.searchParams.get('with_original_language') === 'ja')
      return response({ results: [{ ...tv, id: 1429, name: 'Attack on Titan', original_language: 'ja', genre_ids: [16, 10759] }] });
    if (target.searchParams.get('with_original_language') === 'ko')
      return response({ results: [{ ...tv, id: 93405, name: 'Squid Game', original_language: 'ko' }] });
    return response({ results: target.pathname.includes('/trending/movie') ? [movie] : [tv] });
  };
  const catalog = new CineHdCatalog(new MemoryStorage(), async () => null, fetcher);
  await catalog.search('Oppenheimer');
  await catalog.refresh();
  assert.equal(peak, 2);
  assert.equal(catalog.all().length, 4);
  assert.equal(catalog.query('anime')[0]?.name, 'Attack on Titan');
  assert.equal(catalog.query('kdrama')[0]?.name, 'Squid Game');
  assert.deepEqual(catalog.query('home').map(row => row.name).sort(), ['Game of Thrones', 'Oppenheimer']);
  fail = true;
  await assert.rejects(catalog.refresh(), isCode('http'));
  assert.equal(catalog.get('tmdb:movie:872585')?.name, 'Oppenheimer');
  assert.equal(catalog.all().length, 4);
});

test('details fetch credits/external IDs and seasons on demand with actual names and still artwork', async () => {
  const calls: string[] = [];
  const storage = new MemoryStorage();
  const catalog = new CineHdCatalog(storage, async () => null, async url => {
    const target = new URL(new URL(url).searchParams.get('url') ?? url);
    calls.push(target.pathname);
    if (target.pathname.endsWith('/search/multi')) return response({ results: [tv] });
    if (target.pathname.endsWith('/season/1')) return response({
      id: 3624, season_number: 1, episodes: [{
        id: 63056, episode_number: 1, season_number: 1, name: 'Winter Is Coming', runtime: 62,
        overview: 'Jon Arryn, the Hand of the King, is dead. King Robert Baratheon plans to ask Eddard Stark to take his place.',
        still_path: '/wI3pV6ey3e3B9z7pmBGg0P3q61K.jpg',
      }],
    });
    if (target.pathname.endsWith('/season/2')) return response({ season_number: 2, episodes: [{ episode_number: 1, season_number: 2, name: 'The North Remembers', runtime: 53, overview: '' }] });
    assert.equal(target.searchParams.get('append_to_response'), 'credits,external_ids');
    return response({
      ...tv, genres: [{ id: 18, name: 'Drama' }, { id: 10765, name: 'Sci-Fi & Fantasy' }],
      episode_run_time: [60], external_ids: { imdb_id: 'tt0944947' },
      created_by: [{ name: 'David Benioff' }, { name: 'D. B. Weiss' }],
      credits: { cast: [{ name: 'Peter Dinklage' }, { name: 'Lena Headey' }] },
      seasons: [{ season_number: 0 }, { season_number: 1 }, { season_number: 2 }],
    });
  });
  await catalog.search('Game of Thrones');
  const detailed = await catalog.detail('tmdb:tv:1399');
  assert.equal(detailed?.imdbId, 'tt0944947');
  assert.deepEqual(detailed?.cast, ['Peter Dinklage', 'Lena Headey']);
  assert.deepEqual(detailed?.creators, ['David Benioff', 'D. B. Weiss']);
  assert.equal(detailed?.seasons.length, 3);
  assert.equal(detailed?.seasons[0]?.number, 0);
  assert.equal(detailed?.seasons[0]?.episodes.length, 0);
  assert.equal(detailed?.seasons[1]?.episodes[0]?.name, 'Winter Is Coming');
  assert.equal(detailed?.seasons[1]?.episodes[0]?.posterUrl, 'https://image.tmdb.org/t/p/w300/wI3pV6ey3e3B9z7pmBGg0P3q61K.jpg');
  assert.equal(detailed?.seasons[1]?.episodes[0]?.id, 'tmdb:tv:1399:s1e1');
  assert.deepEqual(detailed?.seasons[1]?.episodes[0]?.sources, []);
  assert.equal(detailed?.seasons[2]?.episodes.length, 0);
  const count = calls.length;
  await catalog.detail('tmdb:tv:1399');
  assert.equal(calls.length, count);
  const second = await catalog.season('tmdb:tv:1399', 2);
  assert.equal(second?.episodes[0]?.name, 'The North Remembers');
  const reloaded = new CineHdCatalog(storage, async () => null, async () => { throw new Error('offline'); });
  await reloaded.load();
  assert.equal((await reloaded.detail('tmdb:tv:1399'))?.seasons[2]?.episodes[0]?.name, 'The North Remembers');
});

test('cache hydration strips stream URLs and unsafe artwork, malformed responses retain the catalog', async () => {
  const storage = new MemoryStorage();
  const initial = new CineHdCatalog(storage, async () => null, async () => response({ results: [movie] }));
  await initial.search('Oppenheimer');
  const saved = storage.map.get(CINEHD_METADATA_KEY);
  assert.ok(saved);
  const poisoned = saved.replace('"posterUrl":"https://image.tmdb.org/t/p/w500/ptpr0kGAckfQkJeJIt8st5dglvd.jpg"', '"posterUrl":"https://attacker.test/image.jpg"').replace('"video":""', '"video":"https://attacker.test/ad.mp4"');
  storage.map.set(CINEHD_METADATA_KEY, poisoned);
  const loaded = new CineHdCatalog(storage, async () => null, async () => response({ unexpected: true }));
  await loaded.load();
  assert.equal(loaded.get('tmdb:movie:872585')?.posterUrl, undefined);
  assert.equal(loaded.get('tmdb:movie:872585')?.video, '');
  await assert.rejects(loaded.search('bad-response'), isCode('malformed'));
  assert.equal(loaded.all().length, 1);
  assert.equal(tmdbImage('/../private.jpg'), undefined);
  assert.equal(tmdbImage('https://attacker.test/poster.jpg'), undefined);
});
