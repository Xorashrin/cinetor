import type { Badge, Kind, Maturity, Quality } from '../../data/mock';
import type { VerificationState, VerifiedPlaybackSource } from './verification';

/**
 * Visual artwork metadata associated with content.
 */
export interface Artwork {
  posterUrl?: string;
  backdropUrl?: string;
  thumbnailUrl?: string;
  bannerUrl?: string;
  logoUrl?: string;
  source: 'embedded' | 'sidecar' | 'remote' | 'generated' | 'none';
}

/**
 * Base content model representing any catalog item discovered across sources.
 */
export interface ContentItem {
  readonly id: string;
  readonly sourceId: string;
  readonly sourcePath: string;
  name: string;
  originalName?: string;
  kind: Kind;
  year?: number;
  maturity: Maturity;
  genres: string[];
  moods: string[];
  synopsis?: string;
  artwork: Artwork;
  quality: Quality[];
  badge?: Badge;
  verificationState: VerificationState;
  discoveredAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Standalone movie content item with verified playback references.
 */
export interface Movie extends ContentItem {
  kind: 'movie';
  runtime: number; // in minutes
  videoUrl: string; // Active primary verified playback URL
  sources?: VerifiedPlaybackSource[]; // Independent verified sources for deduplication
  fileSize?: number; // in bytes
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  language?: string;
}

/**
 * Individual episode belonging to a season of a series.
 */
export interface Episode {
  readonly id: string;
  readonly seriesId: string;
  readonly seasonNumber: number;
  readonly episodeNumber: number;
  name: string;
  runtime: number; // in minutes
  synopsis?: string;
  videoUrl: string; // Active primary verified playback URL
  sources?: VerifiedPlaybackSource[]; // Independent verified sources for deduplication
  sourcePath: string;
  verificationState?: VerificationState;
  artwork?: Artwork;
  fileSize?: number; // in bytes
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  quality?: Quality[];
}

/**
 * Season grouping inside an episodic series.
 */
export interface Season {
  seasonNumber: number;
  name?: string;
  episodes: Episode[];
}

/**
 * Episodic series content item (TV Shows, Anime, K-Dramas, Cartoons).
 */
export interface Series extends ContentItem {
  kind: 'series';
  seasons: Season[];
  totalEpisodes: number;
  totalSeasons: number;
}

/**
 * Type guard to check if a ContentItem is a Movie.
 */
export function isMovie(item: ContentItem): item is Movie {
  return item.kind === 'movie';
}

/**
 * Type guard to check if a ContentItem is a Series.
 */
export function isSeries(item: ContentItem): item is Series {
  return item.kind === 'series';
}

/**
 * Helper to check if an item or episode is verified and playable.
 */
export function isPlayable(item: ContentItem): boolean {
  return item.verificationState === 'VERIFIED';
}
