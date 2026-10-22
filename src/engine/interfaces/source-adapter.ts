import type { MediaSource, SourceProtocol, SourceType } from '../models/source';

/**
 * Type of raw directory entry.
 */
export type RawEntryType = 'file' | 'directory';

/**
 * Raw directory or file listing item returned by a source adapter.
 */
export interface RawDirectoryEntry {
  name: string;
  path: string; // Relative path from the base URL or parent
  url: string;  // Fully resolved absolute URL for downloading or playing
  type: RawEntryType;
  sizeBytes?: number;
  lastModified?: number; // Epoch timestamp in ms
}

/**
 * Adapter interface for interacting with diverse remote server structures
 * (e.g., Apache/Nginx autoindex, JSON index APIs, M3U playlists).
 */
export interface SourceAdapter {
  /** Supported protocol (e.g., 'http', 'https') */
  readonly protocol: SourceProtocol;

  /** Supported structural types (e.g., ['directory-listing', 'json-api']) */
  readonly supportedTypes: SourceType[];

  /**
   * Checks whether this adapter can communicate with the given media source.
   */
  canHandle(source: MediaSource): boolean;

  /**
   * Lists the entries of a remote directory at the given relative path.
   *
   * @param source The media source configuration
   * @param relativePath Target relative path (e.g., '' or 'movies/action/')
   * @param signal Cancellation signal
   */
  listDirectory(
    source: MediaSource,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<RawDirectoryEntry[]>;

  /**
   * Fetches raw string text from a remote path (useful for sidecar subtitles or NFO files).
   */
  fetchText?(
    source: MediaSource,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<string>;
}
