import { mkdir, writeFile } from 'node:fs/promises';
import { CineHdCatalog } from '../src/providers/metadata';
import { CineHdLiveDirectory } from '../src/providers/live';
import { ProviderRegistry } from '../src/providers/registry';
import { ProviderHttp } from '../src/providers/request';
import { NativeStreamResolver } from '../src/providers/streams';
import { planOfflineHls } from '../src/providers/offline';
import type { Storage } from '../src/engine/model';

class MemoryStorage implements Storage {
  rows = new Map<string, string>();
  async getItem(key: string) { return this.rows.get(key) ?? null; }
  async setItem(key: string, value: string) { this.rows.set(key, value); }
}

async function main() {
  const storage = new MemoryStorage(), http = new ProviderHttp();
  const catalog = new CineHdCatalog(storage, async () => null);
  const registry = new ProviderRegistry(http);
  const live = new CineHdLiveDirectory(storage, http);
  const streams = new NativeStreamResolver(http);
  const checks: Record<string, unknown> = {};
  const check = async (name: string, fn: () => Promise<unknown>) => {
    try { checks[name] = { status: 'pass', result: await fn() }; }
    catch (error) { checks[name] = { status: 'fail', error: error instanceof Error ? error.message : 'unknown' }; }
    console.log(JSON.stringify({ name, ...Object(checks[name]) }));
  };
  await check('metadata', async () => {
    await catalog.refresh();
    return { titles: catalog.all().length, anime: catalog.query('anime').length, kdrama: catalog.query('kdrama').length };
  });
  await check('search-details', async () => {
    const rows = await catalog.search('Oppenheimer');
    const movie = await catalog.detail('tmdb:movie:872585');
    if (!movie?.imdbId || !rows.some(row => row.id === movie.id) || !movie.posterUrl) throw new Error('Required metadata absent');
    return { results: rows.length, title: movie.name, year: movie.year, cast: movie.cast.slice(0, 3), runtime: movie.runtime };
  });
  await check('episodes', async () => {
    const series = await catalog.detail('tmdb:tv:1399');
    const episode = series?.seasons[0]?.episodes[0];
    if (!episode?.posterUrl) throw new Error('Episode artwork absent');
    return { title: series?.name, seasons: series?.seasons.length, episode: episode.name };
  });
  await check('registry', async () => { await registry.refresh(); return { providers: registry.all().length }; });
  await check('live-directory', async () => {
    await live.refresh();
    return { candidates: live.all().length, bangladesh: live.all().filter(c => c.country === 'Bangladesh').length, india: live.all().filter(c => c.country === 'India').length };
  });
  await check('native-stream', async () => {
    const movie = await catalog.detail('tmdb:movie:872585');
    if (!movie) throw new Error('Movie details absent');
    const refs = await streams.resolve(movie);
    return refs.map(ref => ({ label: ref.label, container: ref.container, verification: ref.verificationState, downloadable: ref.downloadable }));
  });
  await check('offline-hls-plan', async () => {
    const movie = await catalog.detail('tmdb:movie:872585');
    if (!movie) throw new Error('Movie details absent');
    const refs = await streams.resolve(movie);
    const source = refs.find(ref => ref.container === 'hls');
    if (!source) throw new Error('HLS video absent');
    const plan = await planOfflineHls(source.url, http, source.headers);
    if (!plan.resources.length) throw new Error('Offline media absent');
    return { playlists: plan.playlists.length, resources: plan.resources.length };
  });
  await check('offline-metadata-cache', async () => {
    const cached = new CineHdCatalog(storage, async () => null, async () => { throw new Error('Offline'); });
    await cached.load();
    if (!cached.get('tmdb:movie:872585')) throw new Error('Cache missing');
    return { titles: cached.all().length };
  });
  await mkdir('docs/cinehd-evidence', { recursive: true });
  const failed = Object.values(checks).some(value => Object(value).status === 'fail');
  await writeFile('docs/cinehd-evidence/live-verification.json', JSON.stringify({ observedAt: new Date().toISOString(), checks, devicePlayback: 'unverified', download: 'MP4 and finite HLS offline downloads implemented; device download and local playback are unverified' }, null, 2) + '\n');
  console.log(failed ? 'VERDICT: FAIL -- see live-verification.json' : 'VERDICT: PASS');
  if (failed) process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Verification failed'); process.exitCode = 1; });
