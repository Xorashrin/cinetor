import { z } from 'zod';
import type { PlaybackSourceRef } from '../data/mock';
import { EngineError } from '../engine/model';
import { contentKey, type ContentRef, type EngineId } from '../engine/contracts';
import { publicUrl } from './request';

const Source = z.object({
  url: z.string().min(1).max(8192),
  headers: z.record(z.string().max(100), z.string().max(8192)).optional(),
  headerOrigin: z.string().max(4096).optional(),
  label: z.string().max(160).optional(),
  sourceId: z.string().max(300).optional(),
  providerId: z.string().max(300).optional(),
  providerVersion: z.union([z.string().max(100), z.number().int().nonnegative()]).optional(),
  providerHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  contentKey: z.string().max(180).optional(),
  container: z.string().max(40).optional(),
  downloadable: z.boolean().optional(),
  quality: z.union([z.string().max(80), z.number().int().min(0).max(10000)]).optional(),
  fileSizeBytes: z.number().finite().positive().optional(),
  timelineId: z.string().max(200).optional(),
  subtitles: z.array(z.object({ url: z.string().max(8192), language: z.string().max(80).optional(), label: z.string().max(160).optional() })).max(30).optional(),
  subtitleTracks: z.array(z.object({ url: z.string().max(8192), language: z.string().max(80).optional(), label: z.string().max(160).optional(), mimeType: z.string().max(100).optional() })).max(30).optional(),
});
const containers: Record<string, string> = { mp4: 'mp4', hls: 'hls', m3u8: 'hls', dash: 'dash', mpd: 'dash', mkv: 'mkv', webm: 'webm' };
const forbiddenHeaders = /^(?:host|connection|content-length|transfer-encoding|proxy-authorization|proxy-connection|set-cookie)$/i;

/** Native plugins supply candidates, never proof of decoded playback. */
export function normalizePluginSources(input: unknown, engine: Exclude<EngineId, 'bdix'>, ref: ContentRef, context: {
  providerId: string; providerVersion: string; providerHash: string; networkContext: string; profileId: string;
}): PlaybackSourceRef[] {
  if (!Array.isArray(input) || input.length > 30) throw new EngineError('size');
  if (!/^[a-f0-9]{64}$/i.test(context.providerHash)) throw new EngineError('configuration');
  const key = contentKey(ref);
  const accepted = new Map<string, PlaybackSourceRef>();
  for (const row of input) {
    const parsed = Source.safeParse(row);
    if (!parsed.success) continue;
    const source = parsed.data;
    if (source.contentKey && source.contentKey !== key) continue;
    if (source.providerHash && source.providerHash.toLowerCase() !== context.providerHash.toLowerCase()) continue;
    let url: string;
    try { url = publicUrl(source.url); } catch { continue; }
    const container = containers[(source.container ?? '').toLowerCase()] ??
      (/\.m3u8$/i.test(new URL(url).pathname) ? 'hls' : /\.mpd$/i.test(new URL(url).pathname) ? 'dash' : /\.mp4$/i.test(new URL(url).pathname) ? 'mp4' : /\.mkv$/i.test(new URL(url).pathname) ? 'mkv' : /\.webm$/i.test(new URL(url).pathname) ? 'webm' : undefined);
    if (!container) continue;
    const headers: Record<string, string> = {};
    let invalid = false;
    for (const [name, value] of Object.entries(source.headers ?? {})) {
      if (Object.keys(headers).length >= 32 || forbiddenHeaders.test(name) || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || /[\r\n\0]/.test(value)) { invalid = true; break; }
      headers[name] = value;
    }
    if (invalid) continue;
    let headerOrigin: string;
    try {
      headerOrigin = source.headerOrigin ? new URL(publicUrl(source.headerOrigin)).origin : new URL(url).origin;
    } catch { continue; }
    // Cross-origin media does not inherit plugin-origin credentials.
    const confinedHeaders = headerOrigin === new URL(url).origin ? headers : {};
    const subtitles = source.subtitleTracks ?? source.subtitles ?? [];
    const subtitleTracks = subtitles.flatMap(track => {
      try { return [{ ...track, url: publicUrl(track.url) }]; } catch { return []; }
    });
    const sourceId = `${context.providerId}:${source.sourceId ?? accepted.size}`;
    accepted.set(url, {
      url, headers: confinedHeaders, headerOrigin, credentialOrigin: headerOrigin,
      engine, sourceId, providerId: context.providerId, providerVersion: context.providerVersion,
      providerHash: context.providerHash.toLowerCase(), networkContext: context.networkContext,
      accessContext: `profile:${context.profileId}`, contentKey: key, locality: 'internet',
      label: source.label ?? context.providerId, container,
      quality: typeof source.quality === 'number' ? source.quality > 0 ? `${source.quality}p` : undefined : source.quality,
      downloadable: source.downloadable === true && ['mp4', 'hls', 'dash'].includes(container),
      fileSizeBytes: source.fileSizeBytes, timelineId: source.timelineId,
      subtitleTracks, verificationState: 'candidate',
    });
  }
  return [...accepted.values()];
}

export interface ExactCloudstreamMapping {
  contentKey: string; pluginId: string; providerId: string; pluginHash: string;
  providerUrl: string; data: string; checkedAt: number;
  evidence: 'provider-sync-data';
}

/** A provider's verified external ID is required; search-name similarity is not a crosswalk. */
export function cloudstreamMapping(item: unknown, ref: ContentRef, plugin: { id: string; providerId: string; hash: string }, now = Date.now()): ExactCloudstreamMapping | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  const row = item as Record<string, unknown>;
  if (row.mappingEvidence !== 'provider-sync-data' || row.mediaType !== ref.mediaType || String(row.tmdbId) !== String(ref.externalId)) return undefined;
  if (!/^[a-f0-9]{64}$/i.test(plugin.hash) || typeof row.url !== 'string') return undefined;
  let providerUrl: string;
  try { providerUrl = publicUrl(row.url); } catch { return undefined; }
  let data = row.data;
  if (ref.mediaType === 'tv') {
    const rows = Array.isArray(row.episodes) ? row.episodes.slice(0, 1000) : [];
    const exact = rows.filter(episode => episode && typeof episode === 'object' && !Array.isArray(episode) &&
      (episode as Record<string, unknown>).season === ref.season && (episode as Record<string, unknown>).episode === ref.episode);
    if (exact.length !== 1) return undefined;
    data = (exact[0] as Record<string, unknown>).data;
  }
  if (typeof data !== 'string' || !data || data.length > 262144) return undefined;
  return { contentKey: contentKey(ref), pluginId: plugin.id, providerId: plugin.providerId, pluginHash: plugin.hash.toLowerCase(), providerUrl, data, checkedAt: now, evidence: 'provider-sync-data' };
}
