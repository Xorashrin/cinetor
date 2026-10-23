import { z } from 'zod';
import type { Episode, Season, Title } from '../data/mock';
import { EngineError, type Storage } from '../engine/model';
import {
  TmdbClient, TMDB_IMAGE_BASE, object,
  type CredentialGetter, type FetchLike, type TmdbClientOptions,
} from './client';

export const CINEHD_METADATA_KEY = 'cinetor:cinehd:metadata:v1';
export interface TmdbTitle extends Title {
  metadataProvider: 'tmdb';
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  originalLanguage?: string;
  imdbId?: string;
  rating?: number;
  popularity?: number;
  metadataUpdatedAt: number;
}
interface Entry { title: TmdbTitle; detailed: boolean; loadedSeasons: number[] }
const MAX_TITLES = 1200;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Sci-Fi', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
  10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality',
  10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};
const MetadataEpisode = z.object({
  id: z.string().max(100), number: z.number().int().min(1).max(10000),
  name: z.string().min(1).max(300), runtime: z.number().min(0).max(2000),
  synopsis: z.string().max(5000), seed: z.string().max(100),
  posterUrl: z.string().max(4096).optional(),
});
const MetadataTitle = z.object({
  id: z.string().regex(/^tmdb:(movie|tv):[1-9]\d*$/),
  name: z.string().min(1).max(300), kind: z.enum(['movie', 'series']),
  year: z.number().int().min(0).max(2200), runtime: z.number().min(0).max(2000),
  seasons: z.array(z.object({ number: z.number().int().min(1).max(1000), episodes: z.array(MetadataEpisode).max(1000) })).max(100),
  genres: z.array(z.string().max(80)).max(30), synopsis: z.string().max(5000),
  cast: z.array(z.string().max(300)).max(30), creators: z.array(z.string().max(300)).max(30),
  posterUrl: z.string().max(4096).optional(), backdropUrl: z.string().max(4096).optional(),
  metadataProvider: z.literal('tmdb'), tmdbId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  mediaType: z.enum(['movie', 'tv']), originalLanguage: z.string().max(20).optional(),
  imdbId: z.string().regex(/^tt\d{1,15}$/).optional(), rating: z.number().min(0).max(10).optional(),
  popularity: z.number().min(0).optional(), metadataUpdatedAt: z.number().finite(),
});
const Snapshot = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(z.object({ title: z.unknown(), detailed: z.boolean(), loadedSeasons: z.array(z.number().int().min(1).max(1000)).max(100) })).max(MAX_TITLES),
});

function textValue(input: unknown, limit = 300): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim().slice(0, limit) : undefined;
}
function numberValue(input: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= minimum && input <= maximum ? input : undefined;
}
function integer(input: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  const n = numberValue(input, minimum, maximum);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}
export function tmdbImage(path: unknown, size: 'w300' | 'w500' | 'w1280' | 'original' = 'w500'): string | undefined {
  return typeof path === 'string' && /^\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(path)
    ? `${TMDB_IMAGE_BASE}/${size}${path}` : undefined;
}
function cachedImage(input: string | undefined, size: string): string | undefined {
  if (!input) return undefined;
  return input.startsWith(`${TMDB_IMAGE_BASE}/${size}/`) &&
    /^\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i.test(input.slice(`${TMDB_IMAGE_BASE}/${size}`.length))
    ? input : undefined;
}
function identity(id: string): { type: 'movie' | 'tv'; number: number } | undefined {
  const match = /^tmdb:(movie|tv):([1-9]\d*)$/.exec(id);
  const n = match ? integer(Number(match[2])) : undefined;
  if (!match || n === undefined || (match[1] !== 'movie' && match[1] !== 'tv')) return undefined;
  return { type: match[1], number: n };
}
function yearValue(input: unknown): number {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return 0;
  const year = Number(input.slice(0, 4));
  return year >= 1880 && year <= 2200 ? year : 0;
}
function personNames(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.slice(0, 30).flatMap(row => {
    const name = textValue(object(row)?.name);
    return name ? [name] : [];
  }))];
}

export class CineHdCatalog {
  readonly client: TmdbClient;
  version = 0;
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(
    private readonly storage: Storage,
    credentials: CredentialGetter,
    fetcher?: FetchLike,
    options: TmdbClientOptions = {},
  ) {
    this.client = new TmdbClient(credentials, fetcher, options);
    this.now = options.now ?? Date.now;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  private publish(): void {
    this.version++;
    for (const listener of this.listeners) { try { listener(); } catch {} }
  }
  all(): TmdbTitle[] { return [...this.entries.values()].map(entry => entry.title); }
  get(id: string): TmdbTitle | undefined { return this.entries.get(id)?.title; }
  query(category: 'home' | 'anime' | 'kdrama'): TmdbTitle[] {
    return this.all().filter(title => category === 'home'
      ? !title.genres.includes('Anime') && !title.genres.includes('K-Drama')
      : title.genres.includes(category === 'anime' ? 'Anime' : 'K-Drama'));
  }

  async load(): Promise<void> {
    let raw: string | null;
    try { raw = await this.storage.getItem(CINEHD_METADATA_KEY); }
    catch { throw new EngineError('storage'); }
    if (!raw || raw.length > MAX_SNAPSHOT_BYTES) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    const snapshot = Snapshot.safeParse(parsed);
    if (!snapshot.success) return;
    const hydrated = new Map<string, Entry>();
    for (const entry of snapshot.data.entries) {
      const result = MetadataTitle.safeParse(entry.title);
      if (!result.success) continue;
      const row = result.data;
      if (row.id !== `tmdb:${row.mediaType}:${row.tmdbId}` || row.kind !== (row.mediaType === 'tv' ? 'series' : 'movie')) continue;
      const title: TmdbTitle = {
        ...row,
        maturity: 'UNRATED', moods: [], original: false, seed: row.id, tint: '#E50914',
        video: '', sources: [], quality: [],
        posterUrl: cachedImage(row.posterUrl, 'w500'), backdropUrl: cachedImage(row.backdropUrl, 'w1280'),
        seasons: row.seasons.map(season => ({
          number: season.number,
          episodes: season.episodes.filter(episode => episode.id === `${row.id}:s${season.number}e${episode.number}`).map(episode => ({
            ...episode, video: '', sources: [], posterUrl: cachedImage(episode.posterUrl, 'w300'),
          })),
        })),
      };
      hydrated.set(title.id, { title, detailed: entry.detailed, loadedSeasons: entry.loadedSeasons.filter(number => title.seasons.some(season => season.number === number)) });
    }
    this.entries = new Map([...hydrated, ...this.entries]);
    if (hydrated.size) this.publish();
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify({ schemaVersion: 1, entries: [...this.entries.values()] });
    if (snapshot.length > MAX_SNAPSHOT_BYTES) return Promise.reject(new EngineError('size'));
    const operation = this.persistQueue.catch(() => undefined).then(async () => {
      try { await this.storage.setItem(CINEHD_METADATA_KEY, snapshot); }
      catch { throw new EngineError('storage'); }
    });
    this.persistQueue = operation;
    return operation;
  }

  private parseTitle(input: unknown, type?: 'movie' | 'tv'): TmdbTitle | undefined {
    const row = object(input);
    if (!row || row.adult === true) return undefined;
    const mediaType = type ?? (row.media_type === 'movie' || row.media_type === 'tv' ? row.media_type : undefined);
    const tmdbId = integer(row.id);
    const name = textValue(mediaType === 'tv' ? row.name : row.title);
    if (!mediaType || tmdbId === undefined || !name) return undefined;
    const id = `tmdb:${mediaType}:${tmdbId}`;
    const genres: string[] = [];
    if (Array.isArray(row.genres)) {
      for (const inputGenre of row.genres.slice(0, 30)) {
        const genre = textValue(object(inputGenre)?.name, 80);
        if (genre) genres.push(genre);
      }
    } else if (Array.isArray(row.genre_ids)) {
      for (const inputGenre of row.genre_ids.slice(0, 30)) {
        const genreId = integer(inputGenre);
        if (genreId && GENRES[genreId]) genres.push(GENRES[genreId]);
      }
    }
    const language = textValue(row.original_language, 20);
    if (language === 'ja' && genres.includes('Animation')) genres.push('Anime');
    if (language === 'ko' && mediaType === 'tv') genres.push('K-Drama');
    const credits = object(row.credits);
    const crew = credits?.crew;
    const directors = Array.isArray(crew) ? crew.filter(inputCrew => object(inputCrew)?.job === 'Director') : [];
    const runtime = numberValue(row.runtime, 0, 2000) ??
      (Array.isArray(row.episode_run_time) ? row.episode_run_time.map(value => numberValue(value, 0, 2000)).find(value => value !== undefined) : undefined) ?? 0;
    const seasons = new Map<number, Season>();
    if (mediaType === 'tv' && Array.isArray(row.seasons)) {
      for (const inputSeason of row.seasons.slice(0, 100)) {
        const number = integer(object(inputSeason)?.season_number, 1, 1000);
        if (number !== undefined) seasons.set(number, { number, episodes: [] });
      }
    }
    const external = object(row.external_ids);
    const imdbId = typeof external?.imdb_id === 'string' && /^tt\d{1,15}$/.test(external.imdb_id) ? external.imdb_id : undefined;
    return {
      id, name, kind: mediaType === 'tv' ? 'series' : 'movie',
      year: yearValue(mediaType === 'tv' ? row.first_air_date : row.release_date),
      maturity: 'UNRATED', runtime, seasons: [...seasons.values()].sort((a, b) => a.number - b.number),
      genres: [...new Set(genres)], moods: [], synopsis: textValue(row.overview, 5000) ?? '',
      cast: personNames(credits?.cast), creators: personNames(mediaType === 'tv' ? row.created_by : directors),
      original: false, seed: id, tint: '#E50914', video: '', sources: [], quality: [],
      posterUrl: tmdbImage(row.poster_path, 'w500'), backdropUrl: tmdbImage(row.backdrop_path, 'w1280'),
      metadataProvider: 'tmdb', tmdbId, mediaType, originalLanguage: language, imdbId,
      rating: numberValue(row.vote_average, 0, 10), popularity: numberValue(row.popularity),
      metadataUpdatedAt: this.now(),
    };
  }

  private insert(title: TmdbTitle, detailed = false): TmdbTitle {
    const previous = this.entries.get(title.id);
    let next = title;
    if (previous) {
      next = {
        ...title,
        ...(previous.detailed && !detailed ? previous.title : {}),
        genres: [...new Set([...title.genres, ...previous.title.genres])],
        seasons: (detailed ? title.seasons : previous.title.seasons.length ? previous.title.seasons : title.seasons).map(season => ({
          ...season,
          episodes: previous.title.seasons.find(existing => existing.number === season.number)?.episodes ?? season.episodes,
        })),
        posterUrl: title.posterUrl ?? previous.title.posterUrl,
        backdropUrl: title.backdropUrl ?? previous.title.backdropUrl,
        imdbId: title.imdbId ?? previous.title.imdbId,
      };
      this.entries.delete(title.id);
    }
    this.entries.set(title.id, { title: next, detailed: detailed || previous?.detailed === true, loadedSeasons: previous?.loadedSeasons ?? [] });
    while (this.entries.size > MAX_TITLES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return next;
  }

  private parseResults(input: unknown, type?: 'movie' | 'tv'): TmdbTitle[] {
    const rows = object(input)?.results;
    if (!Array.isArray(rows)) throw new EngineError('malformed');
    return rows.slice(0, 100).flatMap(row => {
      const title = this.parseTitle(row, type);
      return title ? [title] : [];
    });
  }

  async refresh(signal?: AbortSignal): Promise<void> {
    this.client.clearCache();
    const feeds: { path: string; type: 'movie' | 'tv'; params: Record<string, string | number | boolean> }[] = [
      { path: '/trending/movie/week', type: 'movie', params: { page: 1, include_adult: false } },
      { path: '/trending/tv/week', type: 'tv', params: { page: 1, include_adult: false } },
      { path: '/discover/tv', type: 'tv', params: { page: 1, include_adult: false, with_genres: 16, with_original_language: 'ja', sort_by: 'popularity.desc' } },
      { path: '/discover/tv', type: 'tv', params: { page: 1, include_adult: false, with_original_language: 'ko', sort_by: 'popularity.desc' } },
    ];
    const results = await Promise.allSettled(feeds.map(async feed => {
      const response = await this.client.request(feed.path, feed.params, signal);
      if (signal?.aborted) throw new EngineError('cancelled');
      const titles = this.parseResults(response, feed.type);
      for (const title of titles) this.insert(title);
      if (titles.length) { this.publish(); await this.persist(); }
    }));
    if (signal?.aborted) throw new EngineError('cancelled');
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }

  async search(query: string, signal?: AbortSignal): Promise<TmdbTitle[]> {
    const trimmed = query.trim().slice(0, 200);
    if (!trimmed) return [];
    const response = await this.client.request('/search/multi', { query: trimmed, include_adult: false, page: 1 }, signal);
    if (signal?.aborted) throw new EngineError('cancelled');
    const titles = this.parseResults(response);
    const unique = new Map<string, TmdbTitle>();
    for (const title of titles) unique.set(title.id, this.insert(title));
    if (titles.length) { this.publish(); await this.persist(); }
    return [...unique.values()];
  }

  async detail(id: string, signal?: AbortSignal): Promise<TmdbTitle | undefined> {
    if (signal?.aborted) throw new EngineError('cancelled');
    const parsed = identity(id);
    if (!parsed) return undefined;
    const previous = this.entries.get(id);
    if (!previous?.detailed) {
      let response: unknown;
      try { response = await this.client.request(`/${parsed.type}/${parsed.number}`, { append_to_response: 'credits,external_ids' }, signal); }
      catch (error) {
        if (error instanceof EngineError && error.code === 'unsupported') return undefined;
        throw error;
      }
      if (signal?.aborted) throw new EngineError('cancelled');
      const title = this.parseTitle(response, parsed.type);
      if (!title || title.id !== id) return undefined;
      this.insert(title, true);
      this.publish();
      await this.persist();
    }
    const title = this.get(id);
    const first = title?.seasons[0];
    if (title?.kind === 'series' && first) await this.season(id, first.number, signal);
    return this.get(id);
  }

  async season(id: string, number: number, signal?: AbortSignal): Promise<Season | undefined> {
    if (signal?.aborted) throw new EngineError('cancelled');
    const parsed = identity(id);
    if (!parsed || parsed.type !== 'tv' || integer(number, 1, 1000) === undefined) return undefined;
    const cached = this.entries.get(id);
    if (!cached) return undefined;
    if (cached.loadedSeasons.includes(number)) return cached.title.seasons.find(season => season.number === number);
    const response = object(await this.client.request(`/tv/${parsed.number}/season/${number}`, {}, signal));
    if (signal?.aborted) throw new EngineError('cancelled');
    if (!response || response.season_number !== number || !Array.isArray(response.episodes)) throw new EngineError('malformed');
    const episodes = new Map<number, Episode>();
    for (const input of response.episodes.slice(0, 1000)) {
      const episode = object(input);
      const episodeNumber = integer(episode?.episode_number, 1, 10000);
      const name = textValue(episode?.name);
      if (!episode || episodeNumber === undefined || !name || (episode.season_number !== undefined && episode.season_number !== number)) continue;
      const episodeId = `${id}:s${number}e${episodeNumber}`;
      episodes.set(episodeNumber, {
        id: episodeId, number: episodeNumber, name,
        runtime: numberValue(episode.runtime, 0, 2000) ?? 0,
        synopsis: textValue(episode.overview, 5000) ?? '', seed: episodeId,
        posterUrl: tmdbImage(episode.still_path, 'w300'), video: '', sources: [],
      });
    }
    const season = { number, episodes: [...episodes.values()].sort((a, b) => a.number - b.number) };
    const current = this.entries.get(id);
    if (!current) return undefined;
    current.title = {
      ...current.title,
      seasons: [...current.title.seasons.filter(existing => existing.number !== number), season].sort((a, b) => a.number - b.number),
      metadataUpdatedAt: this.now(),
    };
    current.loadedSeasons = [...new Set([...current.loadedSeasons, number])];
    this.publish();
    await this.persist();
    return season;
  }
}
