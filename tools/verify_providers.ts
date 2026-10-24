import { mkdir, writeFile } from 'node:fs/promises';
import { CineHdCatalog } from '../src/providers/metadata';
import { CineHdLiveDirectory } from '../src/providers/live';
import { ProviderHttp } from '../src/providers/request';
import type { Storage } from '../src/engine/model';

class MemoryStorage implements Storage {
  rows = new Map<string, string>();
  async getItem(key: string) { return this.rows.get(key) ?? null; }
  async setItem(key: string, value: string) { this.rows.set(key, value); }
}

/** Optional CI-only connectivity check. It never executes third-party plugin code. */
async function main() {
  if (!process.env.CI) throw new Error('Run connectivity verification in cloud CI, not on the development PC.');
  const storage = new MemoryStorage();
  const catalog = new CineHdCatalog(storage, async () => process.env.EXPO_PUBLIC_TMDB_API_KEY ?? null);
  const live = new CineHdLiveDirectory(storage, new ProviderHttp());
  const checks: Record<string, { status: 'pass' | 'fail'; result?: unknown; error?: string }> = {};
  const check = async (name: string, work: () => Promise<unknown>) => {
    try { checks[name] = { status: 'pass', result: await work() }; }
    catch { checks[name] = { status: 'fail', error: 'Network or metadata contract failed; inspect the CI job without logging provider credentials.' }; }
  };
  await check('metadata', async () => {
    await catalog.refresh();
    return { titles: catalog.all().length, home: catalog.query('home').length, anime: catalog.query('anime').length, kdrama: catalog.query('kdrama').length, others: catalog.query('others').length };
  });
  await check('fixture-metadata', async () => {
    const title = await catalog.detail('tmdb:movie:810');
    if (!title || title.mediaType !== 'movie' || title.tmdbId !== 810) throw new Error('Exact metadata missing.');
    return { id: title.id, title: title.name, metadataOnly: true };
  });
  await check('live-directory', async () => { await live.refresh(); return { candidates: live.all().length, playbackVerified: false }; });
  await check('offline-metadata-cache', async () => {
    const cached = new CineHdCatalog(storage, async () => null, async () => { throw new Error('Offline'); });
    await cached.load();
    if (!cached.all().length) throw new Error('Metadata cache missing.');
    return { titles: cached.all().length };
  });
  await mkdir('builds/verification', { recursive: true });
  await writeFile('builds/verification/connectivity.json', JSON.stringify({ observedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA ?? null, checks, nativeEngines: 'NOT TESTED by this Node connectivity check; use Android instrumentation', devicePlayback: 'NOT TESTED', offlinePlayback: 'NOT TESTED' }, null, 2) + '\n');
  if (Object.values(checks).some(row => row.status === 'fail')) process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Verification failed'); process.exitCode = 1; });
