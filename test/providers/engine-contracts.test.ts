import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_TITLE, nextEpisode, type Episode, type PlaybackSourceRef, type Title } from '../../src/data/mock';
import { contentKey, contentRef, sameContent, sectionFor } from '../../src/engine/contracts';
import { PlaybackSession, WorkPool } from '../../src/engine/coordinator';
import { PlaybackControl } from '../../src/engine/playbackControl';
import { coordinateResolution } from '../../src/engine/resolution';
import { PlaybackEvidenceStore } from '../../src/engine/evidence';
import { EngineConfigurationStore, parseEngineConfiguration } from '../../src/providers/engineConfiguration';
import { cloudstreamMapping, normalizePluginSources } from '../../src/providers/pluginContracts';
import { exportProfiles, freshSnapshot, importProfiles, loadProfiles, parseSnapshot, PROFILE_STORAGE_KEY, LEGACY_STORAGE_KEY } from '../../src/state/profileStore';

const hash = 'a'.repeat(64);
const source = (index: number, patch: Partial<PlaybackSourceRef> = {}): PlaybackSourceRef => ({ url: `https://media.example/${index}.mp4`, sourceId: `candidate:${index}`, engine: 'nuvio', providerId: 'fixture', providerVersion: '1', providerHash: hash, representationId: index.toString(16).padStart(64, '0'), networkContext: 'wifi:launch:1:1', accessContext: 'profile:main', contentKey: 'tmdb:movie:810', ...patch });
const storage = () => {
  const rows = new Map<string, string>();
  return { rows, async getItem(key: string) { return rows.get(key) ?? null; }, async setItem(key: string, value: string) { rows.set(key, value); } };
};
test('canonical references distinguish movie, series and exact Specials episodes', () => {
  const movie = contentRef({ ...DEFAULT_TITLE, id: 'tmdb:movie:810', kind: 'movie' });
  const episode = contentRef({ ...DEFAULT_TITLE, id: 'tmdb:tv:810' }, 'tmdb:tv:810:s0e1');
  assert.equal(contentKey(movie), 'tmdb:movie:810');
  assert.equal(contentKey(episode), 'tmdb:tv:810:s0e1');
  assert.equal(sameContent(movie, episode), false);
  for (const wrong of [undefined, 'tmdb:tv:811:s0e1', 'tmdb:tv:810:s1e0']) assert.throws(() => contentRef({ ...DEFAULT_TITLE, id: 'tmdb:tv:810' }, wrong));
  assert.throws(() => contentKey({ namespace: 'tmdb', mediaType: 'tv', externalId: 810 }));
  assert.equal(sectionFor({ ...DEFAULT_TITLE, id: 'x', genres: ['Animation', 'Anime'], originalLanguage: 'ja' }), 'anime');
  assert.equal(sectionFor({ ...DEFAULT_TITLE, id: 'x', genres: ['K-Drama'], originalLanguage: 'ko' }), 'kdrama');
  assert.equal(sectionFor({ ...DEFAULT_TITLE, id: 'x', genres: ['Documentary'] }), 'others');
  assert.equal(sectionFor({ ...DEFAULT_TITLE, id: 'x', genres: [' ADULT (18+) '] }), undefined);
});
test('shared pool has bounded FIFO waiting, cancellation, and idempotent release', async () => {
  const pool = new WorkPool(1, 1);
  const first = await pool.acquire();
  const abort = new AbortController();
  const queued = pool.acquire(abort.signal);
  await assert.rejects(pool.acquire(), { code: 'rate-limit' });
  abort.abort(); await assert.rejects(queued, { code: 'cancelled' });
  first(); first();
  assert.equal(pool.running, 0); assert.equal(pool.waiting, 0);
  await assert.rejects(pool.run(async () => { throw new Error('fixture'); }));
  assert.equal(pool.running, 0);
});
test('rendered frames do not reset the original recovery deadline or switch allowance', () => {
  let now = 1000;
  const budget = new PlaybackSession(() => now);
  try {
    assert.equal(budget.canSwitch(), true); assert.equal(budget.canSwitch(), true); assert.equal(budget.canSwitch(), true); assert.equal(budget.canSwitch(), false);
    assert.equal(budget.canRefresh('candidate'), true); assert.equal(budget.canRefresh('candidate'), false);
    budget.complete(); now = 46001;
    assert.equal(budget.stopped, false); assert.equal(budget.canRefresh('other'), false);
    budget.stop(); assert.equal(budget.stopped, true);
  } finally { budget.stop(); }
});
test('source swaps require matching timeline and first-frame evidence is attempt-specific', () => {
  const released: PlaybackSourceRef[] = [];
  let stopped = 0;
  const control = new PlaybackControl(rows => released.push(...rows), undefined, () => stopped++);
  const one = source(1, { timelineId: 'cut-a' }), two = source(2, { timelineId: 'cut-a' }), three = source(3);
  try {
    control.update([one, two, three]);
    assert.equal(control.select(one)?.preservePosition, false);
    assert.equal(control.renderedFrame(one), true); assert.equal(control.renderedFrame(one), false);
    assert.equal(control.select(two)?.preservePosition, true); assert.equal(control.renderedFrame(two), true);
    assert.equal(control.select(three)?.preservePosition, false);
    assert.equal(control.refresh(three), true); assert.equal(control.refresh({ ...three, url: 'https://media.example/new.mp4' }), false);
    control.stop(); control.update([source(4)]);
    assert.equal(stopped, 1); assert.equal(released.length, 4); assert.equal(control.select(one), undefined);
  } finally { control.stop(); }
});
test('same URL with a new representation is not the failed playback candidate', () => {
  const control = new PlaybackControl(() => undefined);
  const one = source(1), changed = source(1, { representationId: 'c'.repeat(64) });
  try {
    control.update([one]); assert.ok(control.select(one)); control.fail(one);
    assert.equal(control.candidates.length, 0); assert.equal(control.select(one), undefined);
    control.update([changed]); assert.ok(control.select(changed));
    assert.equal(control.renderedFrame(one), false); assert.equal(control.renderedFrame(changed), true);
    assert.equal(control.candidates.length, 1);
  } finally { control.stop(); }
});
test('resolution is progressive and shares bounded resolver/probe work', async () => {
  const abort = new AbortController();
  const run = coordinateResolution({ signal: abort.signal, remote: [{ id: 'one', local: false, resolve: async () => [source(1)] }, { id: 'two', local: false, resolve: async () => [source(2)] }], probe: async row => row });
  const ready = await run.ready;
  assert.ok(ready.length >= 1);
  await run.finished;
  assert.equal(run.candidates().length, 2);
  abort.abort();
});
test('pre-aborted resolution does not start any engine', async () => {
  const abort = new AbortController(); abort.abort(); let called = false;
  const run = coordinateResolution({ signal: abort.signal, remote: [{ id: 'one', local: false, resolve: async () => { called = true; return []; } }], probe: async row => row });
  await assert.rejects(run.ready, { code: 'cancelled' }); await run.finished;
  assert.equal(called, false);
});
test('engine configuration serializes mutations and rejects ambiguous coordinates or missing consent', async () => {
  const saved = storage(); const store = new EngineConfigurationStore(saved); await store.load();
  await Promise.all([store.setPlugin('one', true), store.setPlugin('two', true)]);
  assert.deepEqual(store.getSnapshot().enabledPluginIds, ['one', 'two']);
  const endpoint = { id: 'server', name: 'Approved fixture', url: 'https://media.example/', enabled: true, network: 'wifi', allowPlainFtp: false, mappings: [{ contentKey: 'tmdb:tv:2:s0e1', path: 'special.mp4' }] };
  const serialize = (row: object) => JSON.stringify({ schemaVersion: 1, enabledPluginIds: [], endpoints: [row] });
  assert.equal(parseEngineConfiguration(serialize(endpoint)).endpoints.length, 1);
  assert.throws(() => parseEngineConfiguration(serialize({ ...endpoint, mappings: [{ contentKey: 'tmdb:tv:2', path: 'wrong.mp4' }] })));
  assert.throws(() => parseEngineConfiguration(serialize({ ...endpoint, url: 'ftp://media.example/' })));
  assert.throws(() => parseEngineConfiguration(serialize({ ...endpoint, url: 'http://media.example/' })));
});
test('native source normalization rejects private URLs, hash mismatch, and cross-origin credentials', () => {
  const ref = { namespace: 'tmdb' as const, mediaType: 'movie' as const, externalId: 810 };
  const context = { providerId: 'fixture', providerVersion: '1', providerHash: hash, networkContext: 'wifi', profileId: 'main' };
  const rows = normalizePluginSources([{ url: 'https://127.0.0.1/x.mp4' }, { url: 'https://media.example/x.mp4', providerHash: 'b'.repeat(64) }, { url: 'https://media.example/good.mp4', headers: { Authorization: 'fixture' }, headerOrigin: 'https://other.example', verificationState: 'decoded' }], 'nuvio', ref, context);
  assert.equal(rows.length, 1); assert.deepEqual(rows[0].headers, {}); assert.equal(rows[0].verificationState, 'candidate');
});
test('WebM plugin sources remain online-only without coercing their container', () => {
  const ref = { namespace: 'tmdb' as const, mediaType: 'movie' as const, externalId: 810 };
  const context = { providerId: 'fixture', providerVersion: '1', providerHash: hash, networkContext: 'wifi', profileId: 'main' };
  const rows = normalizePluginSources([{ url: 'https://media.example/movie.webm', downloadable: true }, { url: 'https://media.example/stream', container: 'webm', downloadable: true }], 'nuvio', ref, context);
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.container, 'webm'); assert.equal(row.downloadable, false); }
});
test('Cloudstream mappings use external ID evidence and preserve exact opaque episode data', () => {
  const plugin = { id: 'plugin', providerId: 'provider', hash };
  const ref = { namespace: 'tmdb' as const, mediaType: 'tv' as const, externalId: 810, season: 0, episode: 1 };
  const item = { name: 'Same name is insufficient', url: 'https://provider.example/title', tmdbId: '810', mediaType: 'tv', mappingEvidence: 'provider-sync-data', episodes: [{ season: 0, episode: 1, data: '{"opaque":"unchanged"}' }] };
  assert.equal(cloudstreamMapping(item, ref, plugin)?.data, '{"opaque":"unchanged"}');
  assert.equal(cloudstreamMapping({ ...item, tmdbId: '811' }, ref, plugin), undefined);
  assert.equal(cloudstreamMapping({ ...item, episodes: [...item.episodes, ...item.episodes] }, ref, plugin), undefined);
  assert.equal(cloudstreamMapping({ ...item, mappingEvidence: null }, ref, plugin), undefined);
});
test('profile imports strip native capabilities and preserve per-profile settings', async () => {
  const original = freshSnapshot();
  original.profiles[0].settings = { ...original.settings, autoplayNext: false };
  original.profiles[0].data.progress.push({ titleId: 'tmdb:movie:810', position: 5, duration: 10, updatedAt: 1000, timelineId: 'offline:cinetor-offline://download/private-capability' });
  original.profiles[0].data.downloads.push({ titleId: 'tmdb:movie:810', status: 'downloaded', progress: 1, sizeMB: 1, localUri: 'file:///private/example.mp4', nativeId: 'fixture-id' });
  const exported = exportProfiles(original);
  assert.equal(exported.includes('file:///'), false); assert.equal(exported.includes('fixture-id'), false); assert.equal(exported.includes('private-capability'), false);
  const imported = importProfiles(exported);
  assert.equal(imported.profiles[0].data.downloads[0].status, 'failed'); assert.equal(imported.profiles[0].settings?.autoplayNext, false);
  assert.throws(() => parseSnapshot('{broken'));
  const saved = storage(); saved.rows.set(PROFILE_STORAGE_KEY, '{broken'); saved.rows.set(LEGACY_STORAGE_KEY, '{}');
  await assert.rejects(loadProfiles(saved)); assert.equal(saved.rows.get(PROFILE_STORAGE_KEY), '{broken');
});
test('legacy profile migration produces a valid deduplicated current snapshot', async () => {
  const saved = storage();
  const progress = { titleId: 'tmdb:movie:810', position: 5, duration: 10, updatedAt: 1000 };
  const download = { titleId: 'tmdb:movie:810', status: 'downloading', progress: 0.5, sizeMB: 1 };
  saved.rows.set(LEGACY_STORAGE_KEY, JSON.stringify({ data: { myList: ['tmdb:movie:810', 'tmdb:movie:810'], reminders: ['tmdb:movie:810', 'tmdb:movie:810'], progress: [progress, progress, { ...progress, titleId: 'tmdb:tv:810' }], downloads: [download, download] } }));
  const migrated = await loadProfiles(saved);
  const data = migrated.profiles[0].data;
  assert.deepEqual(data.myList, ['tmdb:movie:810']); assert.deepEqual(data.reminders, ['tmdb:movie:810']);
  assert.equal(data.progress.length, 1); assert.equal(data.downloads.length, 1); assert.equal(data.downloads[0].status, 'paused');
  assert.deepEqual(parseSnapshot(JSON.stringify(migrated)), migrated);
});
test('playback evidence is exact-context, expires, and never persists source URLs', async () => {
  const saved = storage(); let now = 1000;
  const evidence = new PlaybackEvidenceStore(saved, 'device:fixture', () => now);
  await evidence.record(source(1));
  assert.ok(evidence.recent(source(1)));
  assert.equal(evidence.recent(source(2)), undefined);
  assert.equal(evidence.recent(source(1, { representationId: 'f'.repeat(64) })), undefined);
  assert.equal(evidence.recent(source(1, { networkContext: 'wifi:launch:2:1' })), undefined);
  assert.equal(evidence.recent(source(1, { networkContext: 'wifi:other-launch:1:1' })), undefined);
  assert.equal([...saved.rows.values()].some(row => row.includes('https://')), false);
  now += 86400001; assert.equal(evidence.recent(source(1)), undefined);
});
test('evidence rejects missing identity and never restores v1 provider-only proof', async () => {
  const saved = storage();
  saved.rows.set('cinetor:playback-evidence:v1', JSON.stringify([{ ...source(1), event: 'rendered-first-frame', at: 1000, expiresAt: 5000 }]));
  const evidence = new PlaybackEvidenceStore(saved, 'device:fixture', () => 1000);
  await evidence.load();
  assert.equal(evidence.count, 0);
  for (const representationId of [undefined, '', 'not-a-digest', 'a'.repeat(63)]) await assert.rejects(evidence.record(source(1, { representationId })), { code: 'configuration' });
  await assert.rejects(evidence.record(source(1, { contentKey: 'tmdb:tv:810' })), { code: 'configuration' });
  const local = source(1, { engine: 'bdix', representationId: 'bdix-spool:91e24f5c-9caa-4c5f-8be6-0b16c819848e', nativeToken: 'never-persist-this-capability' });
  await evidence.record(local);
  assert.ok(evidence.recent(local));
  const raw = saved.rows.get('cinetor:playback-evidence:v2')!;
  assert.equal(raw.includes('nativeToken'), false);
  assert.equal(raw.includes('never-persist-this-capability'), false);
  const otherDevice = new PlaybackEvidenceStore(saved, 'device:other', () => 1000);
  await otherDevice.load();
  assert.equal(otherDevice.count, 0); assert.equal(otherDevice.recent(local), undefined);
});
test('autoplay advances only to one exact adjacent episode in the same ordinary season', () => {
  const episode = (season: number, number: number): Episode => ({ id: `tmdb:tv:810:s${season}e${number}`, number, name: `Episode ${number}`, runtime: 0, synopsis: '', seed: '', video: '' });
  const title: Title = { ...DEFAULT_TITLE, id: 'tmdb:tv:810', seasons: [{ number: 0, episodes: [episode(0, 1), episode(0, 2)] }, { number: 1, episodes: [episode(1, 1), episode(1, 2), episode(1, 4)] }, { number: 2, episodes: [episode(2, 1)] }] };
  assert.equal(nextEpisode(title, 'tmdb:tv:810:s1e1')?.id, 'tmdb:tv:810:s1e2');
  for (const id of ['tmdb:tv:810:s0e1', 'tmdb:tv:810:s1e2', 'tmdb:tv:810:s1e4', 'tmdb:tv:811:s1e1']) assert.equal(nextEpisode(title, id), null);
  title.seasons[1].episodes.push(episode(1, 2));
  assert.equal(nextEpisode(title, 'tmdb:tv:810:s1e1'), null);
});
