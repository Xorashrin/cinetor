import type { Kind } from '../../data/mock';
import type { ContentItem, Movie, Series } from '../models/content';

/**
 * Filter and pagination query for catalog retrieval.
 */
export interface CatalogQuery {
  kind?: Kind;
  genres?: string[];
  sourceId?: string;
  year?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'name' | 'year' | 'discoveredAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Catalog aggregate statistics.
 */
export interface CatalogStats {
  totalItems: number;
  moviesCount: number;
  seriesCount: number;
  episodesCount: number;
  sourcesCount: number;
  lastUpdatedAt: number;
}

/**
 * Storage repository interface for querying, updating, and persisting catalog items.
 */
export interface CatalogRepository {
  /**
   * Persists or updates a single content item.
   */
  saveItem(item: ContentItem): Promise<void>;

  /**
   * Batch persists or updates multiple content items.
   */
  saveItems(items: ContentItem[]): Promise<void>;

  /**
   * Retrieves a content item by its unique ID.
   */
  getItem(id: string): Promise<ContentItem | null>;

  /**
   * Retrieves a Movie item by ID, or null if not found or not a movie.
   */
  getMovie(id: string): Promise<Movie | null>;

  /**
   * Retrieves a Series item by ID, or null if not found or not a series.
   */
  getSeries(id: string): Promise<Series | null>;

  /**
   * Queries catalog items matching the specified criteria.
   */
  find(query?: CatalogQuery): Promise<ContentItem[]>;

  /**
   * Fast full-text search across titles, genres, and metadata.
   */
  search(text: string, limit?: number): Promise<ContentItem[]>;

  /**
   * Deletes a content item by ID.
   */
  remove(id: string): Promise<boolean>;

  /**
   * Deletes all content items associated with a specific media source.
   */
  removeBySource(sourceId: string): Promise<number>;

  /**
   * Clears the entire catalog.
   */
  clear(): Promise<void>;

  /**
   * Invalidates a specific failed playback URL for an item or episode.
   * If alternative verified mirrors exist for the same content, switches to the next mirror.
   * If all sources are exhausted, marks the item REJECTED.
   * Returns the new verified URL or null if none remain.
   */
  invalidateSourceUrl(contentId: string, failedUrl: string, episodeId?: string): Promise<string | null>;

  /**
   * Marks all streams from a given source as offline, preserving other valid mirrors.
   */
  markSourceOffline(sourceId: string): Promise<number>;

  /**
   * Returns catalog summary statistics.
   */
  getStats(): Promise<CatalogStats>;
}
