import assert from 'node:assert/strict';
import test from 'node:test';
import { BdixEngine, BdixError, NativeBdixTransport, type BdixEndpoint, type BdixTransport, type CinetorBdixNative } from '../../src/providers/bdix';
import { BDIX_LIMITS, containedUrl, contentKey, endpointRoot, normalizeEndpoints, utf8Length } from '../../src/providers/bdix/paths';
import { parseBdixListing } from '../../src/providers/bdix/listing';
import type { BdixListResponse, BdixNetworkContext, BdixPrepared, BdixProbe } from '../../src/providers/bdix/transport';

const root = 'https://owned.example/media/';
const movie = { namespace: 'tmdb', mediaType: 'movie', externalId: 123 } as const;
const network: BdixNetworkContext = { id: '12345', epoch: 1, transport: 'wifi' };
const token = 'A'.repeat(43);
const approved = (values: Partial<BdixEndpoint> = {}): BdixEndpoint => ({
  id: 'owned', name: 'My owned endpoint', url: root, enabled: true, network: 'wifi', allowPlainFtp: false,
  mappings: [{ contentKey: 'tmdb:movie:123', path: 'movie.mp4' }], ...values,
});
const errorCode = (code: string, reason?: string) => (error: unknown) => error instanceof BdixError && error.code === code && (!reason || error.reason === reason);
const html = (text: string, url = root): BdixListResponse => ({ url, text, bytes: utf8Length(text), contentType: 'text/html', networkContext: network });
const parse = (text: string, contentType = 'text/html') => parseBdixListing(text, { root, url: root, contentType });
const prepared = (): BdixPrepared => ({ uri: `http://127.0.0.1:32123/media/${token}/video.mp4`, token, expiresAt: Date.now() + 60000,
  networkContext: network, container: 'mp4', mimeType: 'video/mp4', sizeBytes: 32768, restart: 'unverified',
  representationId: 'bdix-spool:15ee91e8-42e7-4c86-a924-99f103fc560e', representationValidator: '"bdix-15ee91e8-42e7-4c86-a924-99f103fc560e"' });

class FixtureTransport implements BdixTransport {
  configured: ReadonlyArray<BdixEndpoint> = [];
  requests: string[] = [];
  releases: string[] = [];
  prepares = 0;
  contextValue = network;
  listener?: () => void;
  listing: (url: string, signal: AbortSignal) => Promise<BdixListResponse> = async url => html('', url);
  preparation: (signal: AbortSignal) => Promise<BdixPrepared> = async () => prepared();
  async configure(endpoints: ReadonlyArray<BdixEndpoint>) { this.configured = endpoints; }
  async context() { return this.contextValue; }
  async list(_endpoint: BdixEndpoint, url: string, _limits: { maxBytes: number; maxItems: number }, signal: AbortSignal) {
    this.requests.push(url); return this.listing(url, signal);
  }
  async probe(): Promise<BdixProbe> { return prepared(); }
  async preparePlayback(_endpoint: BdixEndpoint, _path: string, signal: AbortSignal) { this.prepares++; return this.preparation(signal); }
  async release(value: string) { this.releases.push(value); }
  subscribe(listener: () => void) { this.listener = listener; return () => { this.listener = undefined; }; }
}

for (const [name, source] of [
  ['Apache table', '<table><tr><td><a href="movie.mp4">Movie &amp; extras</a></td><td>20M</td></tr><tr><td><a href="TV/">TV/</a></td></tr></table>'],
  ['nginx pre', "<pre><a href='movie.mp4'>Movie &amp; extras</a> 24-Oct-2026 20M\n<a href='TV/'>TV/</a></pre>"],
  ['IIS', '<pre> 10/24/2026 &lt;dir&gt; <A HREF="/media/TV/">TV/</A><br>2048 <A HREF=/media/movie.mp4>Movie &amp; extras</A></pre>'],
]) test(`structured ${name} listings decode entities and quote variants`, () => {
  const result = parse(source);
  assert.equal(result.entries.length, 2);
  const file = result.entries.find(row => row.kind === 'file');
  assert.equal(file?.url, `${root}movie.mp4`);
  assert.equal(file?.name, 'Movie & extras');
  assert.equal(file?.sizeBytes, undefined, 'human-readable HTML sizes are not exact evidence');
});

test('Unicode path spelling is exact, entities decode once, and duplicate escaped ASCII collapses', () => {
  const result = parse('<a href="Caf&#233;%20cut.mp4">Caf&#233;</a><a href="./Caf%C3%A9%20cut.mp4">duplicate</a><a href="Cafe%CC%81.mp4">different Unicode filename</a>');
  assert.deepEqual(result.entries.map(row => row.url), [`${root}Caf%C3%A9%20cut.mp4`, `${root}Cafe%CC%81.mp4`]);
  assert.equal(containedUrl(root, '%6dovie.mp4'), `${root}movie.mp4`);
  assert.equal(containedUrl(root, "director's%20cut.mp4"), `${root}director%27s%20cut.mp4`);
});

test('containment rejects credentials, authorities, encoded traversal, separators, controls, and query credentials', () => {
  for (const value of ['../private.mp4', '/media-other/file.mp4', '//other.example/media/file.mp4', 'http://owned.example/media/movie.mp4',
    'https://owned.example:444/media/movie.mp4', 'https://user:secret@owned.example/media/a.mp4', 'a%2fb.mp4', '%2e%2e/file.mp4',
    '%252e%252e/file.mp4', 'a%5cb.mp4', 'a%00.mp4', 'a%0d%0a.mp4', 'a\\b.mp4', '%zz.mp4', 'a.mp4#fragment',
    'a.mp4?token=secret', 'data:video/mp4;base64,AAA']) assert.throws(() => containedUrl(root, value), errorCode('scope'), value);
  assert.equal(containedUrl(root, '../movie.mp4', `${root}TV/`), `${root}movie.mp4`);
  assert.throws(() => containedUrl('ftps://one.example/media/', 'ftps://two.example/media/a.mp4'), errorCode('scope'));
  assert.throws(() => endpointRoot('https://owned.example/media'), errorCode('configuration'));
  assert.throws(() => containedUrl('https://owned.example/media', '/media-other/a.mp4'), errorCode('scope'));
});

test('base tags, scripts, forms, and navigation cannot expand endpoint scope', () => {
  const result = parse('<base href="https://evil.example/"><script><a href="hidden.mp4">hidden</a></script><iframe><a href="bad.mp4">bad</a></iframe>' +
    '<form action="/admin"></form><a href="../">Parent</a><a href="https://evil.example/a.mp4">escape</a><a href="movie.mp4">owned</a>');
  assert.deepEqual(result.entries.map(row => row.url), [`${root}movie.mp4`]);
  assert.equal(result.rejected, 2);
});

test('explicit rel=next supports bounded pagination without treating sorting links as entries', () => {
  const result = parse('<a href="?C=N;O=D">sort</a><a href="?page=2" rel="next">Next</a><link rel=next href="?offset=30"><a rel=next href="?token=secret">unsafe</a>');
  assert.deepEqual(result.next, [`${root}?page=2`, `${root}?offset=30`]);
  assert.equal(result.entries.length, 0);
  assert.equal(result.rejected, 2);
  assert.throws(() => containedUrl(root, '?page=1&page=2', root, true), errorCode('scope'));
});

test('nginx JSON and explicit owned API schema preserve exact paths and quarantine conflicting metadata', () => {
  const nginx = parse(JSON.stringify([{ name: 'Sample & cut.mp4', type: 'file', size: 4096 }, { name: 'TV', type: 'directory' }]), 'application/json');
  assert.equal(nginx.entries[0].url, `${root}Sample%20%26%20cut.mp4`);
  assert.equal(nginx.entries[0].sizeBytes, 4096);
  assert.equal(nginx.entries[1].url, `${root}TV/`);
  const api = parse(JSON.stringify({ entries: [
    { name: 'one', href: 'movie.mp4', type: 'file', sizeBytes: 100 },
    { name: 'two', href: './movie.mp4', type: 'file', sizeBytes: 200 },
    { name: 'escape', href: '../secret.mp4', type: 'file' },
  ], next: '?cursor=abc' }), 'application/vnd.cinetor.directory+json');
  assert.equal(api.entries.length, 0);
  assert.deepEqual(api.ambiguous, [`${root}movie.mp4`]);
  assert.deepEqual(api.next, [`${root}?cursor=abc`]);
  assert.throws(() => parse('{"files":[]}', 'application/json'), errorCode('malformed'));
  assert.throws(() => parse('{"entries":[],"next":42}', 'application/json'), errorCode('malformed'));
});

test('listing byte/item/node budgets count rejected and duplicate data, and preabort does no parsing', () => {
  const abort = new AbortController(); abort.abort();
  assert.throws(() => parseBdixListing('malformed', { root, url: root, contentType: 'text/html', signal: abort.signal }), errorCode('cancelled'));
  assert.throws(() => parseBdixListing('é'.repeat(10), { root, url: root, contentType: 'text/html', maxBytes: 15 }), errorCode('size'));
  assert.throws(() => parseBdixListing('<a href="../">escape</a>'.repeat(3), { root, url: root, contentType: 'text/html', maxItems: 2 }), errorCode('size'));
  assert.throws(() => parseBdixListing('<a href="movie.mp4">duplicate</a>'.repeat(3), { root, url: root, contentType: 'text/html', maxItems: 2 }), errorCode('size'));
  assert.throws(() => parseBdixListing('<br>'.repeat(400), { root, url: root, contentType: 'text/html', maxItems: 1 }), errorCode('size'));
  assert.throws(() => parse('x', 'application/javascript'), errorCode('unsupported'));
});

test('movie and parent-qualified episode identities are exact, including season zero', () => {
  assert.equal(contentKey(movie), 'tmdb:movie:123');
  assert.equal(contentKey({ ...movie, mediaType: 'tv', season: 0, episode: 2 }), 'tmdb:tv:123:s0e2');
  for (const ref of [{ ...movie, mediaType: 'tv' }, { ...movie, season: 1, episode: 1 }, { ...movie, externalId: -1 },
    { ...movie, mediaType: 'tv', season: 1, episode: 0 }, { ...movie, mediaType: 'tv', season: 1.5, episode: 1 }])
    assert.throws(() => contentKey(ref as typeof movie), errorCode('configuration'));
  assert.throws(() => normalizeEndpoints([approved({ mappings: [{ contentKey: 'tmdb:tv:123', path: 'movie.mp4' }] })]), errorCode('configuration'));
});

test('endpoint permission is explicit for cleartext HTTP, FTP, anonymous accounts, and unsupported auth', () => {
  assert.throws(() => normalizeEndpoints([approved({ url: 'ftp://owned.example/media/' })]), errorCode('permission'));
  assert.throws(() => normalizeEndpoints([approved({ url: 'ftp://owned.example/media/', allowPlainFtp: true })]), errorCode('authentication'));
  assert.throws(() => normalizeEndpoints([approved({ url: 'ftps://owned.example/media/' })]), errorCode('authentication'));
  assert.throws(() => normalizeEndpoints([approved({ url: 'http://192.168.1.2/media/' })]), errorCode('permission'));
  assert.equal(normalizeEndpoints([approved({ url: 'http://192.168.1.2/media/', allowCleartextHttp: true })]).length, 1);
  assert.equal(normalizeEndpoints([approved({ url: 'ftp://owned.example/media/', allowPlainFtp: true, anonymous: true })]).length, 1);
  assert.throws(() => normalizeEndpoints([approved({ credentialRef: 'opaque-ref' })]), errorCode('unsupported', 'authentication-unsupported'));
  assert.throws(() => normalizeEndpoints([approved({ url: 'https://name:password@owned.example/media/' })]), errorCode('scope'));
  assert.throws(() => normalizeEndpoints([approved(), approved()]), errorCode('configuration'));
});

test('mapping collisions are quarantined, not filename fuzzy-matched or order-selected', () => {
  assert.throws(() => normalizeEndpoints([approved({ mappings: [{ contentKey: 'tmdb:movie:123', path: 'a.mp4' }, { contentKey: 'tmdb:movie:123', path: 'b.mp4' }] })]), errorCode('configuration', 'ambiguous-mapping'));
  assert.throws(() => normalizeEndpoints([approved({ mappings: [{ contentKey: 'tmdb:movie:123', path: 'a.mp4' }, { contentKey: 'tmdb:movie:456', path: '%61.mp4' }] })]), errorCode('configuration', 'ambiguous-mapping'));
  assert.throws(() => normalizeEndpoints([approved({ mappings: [{ contentKey: 'tmdb:movie:123', path: 'video.m3u8' }] })]), errorCode('unsupported'));
});

test('construction/configuration does no network work; resolve uses only explicit canonical saved pins', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport);
  await engine.configure([approved()]);
  assert.equal(transport.requests.length, 0); assert.equal(transport.prepares, 0);
  assert.deepEqual(await engine.resolve({ ...movie, externalId: 999 }), []);
  assert.equal(transport.prepares, 0);
  const [source] = await engine.resolve(movie);
  assert.equal(source.contentKey, 'tmdb:movie:123'); assert.equal(source.nativeToken, token);
  assert.equal(source.networkContext, 'wifi:12345:1'); assert.equal(source.verificationState, 'transport-verified');
  assert.ok(source.url.startsWith('http://127.0.0.1:')); assert.equal(transport.requests.length, 0);
  await engine.close(token); assert.ok(transport.releases.includes(token)); await engine.dispose();
});

test('index follows only bounded same-root links and pagination, with cycles visited once', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport);
  transport.listing = async url => html(url === root ? '<a href="TV/">TV</a><a href="movie.mp4">Movie</a><a href="../">escape</a>' :
    '<a href="../">root cycle</a><a href="episode.mp4">not pinned</a><a href="?page=2" rel=next>next/cycle</a>', url);
  await engine.configure([approved()]);
  const index = await engine.index('owned');
  assert.equal(index.pages, 3); assert.equal(new Set(transport.requests).size, transport.requests.length);
  assert.equal(index.files.find(file => file.url === `${root}movie.mp4`)?.contentKey, 'tmdb:movie:123');
  assert.equal(index.files.find(file => file.name === 'not pinned')?.contentKey, undefined);
  assert.equal(index.truncated, false); await engine.dispose();
});

test('index limits native list concurrency to four and depth to four', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport);
  let active = 0, peak = 0;
  transport.listing = async url => {
    active++; peak = Math.max(active, peak);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return html(url === root ? Array.from({ length: 8 }, (_, i) => `<a href="${i}/">dir</a>`).join('') : '<a href="deep/">deeper</a>', url);
  };
  await engine.configure([approved()]);
  const index = await engine.index('owned');
  assert.equal(peak, 4); assert.equal(active, 0); assert.ok(index.truncated);
  assert.ok(index.pages <= BDIX_LIMITS.pages);
  assert.ok(transport.requests.every(url => new URL(url).pathname.split('/').filter(Boolean).length <= 5));
  await engine.dispose();
});

test('preabort issues zero I/O; disabled endpoints cannot index or resolve', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport), abort = new AbortController();
  await engine.configure([approved({ enabled: false })]); abort.abort();
  await assert.rejects(engine.index('owned', abort.signal), errorCode('cancelled'));
  await assert.rejects(engine.resolve(movie, abort.signal), errorCode('cancelled'));
  await assert.rejects(engine.index('owned'), errorCode('permission'));
  assert.deepEqual(await engine.resolve(movie), []); assert.equal(transport.prepares, 0); assert.equal(transport.requests.length, 0);
  await engine.dispose();
});

test('consent revoke cancels indexing and waits for transport cancellation before failing', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport);
  let begun!: () => void, closed = false;
  const started = new Promise<void>(resolve => { begun = resolve; });
  transport.listing = (url, signal) => new Promise((_resolve, reject) => {
    begun(); signal.addEventListener('abort', () => { closed = true; reject(new BdixError('cancelled')); }, { once: true });
  });
  await engine.configure([approved()]);
  const result = engine.index('owned'); const rejected = assert.rejects(result, errorCode('cancelled'));
  await started; await engine.configure([]); await rejected;
  assert.equal(closed, true); await engine.dispose();
});

test('network epoch change invalidates pending prepared tokens instead of publishing stale sources', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport);
  transport.preparation = async () => { transport.contextValue = { ...network, epoch: 2 }; return prepared(); };
  await engine.configure([approved()]);
  await assert.rejects(engine.resolve(movie), errorCode('cancelled'));
  assert.ok(transport.releases.includes(token)); await engine.dispose();
});

test('late aborted prepares release native capabilities; abort after success does not close playback', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport), abort = new AbortController();
  await engine.configure([approved()]);
  transport.preparation = async () => { abort.abort(); return prepared(); };
  await assert.rejects(engine.resolve(movie, abort.signal), errorCode('cancelled'));
  assert.ok(transport.releases.includes(token)); transport.releases = [];
  const later = new AbortController(); transport.preparation = async () => prepared();
  await engine.resolve(movie, later.signal); later.abort();
  assert.equal(transport.releases.length, 0);
  await engine.close(token); assert.equal(transport.releases.length, 1); await engine.dispose();
});

test('injected transports cannot publish off-scope redirects or arbitrary loopback sources', async () => {
  const transport = new FixtureTransport(), engine = new BdixEngine(transport);
  await engine.configure([approved()]);
  transport.listing = async () => html('', 'https://other.example/media/');
  await assert.rejects(engine.index('owned'), errorCode('scope'));
  transport.preparation = async () => ({ ...prepared(), uri: 'http://127.0.0.1:32123/admin' });
  await assert.rejects(engine.resolve(movie), errorCode('scope')); assert.ok(transport.releases.includes(token));
  await engine.dispose();
});

test('native bridge preabort, cancellation forwarding, late-capability cleanup, and absent module are honest', async () => {
  let calls = 0, cancels = 0, releases = 0;
  const abort = new AbortController();
  const native = {
    preparePlayback: async () => { calls++; abort.abort(); return prepared(); },
    cancel: () => { cancels++; }, release: async () => { releases++; },
  } as unknown as CinetorBdixNative;
  const transport = new NativeBdixTransport(native);
  await assert.rejects(transport.preparePlayback(approved(), `${root}movie.mp4`, abort.signal), errorCode('cancelled'));
  assert.equal(calls, 1); assert.equal(cancels, 1); assert.equal(releases, 1);
  await assert.rejects(transport.preparePlayback(approved(), `${root}movie.mp4`, abort.signal), errorCode('cancelled'));
  assert.equal(calls, 1);
  await assert.rejects(new NativeBdixTransport(null).configure([]), errorCode('unsupported', 'android-native-build-required'));
});
