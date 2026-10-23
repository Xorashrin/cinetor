import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as nativeFetch } from 'expo/fetch';
import { syncCatalogTitles, getTitle, TOP10_MOVIES, TOP10_TV, type Title, type PlaybackSourceRef } from '../data/mock';
import { syncChannels, getChannel } from '../data/channels';
import { syncAdultChannels } from '../data/adultChannels';
import { CineHdCatalog } from '../providers/metadata';
import { ProviderHttp } from '../providers/request';
import { NativeStreamResolver } from '../providers/streams';
import { ProviderRegistry } from '../providers/registry';
import { CineHdLiveDirectory } from '../providers/live';
import { Diagnostics } from './diagnostics';
import { EngineError } from './model';

export const diagnostics = new Diagnostics();
// The user will supply their TMDB credential later; no credential is recovered from another app.
export const catalog = new CineHdCatalog(AsyncStorage, async () => process.env.EXPO_PUBLIC_TMDB_API_KEY ?? null, nativeFetch);
const http = new ProviderHttp(nativeFetch);
export const providerRegistry = new ProviderRegistry(http);
export const resolver = new NativeStreamResolver(http);
export const liveDirectory = new CineHdLiveDirectory(AsyncStorage, http);
let initialized = false;
let initialization: Promise<void> | undefined;
let active: Promise<void> | undefined;
let controller: AbortController | undefined;
let eligible = 0;
function publish(): void {
  const titles = catalog.all();
  syncCatalogTitles(titles);
  TOP10_MOVIES.splice(0, TOP10_MOVIES.length, ...titles.filter(t => t.kind === 'movie' && !t.genres.includes('Anime') && !t.genres.includes('K-Drama')).slice(0, 10));
  TOP10_TV.splice(0, TOP10_TV.length, ...titles.filter(t => t.kind === 'series' && !t.genres.includes('Anime') && !t.genres.includes('K-Drama')).slice(0, 10));
}
catalog.subscribe(publish);
export function initializeEngine(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initialization) return initialization;
  diagnostics.update({ state: 'initializing' });
  initialization = (async () => {
    await Promise.allSettled([catalog.load(), liveDirectory.load()]);
    publish(); syncChannels(liveDirectory.all()); syncAdultChannels([]);
    initialized = true;
    diagnostics.update({ state: 'idle', configured: 3 });
  })().finally(() => { initialization = undefined; });
  return initialization;
}
export const scheduler = {
  adultAccess: false,
  nextEligible: () => eligible,
  cancel: () => controller?.abort(),
  run(mode: 'foreground' | 'background'): Promise<void> {
    if (active) return active;
    if (Date.now() < eligible) return Promise.resolve();
    controller = new AbortController();
    const signal = controller.signal;
    diagnostics.update({ state: 'running', mode, startedAt: Date.now(), attempted: 3 });
    active = (async () => {
      await initializeEngine();
      const results = await Promise.allSettled([
        catalog.refresh(signal),
        providerRegistry.refresh(signal),
        liveDirectory.refresh(signal).then(() => { syncChannels(liveDirectory.all()); publish(); }),
      ]);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failures = results.filter(r => r.status === 'rejected');
      const failure = failures[0];
      const code = failure?.reason instanceof EngineError ? failure.reason.code : 'network';
      eligible = signal.aborted ? 0 : Date.now() + (successful === 3 ? 21600000 : 900000);
      diagnostics.update({ state: successful ? 'completed' : 'failed', successful, failed: failures.length,
        discovered: catalog.all().length, published: catalog.all().length, completedAt: Date.now(),
        ...(failures.length ? { lastError: code } : {}) });
    })().finally(() => { active = undefined; controller = undefined; });
    return active;
  },
};
export function closeAdultSession(): void { scheduler.adultAccess = false; }
export function allowAdultSession(): void { scheduler.adultAccess = true; }
export async function reportPlayback(_id: string, url: string, decoded: boolean): Promise<void> { resolver.report(url, decoded); }
export async function resolvePlayback(id: string, episodeId?: string, signal?: AbortSignal): Promise<PlaybackSourceRef[]> {
  const detail = await catalog.detail(id, signal);
  const title: Title = detail ?? getTitle(id);
  let season: number | undefined, episode: number | undefined;
  if (title.kind === 'series') {
    const match = episodeId?.match(/:s(\d+)e(\d+)$/);
    if (match) { season = Number(match[1]); episode = Number(match[2]); }
    else { season = title.seasons[0]?.number; episode = title.seasons[0]?.episodes[0]?.number; }
  }
  return resolver.resolve(title, season, episode, signal);
}
export async function playbackSource(url: string, _sourceId?: string): Promise<{uri: string; headers?: Record<string, string>}> {
  return { uri: url, headers: resolver.headers(url) };
}
export function liveSources(id: string): PlaybackSourceRef[] {
  const channel = getChannel(id);
  return channel ? [channel.url, ...channel.fallbacks].map(url => ({ url, sourceId: 'cinehd-iptv', headers: liveDirectory.headers(url) })) : [];
}
export async function verifiedLiveSource(ref: PlaybackSourceRef, signal?: AbortSignal): Promise<{uri: string; headers?: Record<string, string>}> {
  const result = await resolver.probe(ref.url, { origin: new URL(ref.url).origin, referer: ref.url, ...ref.headers }, 'Live TV', signal);
  return { uri: result.url, headers: result.headers };
}
