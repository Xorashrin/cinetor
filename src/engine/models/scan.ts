/**
 * Status lifecycle of a media scanning job.
 */
export type ScanJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Real-time progress counters during a scan job.
 */
export interface ScanProgress {
  directoriesVisited: number;
  filesDiscovered: number;
  itemsParsed: number;
  itemsAdded: number;
  itemsUpdated: number;
  currentDirectory?: string;
  bytesProcessed?: number;
}

/**
 * Configurable boundary limits to guard memory and network resources.
 */
export interface ScanLimits {
  /** Maximum folder depth to traverse from root (default: 8) */
  maxDepth?: number;
  /** Maximum number of content items to parse and import (default: 5000) */
  maxItems?: number;
  /** Total job timeout in milliseconds (default: 60,000 ms) */
  timeoutMs?: number;
  /** Maximum concurrent requests (default: 4) */
  concurrency?: number;
  /** Allowed file extensions (default: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.m3u8']) */
  allowedExtensions?: string[];
}

/**
 * Structured scan issue or warning captured during scanning.
 */
export interface ScanError {
  code: string;
  message: string;
  path?: string;
  timestamp: number;
}

/**
 * Scan job entity tracking an active or completed repository scan.
 */
export interface ScanJob {
  readonly id: string;
  readonly sourceId: string;
  status: ScanJobStatus;
  startedAt?: number;
  completedAt?: number;
  progress: ScanProgress;
  limits: ScanLimits;
  errors: ScanError[];
}

/**
 * Final summarized result returned upon completion of a scan.
 */
export interface ScanResult {
  jobId: string;
  sourceId: string;
  status: ScanJobStatus;
  durationMs: number;
  progress: ScanProgress;
  errors: ScanError[];
}
