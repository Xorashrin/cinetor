import type { MediaSource } from '../models/source';
import type { RawDirectoryEntry } from './source-adapter';

/**
 * Options configuring the directory crawler execution.
 */
export interface CrawlOptions {
  /** Maximum folder traversal depth from root (default: 8) */
  maxDepth?: number;
  /** Maximum number of files to discover before stopping (default: 5000) */
  maxFiles?: number;
  /** File extensions to include (case-insensitive, e.g., ['.mp4', '.mkv']) */
  allowedExtensions?: string[];
  /** Sub-paths or folder names to skip (e.g., ['@eaDir', '.trash', 'lost+found']) */
  excludeFolders?: string[];
}

/**
 * Event types emitted by the directory crawler during traversal.
 */
export type CrawlEventType = 'directory' | 'file' | 'error' | 'finish';

/**
 * Structure of events emitted during directory crawling.
 */
export interface CrawlEvent {
  type: CrawlEventType;
  depth: number;
  path: string;
  entry?: RawDirectoryEntry;
  error?: Error;
}

/**
 * Crawler interface responsible for traversing remote source directory trees
 * with cycle detection, configurable depth, filtering, and cancellation.
 */
export interface DirectoryCrawler {
  /**
   * Traverses a remote media source starting from a relative root path.
   * Emits discovered entries as an async stream.
   *
   * @param source The media source to crawl
   * @param startPath Starting path (defaults to '')
   * @param options Configurable traversal limits
   * @param signal Cancellation signal
   */
  crawl(
    source: MediaSource,
    startPath?: string,
    options?: CrawlOptions,
    signal?: AbortSignal,
  ): AsyncIterable<CrawlEvent>;
}
