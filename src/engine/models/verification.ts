/**
 * Lifecycle states of media verification.
 *
 * Mandatory requirement: Content can ONLY be published to the catalog
 * if its verification state is VERIFIED with a confirmed accessible video stream.
 */
export const VerificationState = {
  DISCOVERED: 'DISCOVERED',
  VERIFYING: 'VERIFYING',
  VERIFIED: 'VERIFIED',
  TEMPORARILY_UNAVAILABLE: 'TEMPORARILY_UNAVAILABLE',
  REJECTED: 'REJECTED',
} as const;

export type VerificationState = (typeof VerificationState)[keyof typeof VerificationState];

/**
 * Representation of an independently verified playback source location.
 * Allows multiple BDIX mirrors/sources for the same logical movie or episode.
 */
export interface VerifiedPlaybackSource {
  sourceId: string;
  sourcePath: string;
  url: string;
  verificationState: VerificationState;
  container?: string;
  fileSizeBytes?: number;
  lastVerifiedAt: number;
  consecutiveFailures: number;
  latencyMs?: number;
  httpStatus?: number;
  rejectionReason?: string;
}

/**
 * Detailed verification outcome returned by the verification pipeline.
 */
export interface VerificationResult {
  state: VerificationState;
  playable: boolean;
  fileSizeBytes?: number;
  container?: string;
  latencyMs: number;
  httpStatus?: number;
  rejectionReason?: string;
}
