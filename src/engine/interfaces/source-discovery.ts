import type { MediaSource, SourceProtocol, SourceType } from '../models/source';

/**
 * Result of probing an endpoint candidate.
 */
export interface DiscoveryProbeResult {
  url: string;
  isReachable: boolean;
  latencyMs: number;
  detectedProtocol?: SourceProtocol;
  detectedType?: SourceType;
  serverHeader?: string;
  contentType?: string;
  error?: string;
}

/**
 * Discovered candidate endpoint for registering as a media source.
 */
export interface DiscoveryCandidate {
  suggestedName: string;
  baseUrl: string;
  protocol: SourceProtocol;
  type: SourceType;
  latencyMs: number;
  details?: Record<string, unknown>;
}

/**
 * Discovery interface for scanning subnets or probing candidate BDIX endpoints.
 */
export interface SourceDiscovery {
  /**
   * Probes a single URL to determine if it is online and detect its server type.
   */
  probe(url: string, timeoutMs?: number): Promise<DiscoveryProbeResult>;

  /**
   * Scans a list of subnets, IPs, or domain candidates to discover active streaming endpoints.
   */
  discover(candidates: string[], signal?: AbortSignal): AsyncIterable<DiscoveryCandidate>;

  /**
   * Converts a valid discovery candidate into an unpersisted MediaSource object.
   */
  toMediaSource(candidate: DiscoveryCandidate, priority?: number): Omit<MediaSource, 'id' | 'createdAt' | 'updatedAt'>;
}
