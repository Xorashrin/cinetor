import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TITLE, type Title } from '../../src/data/mock';
import { ProviderHttp, publicUrl, type ProviderFetch } from '../../src/providers/request';
import { DOMAIN_PROXY_URL, NativeStreamResolver } from '../../src/providers/streams';

const pageOrigin = 'https://player.example';
const playlistOrigin = 'https://playlist.example';
const csrf = 'ephemeral-provider-token';
const movie: Title = { ...DEFAULT_TITLE, id: 'tmdb:movie:872585', name: 'Oppenheimer', kind: 'movie', imdbId: 'tt15398776' };
const series: Title = { ...DEFAULT_TITLE, id: 'tmdb:tv:1399', name: 'Game of Thrones', imdbId: 'tt0944947' };
interface Call { url: string; method: string | undefined; headers: Headers }

function mp4(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[3] = 24;
  bytes.set(new TextEncoder().encode('ftypisom'), 4);
  return bytes;
}
function transportStream(): Uint8Array {
  const bytes = new Uint8Array(188 * 3);
  bytes[0] = bytes[188] = bytes[376] = 0x47;
  return bytes;
}
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}
function fixture(playlist: unknown, leaves: Record<string, string>, calls: Call[] = []): NativeStreamResolver {
  const fetcher: ProviderFetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method, headers });
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'manual');
    if (url === new URL(DOMAIN_PROXY_URL).toString()) return json({ awsIndStreamDomain: pageOrigin });
    if (url.startsWith(pageOrigin + '/play/')) {
      assert.equal(init?.method, 'GET');
      return new Response(JSON.stringify({ file: playlistOrigin + '/playlist/root.txt', key: csrf }), { headers: { 'Content-Type': 'text/html' } });
    }
    if (url === playlistOrigin + '/playlist/root.txt') {
      assert.equal(init?.method, 'POST');
      assert.equal(headers.get('x-csrf-token'), csrf);
      assert.equal(headers.get('origin'), playlistOrigin);
      return json(playlist);
    }
    if (url.startsWith(playlistOrigin + '/playlist/')) {
      assert.equal(init?.method, 'POST');
      assert.equal(headers.get('x-csrf-token'), csrf);
      const leaf = new URL(url).pathname.split('/').pop()?.replace('.txt', '') ?? '';
      if (!leaves[leaf]) throw new Error('Unknown fixture leaf: ' + leaf);
      return json(leaves[leaf]);
    }
    if (url.endsWith('.mp4')) {
      assert.equal(headers.has('x-csrf-token'), false);
      assert.equal(headers.get('range'), 'bytes=0-4095');
      return new Response(mp4(), { headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-31/32', 'Content-Length': '32' }, status: 206 });
    }
    throw new Error('Unexpected fixture request: ' + url);
  };
  return new NativeStreamResolver(new ProviderHttp(fetcher));
}

test('recovered GET page/domain then cross-domain POST playlists produce verified MP4 with ephemeral headers', async () => {
  const calls: Call[] = [];
  const resolver = fixture([{ title: 'English 1080p', file: '~english1080' }], { english1080: 'https://cdn.example/movie.mp4' }, calls);
  const refs = await resolver.resolve(movie);
  assert.equal(refs.length, 1);
  assert.equal(refs[0]?.url, 'https://cdn.example/movie.mp4');
  assert.equal(refs[0]?.container, 'mp4');
  assert.equal(refs[0]?.downloadable, true);
  assert.equal(refs[0]?.verificationState, 'transport-verified');
  assert.equal(refs[0]?.label, 'English 1080p');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'GET', 'POST', 'POST', 'GET']);
  assert.deepEqual(calls.map(call => call.url), [new URL(DOMAIN_PROXY_URL).toString(), pageOrigin + '/play/tt15398776', playlistOrigin + '/playlist/root.txt', playlistOrigin + '/playlist/english1080.txt', 'https://cdn.example/movie.mp4']);
  assert.equal(refs[0]?.headers?.referer, pageOrigin + '/play/tt15398776');
  assert.equal(refs[0]?.headers?.origin, playlistOrigin);
  assert.equal(resolver.headers(refs[0]?.url ?? '')?.['x-csrf-token'], undefined);
  assert.equal(JSON.stringify(refs).includes(csrf), false);
  const before = calls.length;
  assert.deepEqual(await resolver.resolve(movie), refs);
  assert.equal(calls.length, before);
});

test('movie playlist language/quality folders flatten into independent candidate mirrors', async () => {
  const resolver = fixture([{ title: 'Languages', folder: [
    { title: 'English', folder: [{ title: '1080p', file: '~eng1080' }] },
    { title: 'Hindi', folder: [{ title: '720p', file: '~hin720' }] },
  ] }], { eng1080: 'https://cdn.example/english.mp4', hin720: 'https://cdn.example/hindi.mp4' });
  const refs = await resolver.resolve(movie);
  assert.deepEqual(refs.map(ref => ref.url), ['https://cdn.example/english.mp4', 'https://cdn.example/hindi.mp4']);
  resolver.report(refs[0]?.url ?? '', false);
  assert.deepEqual(resolver.alternatives(movie.id).map(ref => ref.url), ['https://cdn.example/hindi.mp4']);
  resolver.report(refs[0]?.url ?? '', true);
  assert.equal(resolver.alternatives(movie.id).length, 2);
  assert.equal(resolver.alternatives(movie.id, undefined, undefined, new Set(refs.map(ref => ref.url))).length, 0);
});

test('sparse labeled seasons/episodes resolve actual coordinates and omit missing coordinates', async () => {
  const calls: Call[] = [];
  const resolver = fixture([{ title: 'Season 2', folder: [{ title: 'Episode 3', folder: [{ title: 'English', file: '~s2e3' }] }] }], { s2e3: 'https://cdn.example/s2e3.mp4' }, calls);
  const refs = await resolver.resolve(series, 2, 3);
  assert.equal(refs[0]?.url, 'https://cdn.example/s2e3.mp4');
  assert.ok(calls.some(call => call.url.endsWith('/playlist/s2e3.txt')));
  await assert.rejects(resolver.resolve(series, 1, 1), { code: 'unsupported' });
  assert.equal(calls.filter(call => call.url.endsWith('/playlist/s2e3.txt')).length, 1);
});

test('explicit season/episode fields work with providers that omit display labels', async () => {
  const resolver = fixture([{ season_number: 4, folder: [{ episode_number: 7, folder: [{ file: '~s4e7' }] }] }], { s4e7: 'https://cdn.example/s4e7.mp4' });
  assert.equal((await resolver.resolve(series, 4, 7))[0]?.url, 'https://cdn.example/s4e7.mp4');
});

test('HLS master and media playlists require a valid TS segment and preserve directory User-Agent', async () => {
  const requested: string[] = [];
  const resolver = new NativeStreamResolver(new ProviderHttp(async (input, init) => {
    const url = String(input);
    requested.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('user-agent'), 'DirectoryPlayer/1');
    assert.equal(headers.get('referer'), 'https://station.example/');
    assert.equal(headers.has('x-csrf-token'), false);
    if (url.endsWith('/master.m3u8')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nvideo/media.m3u8\n');
    if (url.endsWith('/video/media.m3u8')) return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n');
    if (url.endsWith('/video/segment.ts')) return new Response(transportStream());
    throw new Error('Unexpected HLS fixture');
  }));
  const ref = await resolver.probe('https://cdn.example/master.m3u8', { 'user-agent': 'DirectoryPlayer/1', referer: 'https://station.example/', origin: 'https://station.example', 'x-csrf-token': csrf }, 'Live TV');
  assert.equal(ref.url, 'https://cdn.example/master.m3u8');
  assert.equal(ref.container, 'hls');
  assert.equal(ref.downloadable, true);
  assert.equal(ref.headers?.['User-Agent'], 'DirectoryPlayer/1');
  assert.deepEqual(requested, ['https://cdn.example/master.m3u8', 'https://cdn.example/video/media.m3u8', 'https://cdn.example/video/segment.ts']);
});

test('HTML media, private endpoints, ads, encrypted HLS and invalid transport segments never verify', async () => {
  const html = new NativeStreamResolver(new ProviderHttp(async () => new Response('<html>An advertisement</html>', { headers: { 'Content-Type': 'text/html' } })));
  await assert.rejects(html.probe('https://cdn.example/pretend.mp4', {}, 'Fake'), { code: 'malformed' });
  await assert.rejects(html.probe('https://cdn.example/pretend.m3u8', {}, 'Fake'), { code: 'unsupported' });
  await assert.rejects(html.probe('https://127.0.0.1/private.mp4', {}, 'Private'), { code: 'scope' });
  const ads = new NativeStreamResolver(new ProviderHttp(async () => new Response('#EXTM3U\n#EXT-X-DATERANGE:ID="ad-1",CLASS="ad"\n#EXTINF:6,\none.ts\n')));
  await assert.rejects(ads.probe('https://cdn.example/ads.m3u8', {}, 'Ads'), { code: 'unsupported' });
  const encrypted = new NativeStreamResolver(new ProviderHttp(async () => new Response('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:6,\none.ts\n')));
  await assert.rejects(encrypted.probe('https://cdn.example/drm.m3u8', {}, 'DRM'), { code: 'unsupported' });
  const corrupt = new NativeStreamResolver(new ProviderHttp(async input => new Response(String(input).endsWith('.m3u8') ? '#EXTM3U\n#EXTINF:6,\none.ts\n' : 'not video')));
  await assert.rejects(corrupt.probe('https://cdn.example/corrupt.m3u8', {}, 'Corrupt'), { code: 'unsupported' });
});

test('malformed provider leaf and a failed mirror leave an independently verified alternative usable', async () => {
  const calls: Call[] = [];
  const resolver = fixture([{ file: '~../private' }, { title: 'Unavailable', file: '~broken' }, { title: 'English', file: '~valid' }], { broken: 'https://cdn.example/not-media.html', valid: 'https://cdn.example/valid.mp4' }, calls);
  const refs = await resolver.resolve(movie);
  assert.deepEqual(refs.map(ref => ref.url), ['https://cdn.example/valid.mp4']);
  assert.equal(calls.some(call => call.url.includes('/private')), false);
  const allMalformed = fixture([{ file: '~../private' }], {}, []);
  await assert.rejects(allMalformed.resolve(movie), { code: 'unsupported' });
});

test('ProviderHttp cancels hung fetches, times out hung readers, and normalizes transport errors', async context => {
  let signal: AbortSignal | null | undefined;
  const pending = new ProviderHttp(async (_input, init) => {
    signal = init?.signal;
    return new Promise(() => undefined);
  });
  const outer = new AbortController();
  const work = pending.request('https://provider.example/hang', { signal: outer.signal });
  outer.abort();
  await assert.rejects(work, { code: 'cancelled' });
  assert.equal(signal?.aborted, true);

  context.mock.timers.enable({ apis: ['setTimeout'] });
  let readerSignal: AbortSignal | null | undefined;
  const readHang = new ProviderHttp(async (_input, init) => {
    readerSignal = init?.signal;
    return new Response(new ReadableStream({ start() {} }));
  });
  const read = readHang.request('https://provider.example/hung-body');
  await Promise.resolve();
  context.mock.timers.tick(10001);
  await assert.rejects(read, { code: 'timeout' });
  assert.equal(readerSignal?.aborted, true);
  context.mock.timers.reset();
  const networkFailure = new ProviderHttp(async () => { throw new TypeError('socket closed'); });
  await assert.rejects(networkFailure.request('https://provider.example/failure'), { code: 'network' });
});

test('public HTTPS URLs and bounded responses reject unsafe redirects, credentials and oversized data', async () => {
  for (const url of ['http://media.example/file.mp4', 'https://10.2.3.4/file.mp4', 'https://192.168.1.2/file.mp4', 'https://172.16.1.2/file.mp4', 'https://user:pass@media.example/file.mp4', 'https://service.local/file.mp4'])
    assert.throws(() => publicUrl(url), { code: 'scope' });
  assert.equal(publicUrl('../movie.mp4#ignored', 'https://media.example/path/master.m3u8'), 'https://media.example/movie.mp4');
  let calls = 0;
  const redirect = new ProviderHttp(async () => {
    calls++;
    return new Response('', { status: 302, headers: { Location: 'https://different.example/playlist/data.txt' } });
  });
  await assert.rejects(redirect.request('https://provider.example/playlist/data.txt', { headers: { 'x-csrf-token': csrf } }), { code: 'scope' });
  assert.equal(calls, 1);
  const oversized = new ProviderHttp(async () => new Response('x'.repeat(2000)));
  await assert.rejects(oversized.request('https://provider.example/data', { maxBytes: 1000 }), { code: 'size' });
  const prefix = await oversized.request('https://provider.example/data', { maxBytes: 64, prefix: true });
  assert.equal(prefix.bytes.length, 64);
});
