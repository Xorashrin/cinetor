export type Kind = 'series' | 'movie';
export type Maturity = 'ALL' | '7+' | '13+' | '16+' | '18+' | 'UNRATED';
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

export function syncCatalogTitles(titles: Title[], restricted: Title[] = []): void {
  TITLES.splice(0, TITLES.length, ...titles);
  TITLE_MAP.clear(); [...titles, ...restricted].forEach(t => TITLE_MAP.set(t.id, t));
  AVAILABLE.splice(0, AVAILABLE.length, ...titles);
  SERIES.splice(0, SERIES.length, ...titles.filter(t => t.kind === "series"));
  MOVIES.splice(0, MOVIES.length, ...titles.filter(t => t.kind === "movie"));
}

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

export const HOME_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror',
  'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Sports', 'Kids',
];

export const GENRES = [
  'Action', 'Adventure', 'Anime', 'Comedy', 'Crime', 'Drama', 'Fantasy', 'Horror',
  'K-Drama', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Sports', 'Kids',
];

export const MAIN_PROFILE_ID = 'main';
export const PROFILE_COLOR = '#E50914';

export const NOTIFICATIONS: AppNotification[] = [];
