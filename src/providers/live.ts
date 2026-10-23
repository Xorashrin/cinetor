import { z } from 'zod';
import type { Channel } from '../data/channels';
import { EngineError, type Storage } from '../engine/model';
import { ProviderHttp, publicUrl } from './request';

export const CINEHD_LIVE_KEY = 'cinetor:cinehd:live:v1';
const API = 'https://iptv-org.github.io/api';
const MAX_CHANNELS = 1000;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const CATEGORY_ORDER = ['Sports', 'News', 'Kids', 'Movies', 'Entertainment', 'Series', 'Music', 'Documentary', 'Education', 'General'];
const BLOCKED_CATEGORY = /^(?:adult|xxx|porn|pornography|nsfw)$/i;
const CachedChannel = z.object({
  id: z.string().regex(/^iptv:[a-zA-Z0-9._-]{1,100}$/),
  name: z.string().min(1).max(300), logo: z.string().max(4096),
  url: z.string().min(1).max(4096), fallbacks: z.array(z.string().max(4096)).max(7),
  country: z.string().min(1).max(100), category: z.string().min(1).max(100),
  quality: z.enum(['HD', 'SD', 'Live']),
});
const Snapshot = z.object({
  schemaVersion: z.literal(1),
  channels: z.array(CachedChannel).max(MAX_CHANNELS),
  headers: z.array(z.object({
    url: z.string().max(4096),
    values: z.object({ 'User-Agent': z.string().max(512).optional(), referer: z.string().max(4096).optional() }),
  })).max(MAX_CHANNELS * 8),
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}
function text(value: unknown, max = 300): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined;
}
function https(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { return publicUrl(value); } catch { return undefined; }
}
function streamUrl(value: unknown): string | undefined {
  const url = https(value);
  return url && /\.(?:m3u8|mp4)$/i.test(new URL(url).pathname) ? url : undefined;
}
function requestHeaders(value: unknown): Record<string, string> {
  const row = object(value);
  if (!row) return {};
  const headers: Record<string, string> = {};
  const agent = text(row['User-Agent'] ?? row.user_agent, 512);
  const referer = https(row.referer ?? row.referrer);
  if (agent && !/[\r\n]/.test(agent)) headers['User-Agent'] = agent;
  if (referer) headers.referer = referer;
  return headers;
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 60000) throw new EngineError('malformed');
  return value;
}
function ranking(channel: Channel): number {
  return channel.country === 'Bangladesh' ? 0 : channel.country === 'India' ? 1 : 2;
}
function sortChannels(channels: Channel[]): Channel[] {
  return channels.sort((a, b) => ranking(a) - ranking(b) ||
    a.country.localeCompare(b.country) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Directory rows are candidates; the native resolver verifies a stream before playback. */
export class CineHdLiveDirectory {
  version = 0;
  private channels: Channel[] = [];
  private streamHeaders = new Map<string, Record<string, string>>();
  private listeners = new Set<() => void>();
  private pending?: Promise<void>;

  constructor(private storage: Storage, private http: ProviderHttp) {}

  all(): Channel[] {
    return this.channels.map(channel => ({ ...channel, fallbacks: [...channel.fallbacks] }));
  }
  headers(url: string): Record<string, string> | undefined {
    const value = this.streamHeaders.get(url);
    return value ? { ...value } : undefined;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private publish(channels: Channel[], headers: Map<string, Record<string, string>>): void {
    this.channels = channels;
    this.streamHeaders = headers;
    this.version++;
    for (const listener of this.listeners) { try { listener(); } catch {} }
  }

  async load(): Promise<void> {
    let raw: string | null;
    try { raw = await this.storage.getItem(CINEHD_LIVE_KEY); }
    catch { throw new EngineError('storage'); }
    if (!raw || raw.length > MAX_SNAPSHOT_BYTES) return;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return; }
    const snapshot = Snapshot.safeParse(value);
    if (!snapshot.success) return;
    const channels = new Map<string, Channel>();
    for (const row of snapshot.data.channels) {
      const url = streamUrl(row.url);
      if (!url || BLOCKED_CATEGORY.test(row.category)) continue;
      const fallbacks = [...new Set(row.fallbacks.flatMap(value => {
        const parsed = streamUrl(value);
        return parsed && parsed !== url ? [parsed] : [];
      }))];
      channels.set(row.id, { ...row, url, fallbacks, logo: https(row.logo) ?? '' });
    }
    if (!channels.size || this.channels.length) return;
    const urls = new Set([...channels.values()].flatMap(channel => [channel.url, ...channel.fallbacks]));
    const headers = new Map<string, Record<string, string>>();
    for (const row of snapshot.data.headers) {
      const url = streamUrl(row.url);
      if (url && urls.has(url)) headers.set(url, requestHeaders(row.values));
    }
    this.publish(sortChannels([...channels.values()]), headers);
  }

  async refresh(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new EngineError('cancelled');
    if (this.pending) return this.pending;
    const operation = this.fetchDirectory(signal);
    this.pending = operation;
    try { await operation; }
    finally { if (this.pending === operation) this.pending = undefined; }
  }

  private async fetchDirectory(signal?: AbortSignal): Promise<void> {
    const sizes: Record<string, number> = { channels: 12 * 1024 * 1024, streams: 8 * 1024 * 1024, logos: 10 * 1024 * 1024, countries: 131072, categories: 65536 };
    const fetchRows = async (name: string): Promise<unknown[]> => rows(await this.http.json(`${API}/${name}.json`, { signal, maxBytes: sizes[name] }));
    const [channelRows, streamRows, logoRows, countryRows, categoryRows] = await Promise.all([
      fetchRows('channels'), fetchRows('streams'), fetchRows('logos'), fetchRows('countries'), fetchRows('categories'),
    ]);
    if (signal?.aborted) throw new EngineError('cancelled');
    const countries = new Map<string, string>();
    for (const value of countryRows) {
      const row = object(value), code = text(row?.code, 2), name = text(row?.name, 100);
      if (code && /^[A-Z]{2}$/.test(code) && name) countries.set(code, name);
    }
    const categories = new Map<string, string>();
    for (const value of categoryRows) {
      const row = object(value), id = text(row?.id, 100), name = text(row?.name, 100);
      if (id && name) categories.set(id, name);
    }
    const channelInfo = new Map<string, { name: string; country: string; category: string }>();
    for (const value of channelRows) {
      const row = object(value), id = text(row?.id, 100), name = text(row?.name);
      const code = text(row?.country, 2);
      if (!row || !id || !/^[a-zA-Z0-9._-]+$/.test(id) || !name || !code || !countries.has(code) ||
          row.is_nsfw !== false || row.closed || row.replaced_by || !Array.isArray(row.categories)) continue;
      const labels = row.categories.flatMap(value => {
        const id = text(value, 100);
        return id ? [categories.get(id) ?? id] : [];
      });
      if (labels.some(label => BLOCKED_CATEGORY.test(label)) || row.categories.some(value => typeof value === 'string' && BLOCKED_CATEGORY.test(value))) continue;
      const category = CATEGORY_ORDER.find(label => labels.includes(label)) ?? labels[0] ?? 'General';
      channelInfo.set(id, { name, country: countries.get(code) ?? code, category });
    }
    if (!channelInfo.size) throw new EngineError('malformed');
    const logos = new Map<string, { url: string; score: number }>();
    for (const value of logoRows) {
      const row = object(value), channel = text(row?.channel, 100), url = https(row?.url);
      if (!row || !channel || !channelInfo.has(channel) || !url) continue;
      const score = (row.in_use === true ? 2 : 0) + (row.feed === null ? 1 : 0);
      if ((logos.get(channel)?.score ?? -1) < score) logos.set(channel, { url, score });
    }
    const streams = new Map<string, { url: string; height: number; headers: Record<string, string> }[]>();
    for (const value of streamRows) {
      const row = object(value), channel = text(row?.channel, 100), url = streamUrl(row?.url);
      if (!row || !channel || !channelInfo.has(channel) || !url) continue;
      const matches = text(row.quality, 20)?.match(/^(\d{3,4})p$/i);
      const height = matches ? Math.min(Number(matches[1]), 4320) : 0;
      const list = streams.get(channel) ?? [];
      const existing = list.find(item => item.url === url);
      if (existing) { if (height > existing.height) existing.height = height; }
      else if (list.length < 20) list.push({ url, height, headers: requestHeaders(row) });
      streams.set(channel, list);
    }
    const channels: Channel[] = [];
    const headers = new Map<string, Record<string, string>>();
    for (const [id, list] of streams) {
      const info = channelInfo.get(id);
      if (!info || !list.length) continue;
      list.sort((a, b) => b.height - a.height || a.url.localeCompare(b.url));
      const selected = list.slice(0, 8), first = selected[0];
      channels.push({ id: `iptv:${id}`, ...info, logo: logos.get(id)?.url ?? '', url: first.url,
        fallbacks: selected.slice(1).map(item => item.url), quality: first.height >= 720 ? 'HD' : first.height ? 'SD' : 'Live' });
      for (const item of selected) headers.set(item.url, item.headers);
    }
    if (!channels.length) throw new EngineError('unsupported');
    const selected = sortChannels(channels).slice(0, MAX_CHANNELS);
    const urls = new Set(selected.flatMap(channel => [channel.url, ...channel.fallbacks]));
    for (const url of headers.keys()) if (!urls.has(url)) headers.delete(url);
    const serialized = JSON.stringify({ schemaVersion: 1, channels: selected, headers: [...headers].map(([url, values]) => ({ url, values })) });
    if (serialized.length > MAX_SNAPSHOT_BYTES) throw new EngineError('size');
    if (signal?.aborted) throw new EngineError('cancelled');
    try { await this.storage.setItem(CINEHD_LIVE_KEY, serialized); }
    catch { throw new EngineError('storage'); }
    this.publish(selected, headers);
  }
}
