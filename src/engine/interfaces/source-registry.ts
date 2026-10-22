import type { MediaSource } from '../models/source';

/**
 * Filter criteria for querying registered media sources.
 */
export interface SourceFilter {
  enabledOnly?: boolean;
  protocol?: MediaSource['protocol'];
  type?: MediaSource['type'];
}

/**
 * Registry interface for managing, retrieving, and persisting MediaSource definitions.
 */
export interface SourceRegistry {
  /**
   * Registers a new media source. Returns the saved source with assigned ID and timestamps.
   */
  addSource(source: Omit<MediaSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaSource>;

  /**
   * Retrieves a registered media source by ID.
   */
  getSource(id: string): Promise<MediaSource | null>;

  /**
   * Returns all registered media sources, optionally filtered.
   */
  getAllSources(filter?: SourceFilter): Promise<MediaSource[]>;

  /**
   * Returns all currently enabled media sources sorted by priority descending.
   */
  getActiveSources(): Promise<MediaSource[]>;

  /**
   * Partially updates an existing source's settings or status.
   */
  updateSource(id: string, patch: Partial<Omit<MediaSource, 'id' | 'createdAt'>>): Promise<MediaSource>;

  /**
   * Removes a media source from the registry.
   */
  removeSource(id: string): Promise<boolean>;

  /**
   * Clears all sources.
   */
  clear(): Promise<void>;
}
