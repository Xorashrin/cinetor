import type { RawDirectoryEntry, SourceAdapter } from '../interfaces/source-adapter';
import { EngineError, EngineErrorCode, NetworkError, TimeoutError } from '../models/errors';
import type { MediaSource, SourceProtocol, SourceType } from '../models/source';
import { maskUrl, sanitizePath, validateUrl } from '../security/url-validator';
import { withTimeout } from '../utils/concurrency';

// Common anchor tags in autoindex listings
const HREF_REGEX = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;

// Ignored autoindex query sorting links and parent folder navigations
const IGNORED_HREF_REGEX = /^(?:\?|\/|\.\.\/?|\/.*)?$/;
const SORT_QUERY_REGEX = /[?&](?:C=[NMSD];O=[AD]|sort=|order=)/i;

/**
 * Adapter for HTTP and HTTPS open directory listings (Apache, Nginx, Lighttpd autoindex).
 */
export class HttpDirectoryAdapter implements SourceAdapter {
  public readonly protocol: SourceProtocol = 'http';
  public readonly supportedTypes: SourceType[] = ['directory-listing'];

  public canHandle(source: MediaSource): boolean {
    return (source.protocol === 'http' || source.protocol === 'https') && source.type === 'directory-listing';
  }

  public async listDirectory(
    source: MediaSource,
    relativePath: string = '',
    signal?: AbortSignal,
  ): Promise<RawDirectoryEntry[]> {
    const cleanPath = sanitizePath(relativePath);
    const baseParsed = validateUrl(source.baseUrl);

    // Build target directory URL, ensuring single trailing slash for directory resolution
    let targetUrlStr = baseParsed.toString();
    if (!targetUrlStr.endsWith('/')) {
      targetUrlStr += '/';
    }
    if (cleanPath) {
      targetUrlStr += cleanPath.endsWith('/') ? cleanPath : `${cleanPath}/`;
    }

    const targetUrl = validateUrl(targetUrlStr);

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Cinator/1.0',
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      ...source.headers,
    };

    if (source.auth?.username && source.auth?.password) {
      const creds = btoa(`${source.auth.username}:${source.auth.password}`);
      headers['Authorization'] = `Basic ${creds}`;
    } else if (source.auth?.token) {
      headers['Authorization'] = `Bearer ${source.auth.token}`;
    }

    let html: string;
    try {
      const response = await withTimeout(
        fetch(targetUrl.toString(), {
          method: 'GET',
          headers,
          signal,
        }),
        15000,
        `Directory listing request timed out: ${maskUrl(targetUrl.toString())}`,
      );

      if (!response.ok) {
        if (response.status === 404) {
          return [];
        }
        throw new NetworkError(`HTTP ${response.status} ${response.statusText} listing directory: ${maskUrl(targetUrl.toString())}`, {
          status: response.status,
          url: maskUrl(targetUrl.toString()),
        });
      }

      html = await response.text();
    } catch (err: unknown) {
      if (err instanceof EngineError) throw err;
      if (signal?.aborted) throw signal.reason;
      throw new NetworkError(`Failed to fetch directory listing: ${maskUrl(targetUrl.toString())} - ${err instanceof Error ? err.message : String(err)}`);
    }

    return this.parseAutoindexHtml(html, targetUrl, cleanPath);
  }

  public async fetchText(
    source: MediaSource,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const cleanPath = sanitizePath(relativePath);
    const baseParsed = validateUrl(source.baseUrl);
    const targetUrl = new URL(cleanPath, baseParsed.toString().endsWith('/') ? baseParsed.toString() : `${baseParsed.toString()}/`);

    const response = await fetch(targetUrl.toString(), { signal, headers: source.headers });
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status} fetching text from ${maskUrl(targetUrl.toString())}`);
    }
    return response.text();
  }

  /**
   * Parses standard autoindex HTML output into structured RawDirectoryEntry items.
   */
  public parseAutoindexHtml(html: string, directoryUrl: URL, relativeDirPath: string): RawDirectoryEntry[] {
    const entries: RawDirectoryEntry[] = [];
    const seenNames = new Set<string>();

    let match: RegExpExecArray | null;
    HREF_REGEX.lastIndex = 0;

    while ((match = HREF_REGEX.exec(html)) !== null) {
      const href = match[1].trim();
      const rawText = match[2].replace(/<[^>]+>/g, '').trim();

      // Skip invalid, sort, or parent directory links
      if (!href || IGNORED_HREF_REGEX.test(href) || SORT_QUERY_REGEX.test(href)) {
        continue;
      }
      if (href.startsWith('?') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) {
        continue;
      }
      if (rawText.toLowerCase().includes('parent directory') || href === '../' || href === '..') {
        continue;
      }

      // Check if entry is a directory (indicated by trailing slash in href or text)
      const isDir = href.endsWith('/') || rawText.endsWith('/');
      const cleanHref = href.replace(/\/+$/, '');
      const rawName = decodeURIComponent(cleanHref.split('/').pop() || rawText.replace(/\/+$/, ''));
      const name = rawName.trim();

      if (!name || name === '.' || name === '..' || seenNames.has(name)) {
        continue;
      }
      seenNames.add(name);

      // Resolve full absolute URL
      const entryUrl = new URL(href, directoryUrl).toString();
      const entryPath = relativeDirPath ? `${relativeDirPath.replace(/\/+$/, '')}/${name}` : name;

      entries.push({
        name,
        path: isDir ? `${entryPath}/` : entryPath,
        url: entryUrl,
        type: isDir ? 'directory' : 'file',
      });
    }

    return entries;
  }
}
