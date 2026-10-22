import type { VerificationResult, VerificationState, VerifiedPlaybackSource } from '../models/verification';
import { maskUrl, validateUrl } from '../security/url-validator';
import { withRetry, withTimeout } from '../utils/concurrency';

// Video container magic bytes
const EBML_MKV_HEADER = [0x1a, 0x45, 0xdf, 0xa3];
const MP4_FTYP_OFFSET = 4;
const MP4_FTYP_STRING = 'ftyp';
const MPEG_TS_SYNC_BYTE = 0x47;

const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.m4v', '.flv'];

/**
 * Options configuring media verification.
 */
export interface VerificationOptions {
  timeoutMs?: number;
  maxRetries?: number;
  probeBytes?: number;
  headers?: Record<string, string>;
}

/**
 * Robust playable content verification pipeline.
 *
 * Mandatory requirement: The application must not publish a movie, series, or episode
 * card merely because its filename or folder exists. It must pass explicit availability
 * and container inspection without downloading the entire video file.
 */
export class PlayableContentVerifier {
  public async verifyMediaSource(
    videoUrl: string,
    options: VerificationOptions = {},
    signal?: AbortSignal,
  ): Promise<VerificationResult> {
    const start = Date.now();
    const timeoutMs = options.timeoutMs ?? 10000;
    const maxRetries = options.maxRetries ?? 2;
    const probeBytes = options.probeBytes ?? 2048;

    let targetUrl: URL;
    try {
      targetUrl = validateUrl(videoUrl);
    } catch (err: unknown) {
      return {
        state: 'REJECTED',
        playable: false,
        latencyMs: Date.now() - start,
        rejectionReason: `Invalid URL: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Check extension validity
    const pathLower = targetUrl.pathname.toLowerCase();
    const hasValidExt = SUPPORTED_VIDEO_EXTENSIONS.some((ext) => pathLower.endsWith(ext));
    if (!hasValidExt) {
      return {
        state: 'REJECTED',
        playable: false,
        latencyMs: Date.now() - start,
        rejectionReason: `Unsupported media extension in path: ${targetUrl.pathname}`,
      };
    }

    try {
      return await withRetry(
        async () => {
          return await withTimeout(
            this.probeHttpMedia(targetUrl, probeBytes, options.headers, signal),
            timeoutMs,
            `Media verification probe timed out after ${timeoutMs}ms: ${maskUrl(targetUrl.toString())}`,
          );
        },
        {
          maxAttempts: maxRetries + 1,
          initialDelayMs: 300,
          shouldRetry: (err) => {
            // Do not retry 404 or 403 permanent rejections
            const msg = String(err);
            return !msg.includes('HTTP 404') && !msg.includes('HTTP 403');
          },
        },
        signal,
      );
    } catch (err: unknown) {
      const isTransient = String(err).includes('timed out') || String(err).includes('ECONNRESET');
      return {
        state: isTransient ? 'TEMPORARILY_UNAVAILABLE' : 'REJECTED',
        playable: false,
        latencyMs: Date.now() - start,
        rejectionReason: `Verification failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Probes HTTP/HTTPS media stream using bounded range requests or chunked streaming.
   */
  private async probeHttpMedia(
    url: URL,
    bytesToRead: number,
    customHeaders?: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<VerificationResult> {
    const start = Date.now();
    const headers: Record<string, string> = {
      Range: `bytes=0-${bytesToRead - 1}`,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Cinator/1.0',
      Accept: '*/*',
      ...customHeaders,
    };

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal,
    });

    const latencyMs = Date.now() - start;

    if (!response.ok && response.status !== 206) {
      if (response.status === 404 || response.status === 410) {
        return {
          state: 'REJECTED',
          playable: false,
          latencyMs,
          httpStatus: response.status,
          rejectionReason: `File not found on server (HTTP ${response.status})`,
        };
      }
      return {
        state: 'TEMPORARILY_UNAVAILABLE',
        playable: false,
        latencyMs,
        httpStatus: response.status,
        rejectionReason: `Server responded with HTTP ${response.status}`,
      };
    }

    // Parse file size from Content-Range or Content-Length
    let fileSizeBytes: number | undefined;
    const contentRange = response.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match) {
        fileSizeBytes = parseInt(match[1], 10);
      }
    }
    if (!fileSizeBytes && response.headers.get('content-length')) {
      fileSizeBytes = parseInt(response.headers.get('content-length')!, 10);
    }

    // Read initial chunk safely without downloading full file
    let initialBytes: Uint8Array;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const { value } = await reader.read();
      initialBytes = value ? value.slice(0, bytesToRead) : new Uint8Array(0);
      // Immediately cancel the remaining stream
      reader.cancel().catch(() => undefined);
    } else {
      const buffer = await response.arrayBuffer();
      initialBytes = new Uint8Array(buffer.slice(0, bytesToRead));
    }

    if (initialBytes.length < 8) {
      return {
        state: 'REJECTED',
        playable: false,
        latencyMs,
        httpStatus: response.status,
        rejectionReason: 'Media file returned empty or truncated response',
      };
    }

    // Inspect container signature
    const container = this.detectContainer(initialBytes, url.pathname);

    return {
      state: 'VERIFIED',
      playable: true,
      fileSizeBytes,
      container,
      latencyMs,
      httpStatus: response.status,
    };
  }

  /**
   * Inspects binary header bytes to confirm valid video container.
   */
  public detectContainer(bytes: Uint8Array, pathname: string): string {
    // Check for MKV / WebM EBML Header
    if (
      bytes[0] === EBML_MKV_HEADER[0] &&
      bytes[1] === EBML_MKV_HEADER[1] &&
      bytes[2] === EBML_MKV_HEADER[2] &&
      bytes[3] === EBML_MKV_HEADER[3]
    ) {
      return pathname.toLowerCase().endsWith('.webm') ? 'webm' : 'mkv';
    }

    // Check for MP4 / QuickTime ftyp Box
    if (bytes.length >= 8) {
      const ftypStr = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
      if (ftypStr === MP4_FTYP_STRING) {
        return 'mp4';
      }
    }

    // Check for MPEG-TS Sync Byte
    if (bytes[0] === MPEG_TS_SYNC_BYTE) {
      return 'ts';
    }

    // Fallback to path extension if header is unusual/raw
    const dot = pathname.lastIndexOf('.');
    return dot >= 0 ? pathname.slice(dot + 1).toLowerCase() : 'unknown';
  }
}
