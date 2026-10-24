import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as nativeFetch } from 'expo/fetch';
import * as ExpoNetwork from 'expo-network';
import { Platform } from 'react-native';
import { syncCatalogTitles, getTitle, TOP10_MOVIES, TOP10_TV, type PlaybackSourceRef } from '../data/mock';
import { syncChannels, getChannel } from '../data/channels';
import { syncAdultChannels } from '../data/adultChannels';
import { CineHdCatalog } from '../providers/metadata';
import { publicUrl, ProviderHttp } from '../providers/request';
import { ProviderRegistry } from '../providers/registry';
import { CineHdLiveDirectory } from '../providers/live';
import { EngineConfigurationStore } from '../providers/engineConfiguration';
import { RepositoryStore } from '../providers/repositories';
import { engineNative } from './nativeBridge';
import { probeNativeMedia } from '../providers/nativeMediaProbe';
import { Diagnostics } from './diagnostics';
import { EngineError } from './model';
import { contentKey, contentRef, sectionFor, type CatalogSection } from './contracts';
import { EngineStatusStore } from './status';
import { PlaybackEvidenceStore } from './evidence';
import { PlaybackSession } from './coordinator';
import { PlaybackControl } from './playbackControl';
import { coordinateResolution } from './resolution';
import { NativePluginResolver } from './pluginResolver';
import { bdix } from './bdixBridge';

export const diagnostics = new Diagnostics();
export const engineStatus = new EngineStatusStore();
export const catalog = new CineHdCatalog(AsyncStorage, async () => process.env.EXPO_PUBLIC_TMDB_API_KEY ?? null, nativeFetch);
const http = new ProviderHttp(nativeFetch);
export const engineConfiguration = new EngineConfigurationStore(AsyncStorage);
export const providerRegistry = new ProviderRegistry(engineConfiguration);
export const repositories = new RepositoryStore(AsyncStorage, async (url, signal, remainingMs) => {
  const result = await engineNative.invoke('inspectRepository', { url, deadlineMs: Math.min(10000, remainingMs) }, signal);
  if (!result.document) throw new EngineError('malformed');
  return result.document;
});
export const liveDirectory = new CineHdLiveDirectory(AsyncStorage, http);
export const playbackEvidence = new PlaybackEvidenceStore(AsyncStorage, `${Platform.OS}:${String(Platform.Version)}:cinetor-2.0.0:media3-1.9.1:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`);
const pluginResolver = new NativePluginResolver(providerRegistry);
const sessions = new Set<PlaybackControl>();
let initialized = false;
let initialization: Promise<void> | undefined;
let active: Promise<void> | undefined;
let controller: AbortController | undefined;
let eligible = 0;
let networkEpoch = 0;
let operationId = 0;
// Default-routing identity is not stable enough to reuse remote proof across app launches.
const networkSession = `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
function publish(): void {
  const titles = catalog.all().filter(title => sectionFor(title) !== undefined);
  syncCatalogTitles(titles);
  // Catalog popularity is not a verified top-ten rank.
  TOP10_MOVIES.splice(0); TOP10_TV.splice(0);
}
catalog.subscribe(publish);
liveDirectory.subscribe(() => syncChannels(liveDirectory.all()));
export function initializeEngine(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initialization) return initialization;
  diagnostics.update({ state: 'initializing' });
  engineStatus.set({ state: 'initializing' });
  initialization = (async () => {
    const results = await Promise.allSettled([catalog.load(), liveDirectory.load(), engineConfiguration.load(), playbackEvidence.load(), repositories.load()]);
    if (results[2].status === 'fulfilled') {
      try { await bdix.configure(engineConfiguration.getSnapshot().endpoints); } catch { diagnostics.update({ invalidConfiguration: 1 }); }
    }
    await providerRegistry.refresh().catch(() => undefined);
    publish(); syncChannels(liveDirectory.all()); syncAdultChannels([]);
    initialized = true;
    diagnostics.update({ state: 'idle', configured: Number(bdix.available()) + providerRegistry.getSnapshot().plugins.length, discovered: catalog.all().length, published: 0, unverified: catalog.all().length, verified: playbackEvidence.count });
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') engineStatus.fail(failure.reason, catalog.all().length > 0);
    else engineStatus.set({ state: catalog.all().length ? 'ready' : 'loading', updatedAt: Date.now() });
  })().finally(() => { initialization = undefined; });
  return initialization;
}
export async function refreshCatalog(section?: CatalogSection, signal?: AbortSignal): Promise<void> {
  await initializeEngine();
  if (signal?.aborted) throw new EngineError('cancelled');
  engineStatus.set({ state: 'loading', updatedAt: Date.now() });
  try {
    await catalog.refresh(signal, section);
    engineStatus.set({ state: 'ready', updatedAt: Date.now() });
    diagnostics.update({ discovered: catalog.all().length, unverified: catalog.all().length, verified: playbackEvidence.count });
  } catch (error) { if (!signal?.aborted) engineStatus.fail(error, catalog.all().length > 0); throw error; }
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
    diagnostics.update({ state: 'running', mode, startedAt: Date.now(), attempted: 1 });
    active = (async () => {
      try {
        await refreshCatalog(undefined, signal);
        eligible = Date.now() + 21600000;
        diagnostics.update({ state: 'completed', successful: 1, failed: 0, completedAt: Date.now() });
      } catch (error) {
        eligible = signal.aborted ? 0 : Date.now() + 900000;
        diagnostics.update({ state: 'failed', successful: 0, failed: 1, completedAt: Date.now(), lastError: error instanceof EngineError ? error.code : 'network' });
      }
    })().finally(() => { active = undefined; controller = undefined; });
    return active;
  },
};
export function closeAdultSession(): void { scheduler.adultAccess = false; }
export function allowAdultSession(): void { scheduler.adultAccess = false; }
export function cancelEngineSessions(): void {
  for (const session of sessions) session.stop();
  sessions.clear();
}
export function invalidateNetwork(): void { networkEpoch++; cancelEngineSessions(); pluginResolver.clear(); }
export function createPlaybackControl(): PlaybackControl {
  const session = new PlaybackControl(sources => { for (const source of sources) void bdix.release(source).catch(() => undefined); }, undefined, () => sessions.delete(session));
  sessions.add(session);
  return session;
}
export async function resolvePlayback(id: string, episodeId?: string, signal?: AbortSignal, session?: PlaybackControl, profileId = 'main'): Promise<PlaybackSourceRef[]> {
  await initializeEngine();
  if (signal?.aborted || session?.stopped) throw new EngineError('cancelled');
  const budget = session?.budget ?? new PlaybackSession();
  const operation = new AbortController();
  const abort = () => operation.abort();
  signal?.addEventListener('abort', abort, { once: true });
  budget.signal.addEventListener('abort', abort, { once: true });
  if (signal?.aborted || budget.stopped) abort();
  const held = new Map<string, PlaybackSourceRef>();
  let selected: PlaybackSourceRef[] = [];
  try {
    const title = catalog.get(id) ?? getTitle(id);
    if (title.id === 'empty' || sectionFor(title) === undefined) throw new EngineError('configuration');
    const ref = contentRef(title, episodeId);
    const key = contentKey(ref);
    const network = await ExpoNetwork.getNetworkStateAsync();
    if (operation.signal.aborted) throw new EngineError('cancelled');
    const wifiContext = await bdix.networkContext();
    const internetContext = `${network.type}:${networkSession}:${networkEpoch}:${operationId++}`;
    const hasLocal = bdix.eligible(engineConfiguration, ref, wifiContext);
    const remote = pluginResolver.shortlist(title, ref, profileId, internetContext, () => budget.remainingMs);
    const resolution = coordinateResolution({ signal: operation.signal,
      local: hasLocal ? { id: 'saved-bdix-endpoint', local: true, resolve: localSignal => bdix.resolve(ref, profileId, localSignal) } : undefined,
      remote,
      probe: async (source, probeSignal) => {
        if (source.contentKey !== key) throw new EngineError('configuration');
        held.set(source.url, source);
        const checked = source.engine === 'bdix' ? source : await probeNativeMedia(source, probeSignal, budget.remainingMs);
        return { ...checked, verificationState: playbackEvidence.recent(checked) ? 'recent-decoded-playback' : checked.verificationState };
      },
      onSources: sources => session?.update(sources),
      discard: sources => { void releasePlaybackSources(sources); },
    });
    selected = await resolution.ready;
    if (operation.signal.aborted || session?.stopped) throw new EngineError('cancelled');
    session?.update(selected);
    if (session) {
      void resolution.finished.then(() => { signal?.removeEventListener('abort', abort); budget.signal.removeEventListener('abort', abort); }).catch(() => undefined);
    } else {
      operation.abort();
      await resolution.finished;
      // A transfer caller owns the returned local capabilities until releasePlaybackSources.
      for (const source of held.values()) if (!selected.some(row => row.url === source.url)) await bdix.release(source).catch(() => undefined);
    }
    return selected;
  } catch (error) {
    operation.abort();
    signal?.removeEventListener('abort', abort);
    budget.signal.removeEventListener('abort', abort);
    for (const source of held.values()) if (!session?.candidates.some(row => row.url === source.url)) await bdix.release(source).catch(() => undefined);
    throw error;
  } finally {
    if (!session) { budget.stop(); signal?.removeEventListener('abort', abort); budget.signal.removeEventListener('abort', abort); }
  }
}
export async function releasePlaybackSources(sources: PlaybackSourceRef[]): Promise<void> {
  await Promise.all(sources.map(source => bdix.release(source).catch(() => undefined)));
}
export async function refreshPlaybackSource(source: PlaybackSourceRef, session: PlaybackControl, profileId: string): Promise<PlaybackSourceRef[]> {
  if (!session.refresh(source) || !source.contentKey) throw new EngineError('timeout');
  pluginResolver.invalidate(source);
  const match = /^(tmdb:(?:movie|tv):[1-9]\d*)(:s\d+e[1-9]\d*)?$/.exec(source.contentKey);
  if (!match) throw new EngineError('configuration');
  return resolvePlayback(match[1], match[2] ? source.contentKey : undefined, session.signal, session, profileId);
}
export async function reportDecodedPlayback(source: PlaybackSourceRef): Promise<void> {
  await playbackEvidence.record(source);
  diagnostics.update({ verified: playbackEvidence.count, published: playbackEvidence.count });
}
export function reportPlaybackFailure(source: PlaybackSourceRef): void { playbackEvidence.revoke(source); }
// Legacy live screen does not yet carry a canonical provider hash; never record false proof.
export async function reportPlayback(_id: string, _url: string, _decoded: boolean): Promise<void> {}
export function liveSources(id: string): PlaybackSourceRef[] {
  const channel = getChannel(id);
  return channel ? [channel.url, ...channel.fallbacks].map(url => ({ url, sourceId: 'iptv-directory', headers: liveDirectory.headers(url), headerOrigin: new URL(url).origin, container: /\.m3u8$/i.test(new URL(url).pathname) ? 'hls' : /\.mpd$/i.test(new URL(url).pathname) ? 'dash' : 'mp4', downloadable: false, verificationState: 'candidate' })) : [];
}
export async function prepareLiveSource(ref: PlaybackSourceRef, signal?: AbortSignal): Promise<PlaybackSourceRef> {
  if (signal?.aborted) throw new EngineError('cancelled');
  // Media3 performs DNS-bound transport checks; arbitrary directory URLs never enter expo/fetch.
  return { ...ref, url: publicUrl(ref.url), verificationState: 'candidate' };
}
export async function refreshLiveDirectory(signal?: AbortSignal): Promise<void> {
  await initializeEngine();
  await liveDirectory.refresh(signal);
}
