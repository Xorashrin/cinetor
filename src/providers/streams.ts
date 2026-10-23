import type { PlaybackSourceRef, Title } from '../data/mock';
import { EngineError } from '../engine/model';
import { ProviderHttp, publicUrl } from './request';

export const DOMAIN_PROXY_URL = 'https://allmovieland-proxy.60-60.workers.dev';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reconstruct the APK's AWSIND adapter without running its HTML or ad SDKs. */
export class NativeStreamResolver {
  private cache = new Map<string, { at: number; refs: PlaybackSourceRef[] }>();
  private domain?: { value: string; at: number };
  private failed = new Map<string, number>();
  constructor(private http: ProviderHttp) {}
  private key(id: string, season?: number, episode?: number): string { return `${id}:${season ?? 0}:${episode ?? 0}`; }
  alternatives(id: string, season?: number, episode?: number, failed = new Set<string>()): PlaybackSourceRef[] {
    const entry = this.cache.get(this.key(id, season, episode));
    if (!entry || Date.now() - entry.at > 240000) return [];
    return entry.refs.filter(r => !failed.has(r.url) && (this.failed.get(r.url) ?? 0) < Date.now());
  }
  report(url: string, decoded: boolean): void {
    if (decoded) this.failed.delete(url);
    else this.failed.set(url, Date.now() + 300000);
    if (this.failed.size > 200) this.failed.delete(this.failed.keys().next().value ?? '');
  }
  headers(url: string): Record<string, string> | undefined {
    for (const entry of this.cache.values()) {
      const ref = entry.refs.find(r => r.url === url);
      if (ref && Date.now() - entry.at < 240000) return ref.headers;
    }
    return undefined;
  }
  private async upstream(signal?: AbortSignal): Promise<string> {
    if (this.domain && Date.now() - this.domain.at < 600000) return this.domain.value;
    const result = await this.http.json(DOMAIN_PROXY_URL, { signal, maxBytes: 65536 });
    if (!object(result) || typeof result.awsIndStreamDomain !== 'string') throw new EngineError('malformed');
    const url = publicUrl(result.awsIndStreamDomain);
    if (new URL(url).pathname !== '/') throw new EngineError('scope');
    this.domain = { value: new URL(url).origin, at: Date.now() };
    return this.domain.value;
  }
  private playlistUrl(file: string, domain: string): string {
    const url = publicUrl(file.startsWith('~') ? `/playlist/${file.slice(1)}.txt` : file, domain);
    if (!new URL(url).pathname.startsWith('/playlist/')) throw new EngineError('scope');
    return url;
  }
  async resolve(title: Title, season?: number, episode?: number, signal?: AbortSignal): Promise<PlaybackSourceRef[]> {
    if (signal?.aborted) throw new EngineError('cancelled');
    const cached = this.alternatives(title.id, season, episode);
    if (cached.length) return cached;
    if (!title.imdbId || !/^tt\d+$/.test(title.imdbId)) throw new EngineError('configuration');
    if (title.kind === 'series' && (!season || !episode)) throw new EngineError('configuration');
    const discoveredDomain = await this.upstream(signal);
    const pageUrl = `${discoveredDomain}/play/${title.imdbId}`;
    const page = await this.http.request(pageUrl, { signal, headers: { 'User-Agent': USER_AGENT, referer: 'https://vegamovies.ss/' }, types: ['text/html'] });
    const extract = (name: string): string => {
      const match = page.text.match(new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      if (!match) throw new EngineError('malformed');
      try { const value: unknown = JSON.parse(`"${match[1]}"`); if (typeof value === 'string') return value; } catch {}
      throw new EngineError('malformed');
    };
    const file = extract('file'), token = extract('key');
    if (!token || token.length > 4096 || /[\r\n]/.test(token)) throw new EngineError('malformed');
    const playlistUrl = this.playlistUrl(file, discoveredDomain);
    const domain = new URL(playlistUrl).origin;
    const headers = { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', origin: domain, referer: pageUrl, 'x-csrf-token': token };
    const result = await this.http.request(playlistUrl, { signal, method: 'POST', headers });
    let playlist: unknown;
    try { playlist = JSON.parse(result.text); } catch { playlist = result.text.trim(); }
    let rows: unknown = playlist;
    if (title.kind === 'series') {
      const seasons = Array.isArray(rows) ? rows : object(rows) ? rows.folder : undefined;
      const select = (items: unknown, coordinate: number, kind: 'season' | 'episode'): unknown => {
        if (!Array.isArray(items)) return undefined;
        let labeled = false;
        for (const item of items) {
          if (!object(item)) continue;
          const explicit = item[kind] ?? item[`${kind}_number`];
          const pattern = kind === 'season' ? /(?:season|s)\s*(\d+)/i : /(?:episode|e)\s*(\d+)/i;
          const match = typeof item.title === 'string' ? item.title.match(pattern) : null;
          const number = typeof explicit === 'number' ? explicit : match ? Number(match[1]) : undefined;
          if (number !== undefined) { labeled = true; if (number === coordinate) return item; }
        }
        return labeled ? undefined : items[coordinate - 1];
      };
      const selected = select(seasons, season ?? 1, 'season');
      const episodes = object(selected) ? selected.folder : undefined;
      const selectedEpisode = select(episodes, episode ?? 1, 'episode');
      rows = object(selectedEpisode) ? selectedEpisode.folder : undefined;
    } else if (Array.isArray(rows) && object(rows[0]) && Array.isArray(rows[0].folder)) rows = rows[0].folder;
    else if (object(rows) && Array.isArray(rows.folder)) rows = rows.folder;
    const refs: PlaybackSourceRef[] = [];
    if (typeof rows === 'string' && /\.m3u8(?:\?|$)/i.test(rows)) {
      refs.push(await this.probe(rows, headers, 'AWSIND', signal));
    } else if (Array.isArray(rows)) {
      const flatten = (items: unknown[], depth = 0): unknown[] => depth > 3 ? [] : items.slice(0, 30).flatMap(row =>
        object(row) && Array.isArray(row.folder) ? flatten(row.folder, depth + 1) : [row]);
      const candidates = flatten(rows).slice(0, 20);
      for (let offset = 0; offset < candidates.length; offset += 2) {
        const outcomes = await Promise.allSettled(candidates.slice(offset, offset + 2).map(async row => {
          if (!object(row) || typeof row.file !== 'string') throw new EngineError('malformed');
          const leaf = row.file.replace('~', '');
          if (!/^[a-zA-Z0-9_$+\-=]{1,1000}$/.test(leaf)) throw new EngineError('malformed');
          const media = await this.http.request(`${domain}/playlist/${leaf}.txt`, { signal, method: 'POST', headers, maxBytes: 65536 });
          let uri: unknown;
          try { uri = JSON.parse(media.text); } catch { uri = media.text.trim(); }
          if (typeof uri !== 'string') throw new EngineError('malformed');
          return this.probe(uri, headers, typeof row.title === 'string' ? row.title.slice(0, 80) : 'AWSIND', signal);
        }));
        for (const outcome of outcomes) if (outcome.status === 'fulfilled') refs.push(outcome.value);
        if (signal?.aborted) throw new EngineError('cancelled');
      }
    }
    if (!refs.length) throw new EngineError('unsupported');
    this.cache.set(this.key(title.id, season, episode), { at: Date.now(), refs });
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value ?? '');
    return refs;
  }
  async probe(input: string, requestHeaders: Record<string, string>, label: string, signal?: AbortSignal, depth = 0): Promise<PlaybackSourceRef> {
    const url = publicUrl(input);
    const headers = { 'User-Agent': requestHeaders['User-Agent'] ?? requestHeaders['user-agent'] ?? USER_AGENT, origin: requestHeaders.origin, referer: requestHeaders.referer };
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith('.mp4')) {
      const result = await this.http.request(url, { signal, headers: { ...headers, Range: 'bytes=0-4095' }, prefix: true, maxBytes: 4096, types: ['video/mp4', 'application/octet-stream'] });
      if (String.fromCharCode(...result.bytes.slice(4, 8)) !== 'ftyp' || result.bytes.length < 16) throw new EngineError('unsupported');
      return { url, headers, label, sourceId: 'cinehd-awsind', verificationState: 'transport-verified', downloadable: true, container: 'mp4' };
    }
    if (!path.endsWith('.m3u8') || depth > 2) throw new EngineError('unsupported');
    const result = await this.http.request(url, { signal, headers, maxBytes: 1048576 });
    if (!result.text.trimStart().startsWith('#EXTM3U') || /#EXT-X-(SESSION-KEY|KEY):[^\n]*(SAMPLE-AES|KEYFORMAT)/i.test(result.text) ||
        /#EXT-X-(CUE-OUT|DATERANGE):[^\n]*(ad|scte)/i.test(result.text)) throw new EngineError('unsupported');
    const lines = result.text.split(/\r?\n/).map(v => v.trim());
    const master = lines.findIndex(l => l.startsWith('#EXT-X-STREAM-INF:'));
    if (master >= 0) {
      const child = lines.slice(master + 1).find(l => l && !l.startsWith('#'));
      if (!child) throw new EngineError('malformed');
      await this.probe(publicUrl(child, result.url), requestHeaders, label, signal, depth + 1);
    } else {
      const index = lines.findIndex(l => l.startsWith('#EXTINF:'));
      const segment = lines.slice(index + 1).find(l => l && !l.startsWith('#'));
      if (index < 0 || !segment) throw new EngineError('malformed');
      const media = await this.http.request(publicUrl(segment, result.url), { signal, headers, prefix: true, maxBytes: 4096 });
      if (media.bytes[0] !== 0x47 && !['ftyp', 'styp', 'moof'].includes(String.fromCharCode(...media.bytes.slice(4, 8)))) throw new EngineError('unsupported');
    }
    return { url, headers, label, sourceId: 'cinehd-awsind', verificationState: 'transport-verified', downloadable: true, container: 'hls' };
  }
}
