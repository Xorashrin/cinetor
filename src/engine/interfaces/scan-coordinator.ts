import type { ScanJob, ScanLimits } from '../models/scan';

/**
 * Event types emitted by the scan coordinator.
 */
export type ScanEventType = 'started' | 'progress' | 'item_added' | 'error' | 'completed' | 'cancelled' | 'failed';

/**
 * Event payload dispatched during scanning.
 */
export interface ScanEvent {
  jobId: string;
  type: ScanEventType;
  job: ScanJob;
  timestamp: number;
}

/**
 * Callback listener for scan job updates.
 */
export type ScanSubscriber = (event: ScanEvent) => void;

/**
 * High-level coordinator interface orchestrating scanning, parsing, cancellation,
 * and persistence across registered media sources.
 */
export interface ScanCoordinator {
  /**
   * Starts a new scan job for the given media source ID.
   *
   * @param sourceId The ID of the media source to scan
   * @param limits Optional limits overriding default scan boundaries
   */
  startScan(sourceId: string, limits?: ScanLimits): Promise<ScanJob>;

  /**
   * Requests immediate cancellation of an ongoing scan job.
   *
   * @param jobId The scan job ID
   */
  cancelScan(jobId: string): Promise<boolean>;

  /**
   * Retrieves a scan job by ID.
   */
  getJob(jobId: string): ScanJob | null;

  /**
   * Returns all active running or pending scan jobs.
   */
  getActiveJobs(): ScanJob[];

  /**
   * Subscribes to real-time events for a specific scan job.
   * Returns an unsubscribe function.
   */
  subscribe(jobId: string, listener: ScanSubscriber): () => void;
}
