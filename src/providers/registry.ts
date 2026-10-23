import { z } from 'zod';
import type { Title } from '../data/mock';
import { EngineError } from '../engine/model';
import { ProviderHttp, publicUrl } from './request';

export const PROVIDER_REGISTRY_URL = 'https://raw.githubusercontent.com/michel8899/embed-proxy/main/providers.json';
const Entry = z.object({ idType: z.enum(['tmdb', 'imdb']), url: z.string().max(4096), noSeasonEpisode: z.boolean().optional() });
const Registry = z.object({ version: z.number(), proxyBase: z.string().url(), providers: z.array(z.object({ name: z.string().max(80), movie: Entry.optional(), tv: Entry.optional() })).max(100) });
export type EmbedProvider = z.infer<typeof Registry>['providers'][number];

/** This registry describes HTML players; its URLs are never passed to expo-video. */
export class ProviderRegistry {
  private providers: EmbedProvider[] = [];
  private loadedAt = 0;
  constructor(private http: ProviderHttp) {}
  all(): EmbedProvider[] { return this.providers; }
  async refresh(signal?: AbortSignal): Promise<void> {
    if (this.providers.length && Date.now() - this.loadedAt < 21600000) return;
    const value = Registry.safeParse(await this.http.json(PROVIDER_REGISTRY_URL, { signal, maxBytes: 131072 }));
    if (!value.success) throw new EngineError('malformed');
    this.providers = value.data.providers.filter(p => [p.movie, p.tv].filter(Boolean).every(e => {
      try { publicUrl(e?.url ?? ''); return true; } catch { return false; }
    }));
    this.loadedAt = Date.now();
  }
  embed(provider: EmbedProvider, title: Title, season?: number, episode?: number): string | undefined {
    const entry = title.kind === 'series' ? provider.tv : provider.movie;
    if (!entry) return undefined;
    const id = entry.idType === 'imdb' ? title.imdbId : title.tmdbId;
    if (!id || (title.kind === 'series' && !entry.noSeasonEpisode && (!season || !episode))) return undefined;
    return publicUrl(entry.url.replaceAll('{id}', encodeURIComponent(String(id)))
      .replaceAll('{season}', String(season ?? '')).replaceAll('{episode}', String(episode ?? '')));
  }
}
