/**
 * Supported network transport protocols.
 */
export type SourceProtocol = 'http' | 'https' | 'ftp' | 'ftps';

/**
 * Structural type of media source.
 */
export type SourceType = 'directory-listing' | 'json-api' | 'm3u-playlist';

/**
 * Health check status of a media source.
 */
export type SourceStatus = 'online' | 'offline' | 'degraded' | 'unknown';

/**
 * Health check details for a media source.
 */
export interface SourceHealth {
  status: SourceStatus;
  latencyMs?: number;
  lastCheckedAt?: number;
  error?: string;
}

/**
 * Representation of a remote media source or repository endpoint.
 */
export interface MediaSource {
  readonly id: string;
  name: string;
  baseUrl: string;
  protocol: SourceProtocol;
  type: SourceType;
  enabled: boolean;
  priority: number;
  headers?: Record<string, string>;
  auth?: {
    username?: string;
    password?: string;
    token?: string;
  };
  health?: SourceHealth;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
