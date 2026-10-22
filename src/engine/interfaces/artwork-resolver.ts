import type { Artwork, ContentItem } from '../models/content';
import type { RawDirectoryEntry } from './source-adapter';

/**
 * Candidate image file identified in a media directory.
 */
export interface ArtworkCandidate {
  entry: RawDirectoryEntry;
  type: 'poster' | 'backdrop' | 'banner' | 'logo' | 'thumb';
  priority: number;
}

/**
 * Resolver interface responsible for identifying, matching, and validating artwork
 * (posters, backdrops, banners) from directory sidecars or remote metadata.
 */
export interface ArtworkResolver {
  /**
   * Resolves artwork for a media item from neighboring sibling files or metadata.
   *
   * @param item The content item being resolved
   * @param siblingEntries Files in the same folder as the media file
   * @param signal Cancellation signal
   */
  resolveArtwork(
    item: ContentItem,
    siblingEntries?: RawDirectoryEntry[],
    signal?: AbortSignal,
  ): Promise<Artwork>;
}
