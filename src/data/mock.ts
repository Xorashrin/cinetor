export type Kind = 'series' | 'movie';
export type Maturity = 'ALL' | '7+' | '13+' | '16+' | '18+';
export type Quality = 'HD' | '4K' | 'HDR' | '5.1' | 'AD' | 'CC';
export type Badge = 'new-episode' | 'new-season' | 'recently-added' | 'leaving-soon';

export interface PlaybackSourceRef {
  url: string;
  sourceId?: string;
  verificationState?: string;
  quality?: string;
  container?: string;
  fileSizeBytes?: number;
}

export interface Episode {
  id: string;
  number: number;
  name: string;
  runtime: number;
  synopsis: string;
  seed: string;
  video: string;
  sources?: PlaybackSourceRef[];
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface ComingSoon {
  month: string;
  day: string;
  label: string;
}

export interface Title {
  id: string;
  name: string;
  kind: Kind;
  year: number;
  maturity: Maturity;
  runtime: number;
  seasons: Season[];
  genres: string[];
  moods: string[];
  synopsis: string;
  cast: string[];
  creators: string[];
  original: boolean;
  seed: string;
  tint: string;
  video: string;
  quality: Quality[];
  badge?: Badge;
  comingSoon?: ComingSoon;
  posterUrl?: string;
  backdropUrl?: string;
  sources?: PlaybackSourceRef[];
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  kids?: boolean;
}

export interface AppNotification {
  id: string;
  titleId: string;
  kicker: string;
  text: string;
  date: string;
}

export const SAMPLE_VIDEOS: string[] = [];

export const DEFAULT_TITLE: Title = {
  id: 'empty',
  name: 'Cinator',
  kind: 'series',
  year: 2026,
  maturity: 'ALL',
  runtime: 0,
  seasons: [],
  genres: [],
  moods: [],
  synopsis: '',
  cast: [],
  creators: [],
  original: true,
  seed: 'cinator',
  tint: '#E50914',
  video: '',
  quality: ['HD', '5.1', 'CC'],
};

export const TITLES: Title[] = [];
const TITLE_MAP = new Map<string, Title>();

export function getTitle(id: string): Title {
  return TITLE_MAP.get(id) ?? DEFAULT_TITLE;
}

export function findEpisode(title: Title, episodeId?: string): { season: Season; episode: Episode } | null {
  for (const season of title.seasons) {
    for (const episode of season.episodes) {
      if (!episodeId || episode.id === episodeId) return { season, episode };
    }
  }
  return null;
}

export function nextEpisode(title: Title, episodeId: string): Episode | null {
  const all = title.seasons.flatMap((s) => s.episodes);
  const i = all.findIndex((e) => e.id === episodeId);
  return i >= 0 && i + 1 < all.length ? all[i + 1] : null;
}

export const AVAILABLE: Title[] = [];
export const COMING_SOON: Title[] = [];
export const SERIES: Title[] = [];
export const MOVIES: Title[] = [];

export const TOP10_TV: Title[] = [];
export const TOP10_MOVIES: Title[] = [];

export function top10Rank(id: string): { rank: number; list: 'TV Shows' | 'Movies' } | null {
  const tvIdx = TOP10_TV.findIndex((t) => t.id === id);
  if (tvIdx >= 0) return { rank: tvIdx + 1, list: 'TV Shows' };

  const movieIdx = TOP10_MOVIES.findIndex((t) => t.id === id);
  if (movieIdx >= 0) return { rank: movieIdx + 1, list: 'Movies' };

  return null;
}

/**
 * Synchronizes verified catalog titles with existing UI collections in-place,
 * ensuring all imported references (AVAILABLE, SERIES, MOVIES, etc.) stay current.
 */
export function syncCatalogTitles(titles: Title[]): void {
  TITLE_MAP.clear();
  for (const t of titles) {
    TITLE_MAP.set(t.id, t);
  }

  TITLES.length = 0;
  TITLES.push(...titles);

  AVAILABLE.length = 0;
  AVAILABLE.push(...titles.filter((t) => !t.comingSoon && (Boolean(t.video) || t.seasons.length > 0)));

  SERIES.length = 0;
  SERIES.push(...AVAILABLE.filter((t) => t.kind === 'series'));

  MOVIES.length = 0;
  MOVIES.push(...AVAILABLE.filter((t) => t.kind === 'movie'));

  TOP10_TV.length = 0;
  TOP10_TV.push(...SERIES.slice(0, 10));

  TOP10_MOVIES.length = 0;
  TOP10_MOVIES.push(...MOVIES.slice(0, 10));
}

/**
 * Converts a backend ContentItem into a frontend Title representation.
 */
export function contentItemToTitle(item: any): Title {
  const isMovieItem = item.kind === 'movie';

  if (isMovieItem) {
    const primaryVideo = item.videoUrl || (item.sources && item.sources[0]?.url) || '';
    return {
      id: item.id,
      name: item.name,
      kind: 'movie',
      year: item.year ?? new Date(item.discoveredAt || Date.now()).getFullYear(),
      maturity: item.maturity ?? 'ALL',
      runtime: item.runtime ?? 90,
      seasons: [],
      genres: item.genres ?? [],
      moods: item.moods && item.moods.length > 0 ? item.moods : ['Gripping', 'Exciting'],
      synopsis: item.synopsis ?? '',
      cast: item.cast ?? [],
      creators: item.creators ?? [],
      original: false,
      seed: item.id,
      tint: '#E50914',
      video: primaryVideo,
      quality: item.quality && item.quality.length > 0 ? item.quality : ['HD'],
      badge: item.badge,
      posterUrl: item.artwork?.posterUrl,
      backdropUrl: item.artwork?.backdropUrl,
      sources: item.sources ?? [],
    };
  }

  // Episodic Series
  const rawSeasons = item.seasons ?? [];
  const seasons: Season[] = rawSeasons.map((s: any) => ({
    number: s.seasonNumber ?? 1,
    episodes: (s.episodes ?? []).map((e: any) => ({
      id: e.id,
      number: e.episodeNumber ?? 1,
      name: e.name || `Episode ${e.episodeNumber ?? 1}`,
      runtime: e.runtime || 45,
      synopsis: e.synopsis || '',
      seed: e.id,
      video: e.videoUrl || (e.sources && e.sources[0]?.url) || '',
      sources: e.sources ?? [],
    })),
  }));

  const firstSeason = seasons[0];
  const firstEpisode = firstSeason?.episodes[0];
  const primaryVideo = firstEpisode?.video ?? '';

  return {
    id: item.id,
    name: item.name,
    kind: 'series',
    year: item.year ?? new Date(item.discoveredAt || Date.now()).getFullYear(),
    maturity: item.maturity ?? 'ALL',
    runtime: 0,
    seasons,
    genres: item.genres ?? [],
    moods: item.moods && item.moods.length > 0 ? item.moods : ['Binge-Worthy', 'Popular'],
    synopsis: item.synopsis ?? '',
    cast: item.cast ?? [],
    creators: item.creators ?? [],
    original: false,
    seed: item.id,
    tint: '#E50914',
    video: primaryVideo,
    quality: item.quality && item.quality.length > 0 ? item.quality : ['HD'],
    badge: item.badge,
    posterUrl: item.artwork?.posterUrl,
    backdropUrl: item.artwork?.backdropUrl,
    sources: firstEpisode?.sources ?? [],
  };
}

export const GENRES = [
  'Live TV', 'Adult (18+)', 'Action', 'Adventure', 'Anime', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror',
  'K-Drama', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Sports', 'Kids',
];

export const MAIN_PROFILE_ID = 'main';
export const PROFILE_COLOR = '#E50914';

export const NOTIFICATIONS: AppNotification[] = [];
