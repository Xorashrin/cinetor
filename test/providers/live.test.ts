import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CineHdLiveDirectory, CINEHD_LIVE_KEY } from '../../src/providers/live';
import { ProviderHttp, type ProviderFetch } from '../../src/providers/request';
class MemoryStorage {
  map = new Map<string, string>();
  fail = false;
  async getItem(key: string): Promise<string | null> { return this.map.get(key) ?? null; }
  async setItem(key: string, value: string): Promise<void> {
    if (this.fail) throw new Error('Simulated storage failure');
    this.map.set(key, value);
  }
}

function fixture() {
  return {
    countries: [{ code: 'BD', name: 'Bangladesh' }, { code: 'IN', name: 'India' }, { code: 'US', name: 'United States' }],
    categories: [{ id: 'news', name: 'News' }, { id: 'movies', name: 'Movies' }, { id: 'xxx', name: 'XXX' }],
    channels: [
      { id: 'News.bd', name: 'Bangladesh News', country: 'BD', categories: ['news'], is_nsfw: false },
      { id: 'Film.in', name: 'India Film', country: 'IN', categories: ['movies'], is_nsfw: false },
      { id: 'General.us', name: 'General TV', country: 'US', categories: [], is_nsfw: false },
      { id: 'Private.bd', name: 'Private Stream', country: 'BD', categories: ['news'], is_nsfw: false },
      { id: 'Nsfw.us', name: 'Restricted', country: 'US', categories: [], is_nsfw: true },
      { id: 'Adult.us', name: 'Restricted Category', country: 'US', categories: ['xxx'], is_nsfw: false },
      { id: 'Unknown.us', name: 'Unknown Classification', country: 'US', categories: [] },
    ],
    logos: [
      { channel: 'News.bd', url: 'https://logos.example/news-old.png', in_use: false, feed: null },
      { channel: 'News.bd', url: 'https://logos.example/news.png', in_use: true, feed: null },
      { channel: 'Film.in', url: 'http://logos.example/film.png', in_use: true },
    ],
    streams: [
      { channel: 'News.bd', url: 'https://media.example/news-sd.m3u8', quality: '480p' },
      { channel: 'News.bd', url: 'https://media.example/news.m3u8', quality: '1080p', user_agent: 'DirectoryPlayer/1', referrer: 'https://station.example/' },
      { channel: 'News.bd', url: 'https://media.example/news.m3u8', quality: '720p' },
      { channel: 'Film.in', url: 'https://media.example/film.mp4' },
      { channel: 'General.us', url: 'https://media.example/general.m3u8', quality: '720p' },
      { channel: 'General.us', url: 'https://media.example/embed.html' },
      { channel: 'General.us', url: 'http://media.example/general.m3u8' },
      { channel: 'Private.bd', url: 'https://127.0.0.1/private.m3u8' },
      { channel: 'Nsfw.us', url: 'https://media.example/restricted.m3u8' },
      { channel: 'Adult.us', url: 'https://media.example/adult.m3u8' },
      { channel: 'Unknown.us', url: 'https://media.example/unknown.m3u8' },
    ],
  };
}
type Fixture = ReturnType<typeof fixture>;
function provider(data: Fixture, requested: string[] = [], failure?: string): ProviderHttp {
  const fetcher: ProviderFetch = async (input, init) => {
    const url = String(input);
    const endpoint = new URL(url).pathname.split('/').pop()?.replace('.json', '');
    requested.push(endpoint ?? '');
    assert.equal(init?.credentials, 'omit');
    if (endpoint === failure) return new Response('', { status: 503 });
    const value = endpoint === 'channels' ? data.channels : endpoint === 'streams' ? data.streams :
      endpoint === 'logos' ? data.logos : endpoint === 'countries' ? data.countries :
      endpoint === 'categories' ? data.categories : undefined;
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  };
  return new ProviderHttp(fetcher);
}

test('live directory maps current provider schemas, ranks local countries, and filters unsafe or restricted candidates', async () => {
  const storage = new MemoryStorage(), requested: string[] = [];
  const directory = new CineHdLiveDirectory(storage, provider(fixture(), requested));
  let events = 0;
  const unsubscribe = directory.subscribe(() => { events++; });
  await directory.refresh();
  assert.deepEqual(requested.sort(), ['categories', 'channels', 'countries', 'logos', 'streams']);
  const channels = directory.all();
  assert.deepEqual(channels.map(row => row.id), ['iptv:News.bd', 'iptv:Film.in', 'iptv:General.us']);
  assert.equal(channels[0].category, 'News');
  assert.equal(channels[0].country, 'Bangladesh');
  assert.equal(channels[0].quality, 'HD');
  assert.equal(channels[0].logo, 'https://logos.example/news.png');
  assert.equal(channels[1].logo, '');
  assert.deepEqual(channels[0].fallbacks, ['https://media.example/news-sd.m3u8']);
  assert.deepEqual(directory.headers(channels[0].url), { 'User-Agent': 'DirectoryPlayer/1', referer: 'https://station.example/' });
  assert.equal('verificationState' in channels[0], false);
  assert.equal(events, 1);
  channels[0].fallbacks.push('https://malicious.example/changed.m3u8');
  assert.equal(directory.all()[0].fallbacks.length, 1);
  unsubscribe();
  assert(storage.map.has(CINEHD_LIVE_KEY));
});

test('cached directory restores candidate URLs and headers without network access', async () => {
  const storage = new MemoryStorage();
  const first = new CineHdLiveDirectory(storage, provider(fixture()));
  await first.refresh();
  const calls: string[] = [];
  const restored = new CineHdLiveDirectory(storage, provider(fixture(), calls));
  await restored.load();
  assert.deepEqual(restored.all(), first.all());
  assert.deepEqual(restored.headers(first.all()[0].url), first.headers(first.all()[0].url));
  assert.equal(calls.length, 0);
});

test('DASH directory candidates retain their manifest URL across cache hydration', async () => {
  const data = fixture();
  data.streams = data.streams.map(row => row.url === 'https://media.example/general.m3u8' ? { ...row, url: 'https://media.example/general.mpd' } : row);
  const storage = new MemoryStorage();
  const first = new CineHdLiveDirectory(storage, provider(data));
  await first.refresh();
  assert.equal(first.all().find(row => row.id === 'iptv:General.us')?.url, 'https://media.example/general.mpd');
  const calls: string[] = [];
  const restored = new CineHdLiveDirectory(storage, provider(data, calls));
  await restored.load();
  assert.deepEqual(restored.all(), first.all());
  assert.equal(calls.length, 0);
});

test('failed network and storage refreshes retain the last complete directory and persisted cache', async () => {
  const storage = new MemoryStorage();
  const first = new CineHdLiveDirectory(storage, provider(fixture()));
  await first.refresh();
  const saved = storage.map.get(CINEHD_LIVE_KEY);
  const offline = new CineHdLiveDirectory(storage, provider(fixture(), [], 'streams'));
  await offline.load();
  const before = offline.all();
  await assert.rejects(offline.refresh(), { code: 'http' });
  assert.deepEqual(offline.all(), before);
  assert.equal(storage.map.get(CINEHD_LIVE_KEY), saved);
  storage.fail = true;
  await assert.rejects(first.refresh(), { code: 'storage' });
  assert.deepEqual(first.all(), before);
  assert.equal(storage.map.get(CINEHD_LIVE_KEY), saved);
});

test('cancelled and malformed refreshes never publish a partial snapshot', async () => {
  const storage = new MemoryStorage(), requested: string[] = [];
  const directory = new CineHdLiveDirectory(storage, provider(fixture(), requested));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(directory.refresh(controller.signal), { code: 'cancelled' });
  assert.equal(requested.length, 0);
  const fetcher: ProviderFetch = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  const malformed = new CineHdLiveDirectory(storage, new ProviderHttp(fetcher));
  await assert.rejects(malformed.refresh(), { code: 'malformed' });
  assert.equal(malformed.all().length, 0);
  assert.equal(storage.map.has(CINEHD_LIVE_KEY), false);
});

test('cache revalidates URLs and rejects invalid schemas before hydration', async () => {
  const storage = new MemoryStorage();
  storage.map.set(CINEHD_LIVE_KEY, JSON.stringify({ schemaVersion: 1, headers: [], channels: [{
    id: 'iptv:Unsafe.us', name: 'Unsafe', country: 'United States', category: 'News', quality: 'HD',
    logo: '', url: 'https://192.168.1.2/live.m3u8', fallbacks: [],
  }] }));
  const directory = new CineHdLiveDirectory(storage, provider(fixture()));
  await directory.load();
  assert.equal(directory.all().length, 0);
  storage.map.set(CINEHD_LIVE_KEY, JSON.stringify({ schemaVersion: 2, channels: [], headers: [] }));
  await directory.load();
  assert.equal(directory.all().length, 0);
});
