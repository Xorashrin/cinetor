import { EngineError, EngineErrorCode } from '../models/errors';

/**
 * Security validation options for network requests and directory paths.
 */
export interface UrlValidationOptions {
  allowPrivateIps?: boolean;
  allowedProtocols?: Array<'http' | 'https' | 'ftp' | 'ftps'>;
}

const DEFAULT_OPTIONS: UrlValidationOptions = {
  allowPrivateIps: true, // Set to true by default for BDIX local subnet streaming (e.g. 10.x, 172.16.x)
  allowedProtocols: ['http', 'https', 'ftp', 'ftps'],
};

// Cloud metadata / link-local addresses that must always be forbidden to prevent SSRF
const FORBIDDEN_HOSTS = [
  '169.254.169.254',
  'metadata.google.internal',
  '100.100.100.200',
];

/**
 * Validates a candidate URL for protocol compliance, SSRF protection, and format correctness.
 */
export function validateUrl(rawUrl: string, options: UrlValidationOptions = DEFAULT_OPTIONS): URL {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new EngineError('URL must be a non-empty string', EngineErrorCode.INVALID_ARGUMENT);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new EngineError(`Malformed URL: ${maskUrl(rawUrl)}`, EngineErrorCode.INVALID_ARGUMENT);
  }

  const protocol = parsed.protocol.replace(':', '').toLowerCase() as 'http' | 'https' | 'ftp' | 'ftps';
  const allowed = options.allowedProtocols ?? DEFAULT_OPTIONS.allowedProtocols!;
  if (!allowed.includes(protocol)) {
    throw new EngineError(`Unsupported protocol '${protocol}': ${maskUrl(rawUrl)}`, EngineErrorCode.UNSUPPORTED_PROTOCOL);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Always block cloud metadata endpoints
  if (FORBIDDEN_HOSTS.includes(hostname)) {
    throw new EngineError(`SSRF Block: Access to cloud metadata IP is forbidden`, EngineErrorCode.SECURITY_ERROR);
  }

  // Check if private IP blocking is requested
  if (options.allowPrivateIps === false) {
    if (isPrivateOrLocalhost(hostname)) {
      throw new EngineError(`SSRF Block: Access to private network address is disabled`, EngineErrorCode.SECURITY_ERROR);
    }
  }

  return parsed;
}

/**
 * Validates relative path against directory traversal attempts.
 */
export function sanitizePath(relativePath: string): string {
  if (!relativePath) return '';

  // Decode URI encoding to detect obfuscated traversal like %2e%2e
  let decoded = relativePath;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    // Keep original if decoding fails
  }

  // Reject null bytes and directory traversal patterns
  if (decoded.includes('\0') || decoded.includes('../') || decoded.includes('..\\') || decoded.startsWith('../') || decoded === '..') {
    throw new EngineError(`Path traversal attempt detected in path: ${relativePath}`, EngineErrorCode.SECURITY_ERROR);
  }

  // Normalize slashes and remove redundant segments
  const normalized = decoded
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '');

  return normalized;
}

/**
 * Redacts passwords, tokens, and credentials from URLs for safe logging.
 * Example: http://user:secret@bdix.local/movies -> http://user:***@bdix.local/movies
 */
export function maskUrl(urlStr: string): string {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    if (u.password) {
      u.password = '***';
    }
    return u.toString();
  } catch {
    return urlStr.replace(/:\/\/([^:@]+):([^@]+)@/, '://$1:***@');
  }
}

function isPrivateOrLocalhost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }
  // 10.0.0.0/8
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // 192.168.0.0/16
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  // Carrier-grade NAT 100.64.0.0/10
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;

  return false;
}
