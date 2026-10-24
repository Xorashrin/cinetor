import { EngineError, type ErrorCode } from '../../engine/model';

export class BdixError extends EngineError {
  constructor(code: ErrorCode, public readonly reason: string = code) {
    super(code);
    this.name = 'BdixError';
  }
}

export interface BdixContentRef {
  namespace: 'tmdb';
  mediaType: 'movie' | 'tv';
  externalId: number;
  season?: number;
  episode?: number;
}

/** Persist these only after a per-endpoint consent action. There is no bundled allowlist. */
export interface BdixEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  allowPlainFtp: boolean;
  allowCleartextHttp?: boolean;
  network: 'wifi';
  /** Explicit permission to use the public anonymous FTP account; never assumed. */
  anonymous?: boolean;
  /** Reserved for a future secret-store adapter. Authentication is currently unsupported. */
  credentialRef?: string;
  mappings: ReadonlyArray<{ contentKey: string; path: string }>;
}

export const BDIX_LIMITS = Object.freeze({
  endpoints: 16,
  mappings: 1000,
  depth: 4,
  pages: 32,
  items: 1000,
  pageBytes: 512 * 1024,
  totalBytes: 4 * 1024 * 1024,
  concurrency: 4,
  connectMs: 1500,
  batchMs: 30000,
  fileBytes: 2 * 1024 * 1024 * 1024,
});

const controls = /[\u0000-\u001f\u007f-\u009f]/;
const protocols = new Set(['http:', 'https:', 'ftp:', 'ftps:']);
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

export function contentKey(ref: BdixContentRef): string {
  if (!ref || ref.namespace !== 'tmdb' || !positive(ref.externalId)) throw new BdixError('configuration', 'canonical-content-required');
  if (ref.mediaType === 'movie' && ref.season === undefined && ref.episode === undefined) return `tmdb:movie:${ref.externalId}`;
  if (ref.mediaType === 'tv' && Number.isSafeInteger(ref.season) && (ref.season ?? -1) >= 0 && positive(ref.episode))
    return `tmdb:tv:${ref.externalId}:s${ref.season}e${ref.episode}`;
  throw new BdixError('configuration', 'exact-episode-required');
}

export function validateContentKey(key: string): string {
  if (typeof key !== 'string') throw new BdixError('configuration', 'canonical-content-required');
  const movie = /^tmdb:movie:([1-9]\d*)$/.exec(key);
  if (movie) return contentKey({ namespace: 'tmdb', mediaType: 'movie', externalId: Number(movie[1]) });
  const episode = /^tmdb:tv:([1-9]\d*):s(0|[1-9]\d*)e([1-9]\d*)$/.exec(key);
  if (episode) return contentKey({ namespace: 'tmdb', mediaType: 'tv', externalId: Number(episode[1]), season: Number(episode[2]), episode: Number(episode[3]) });
  throw new BdixError('configuration', 'canonical-content-required');
}

/** Do not normalize Unicode: canonically equivalent spellings can be different server files. */
function inspectPath(value: string): void {
  if (typeof value !== 'string' || !value || value.length > 4096 || controls.test(value) || value.includes('\\') || value !== value.trim())
    throw new BdixError('scope', 'invalid-path');
  for (const point of value) if (point.codePointAt(0)! >= 0xd800 && point.codePointAt(0)! <= 0xdfff) throw new BdixError('scope', 'invalid-encoding');
  const authority = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:)?\/\/([^/?#]*)/.exec(value)?.[1];
  if (authority?.includes('%')) throw new BdixError('scope', 'ambiguous-host');
  for (const part of value.split(/[/?#]/)) {
    let decoded: string;
    try { decoded = decodeURIComponent(part); } catch { throw new BdixError('scope', 'invalid-encoding'); }
    if (controls.test(decoded) || /[\\/%]/.test(decoded) || (part.includes('%') && (decoded === '.' || decoded === '..')))
      throw new BdixError('scope', 'encoded-path-escape');
  }
}

function canonicalUrl(input: string, base?: string): URL {
  inspectPath(input);
  let result: URL;
  try { result = new URL(input, base); } catch { throw new BdixError('scope', 'invalid-url'); }
  if (!protocols.has(result.protocol) || result.username || result.password || !result.hostname || result.hash || result.port === '0')
    throw new BdixError('scope', 'unapproved-url');
  result.hostname = result.hostname.toLowerCase();
  if (['ftp:', 'ftps:'].includes(result.protocol) && result.port === '21') result.port = '';
  // Re-encode once to collapse escaped ASCII and hex case, not distinct Unicode names.
  result.pathname = result.pathname.split('/').map(segment => {
    const decoded = decodeURIComponent(segment);
    if (controls.test(decoded) || /[\\/%?#]/.test(decoded) || decoded === '.' || decoded === '..')
      throw new BdixError('scope', 'invalid-path');
    return encodeURIComponent(decoded).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  }).join('/');
  if (result.pathname.includes('//')) throw new BdixError('scope', 'ambiguous-path');
  return result;
}

function authority(url: URL): string {
  // WHATWG gives ftps: an opaque origin, so comparing URL.origin would be unsafe.
  const port = url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '21');
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}`;
}

export function endpointRoot(input: string): string {
  const result = canonicalUrl(input);
  if (result.search || !result.pathname.endsWith('/')) throw new BdixError('configuration', 'directory-root-required');
  return result.toString();
}

/** Only explicit pagination links may retain a small, noncredential query. */
export function containedUrl(root: string, input: string, base = root, pagination = false): string {
  const approved = canonicalUrl(root);
  const parent = canonicalUrl(base);
  const result = canonicalUrl(input, parent.toString());
  if (!approved.pathname.endsWith('/') || approved.search) throw new BdixError('scope', 'directory-root-required');
  if (authority(parent) !== authority(approved) || !parent.pathname.startsWith(approved.pathname) ||
      authority(result) !== authority(approved) || !result.pathname.startsWith(approved.pathname))
    throw new BdixError('scope', 'endpoint-escape');
  if (result.search) {
    if (!pagination || !['http:', 'https:'].includes(result.protocol) || result.search.length > 512)
      throw new BdixError('scope', 'query-not-approved');
    const keys = [...result.searchParams.keys()];
    if (keys.length > 3 || new Set(keys).size !== keys.length || keys.some(k => !['page', 'offset', 'cursor'].includes(k)))
      throw new BdixError('scope', 'query-not-approved');
    result.searchParams.sort();
  }
  return result.toString();
}

export function mediaContainer(url: string): 'mp4' | 'mkv' | 'webm' | undefined {
  const path = new URL(url).pathname.toLowerCase();
  if (/\.(mp4|m4v|mov)$/.test(path)) return 'mp4';
  if (path.endsWith('.mkv')) return 'mkv';
  if (path.endsWith('.webm')) return 'webm';
  // A remote HLS/DASH manifest cannot be safely relayed as one progressive file.
  return undefined;
}

export function pathName(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? '');
}

export function normalizeEndpoints(input: ReadonlyArray<BdixEndpoint>): BdixEndpoint[] {
  if (!Array.isArray(input) || input.length > BDIX_LIMITS.endpoints) throw new BdixError('configuration', 'endpoint-limit');
  const ids = new Set<string>();
  return input.map(row => {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) || ids.has(row.id) ||
        typeof row.name !== 'string' || !row.name.trim() || row.name.length > 100 || controls.test(row.name) ||
        row.network !== 'wifi' || typeof row.enabled !== 'boolean' || typeof row.allowPlainFtp !== 'boolean' ||
        (row.anonymous !== undefined && typeof row.anonymous !== 'boolean') ||
        (row.allowCleartextHttp !== undefined && typeof row.allowCleartextHttp !== 'boolean') || !Array.isArray(row.mappings) || row.mappings.length > BDIX_LIMITS.mappings)
      throw new BdixError('configuration', 'invalid-endpoint');
    if (row.credentialRef !== undefined) throw new BdixError('unsupported', 'authentication-unsupported');
    const url = endpointRoot(row.url);
    const protocol = new URL(url).protocol;
    if (row.enabled && protocol === 'ftp:' && !row.allowPlainFtp) throw new BdixError('permission', 'plain-ftp-consent-required');
    if (row.enabled && protocol === 'http:' && row.allowCleartextHttp !== true) throw new BdixError('permission', 'cleartext-http-consent-required');
    if (row.enabled && ['ftp:', 'ftps:'].includes(protocol) && row.anonymous !== true)
      throw new BdixError('authentication', 'anonymous-consent-required');
    ids.add(row.id);
    const keys = new Map<string, string>(), paths = new Map<string, string>();
    const mappings: Array<{ contentKey: string; path: string }> = [];
    for (const mapping of row.mappings) {
      if (!mapping) throw new BdixError('configuration', 'invalid-mapping');
      const key = validateContentKey(mapping.contentKey);
      const path = containedUrl(url, mapping.path);
      if (!mediaContainer(path)) throw new BdixError('unsupported', 'progressive-media-required');
      if ((keys.has(key) && keys.get(key) !== path) || (paths.has(path) && paths.get(path) !== key))
        throw new BdixError('configuration', 'ambiguous-mapping');
      if (!keys.has(key)) mappings.push({ contentKey: key, path });
      keys.set(key, path); paths.set(path, key);
    }
    return Object.freeze({ id: row.id, name: row.name.trim(), url, enabled: row.enabled, allowPlainFtp: row.allowPlainFtp,
      network: 'wifi' as const, anonymous: row.anonymous === true, allowCleartextHttp: row.allowCleartextHttp === true, mappings: Object.freeze(mappings.map(m => Object.freeze(m))) });
  });
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new BdixError('cancelled');
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (const value of text) {
    const point = value.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
