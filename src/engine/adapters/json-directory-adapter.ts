import type { RawDirectoryEntry, SourceAdapter } from '../interfaces/source-adapter';
import { EngineError, EngineErrorCode, NetworkError, ParseError } from '../models/errors';
import type { MediaSource, SourceProtocol, SourceType } from '../models/source';
import { maskUrl, sanitizePath, validateUrl } from '../security/url-validator';
import { withTimeout } from '../utils/concurrency';

interface RawJsonItem {
  name?: string;
  filename?: string;
  title?: string;
  path?: string;
  url?: string;
  type?: 'file' | 'directory' | 'folder' | 'dir';
  is_dir?: boolean;
  isDir?: boolean;
  size?: number;
  sizeBytes?: number;
  modified?: number | string;
}

/**
 * Adapter for JSON-based directory APIs and structured indexes.
 */
export class JsonDirectoryAdapter implements SourceAdapter {
  public readonly protocol: SourceProtocol = 'http';
  public readonly supportedTypes: SourceType[] = ['json-api'];

  public canHandle(source: MediaSource): boolean {
    return source.type === 'json-api';
  }

  public async listDirectory(
    source: MediaSource,
    relativePath: string = '',
    signal?: AbortSignal,
  ): Promise<RawDirectoryEntry[]> {
    const cleanPath = sanitizePath(relativePath);
    const baseParsed = validateUrl(source.baseUrl);

    const targetUrl = new URL(baseParsed.toString());
    if (cleanPath) {
      targetUrl.searchParams.set('path', cleanPath);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...source.headers,
    };

    if (source.auth?.token) {
      headers['Authorization'] = `Bearer ${source.auth.token}`;
    }

    let data: unknown;
    try {
      const response = await withTimeout(
        fetch(targetUrl.toString(), {
          method: 'GET',
          headers,
          signal,
        }),
        12000,
        `JSON API request timed out: ${maskUrl(targetUrl.toString())}`,
      );

      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status} from API ${maskUrl(targetUrl.toString())}`, {
          status: response.status,
        });
      }

      data = await response.json();
    } catch (err: unknown) {
      if (err instanceof EngineError) throw err;
      if (signal?.aborted) throw signal.reason;
      throw new ParseError(`Failed to fetch JSON directory: ${err instanceof Error ? err.message : String(err)}`);
    }

    const items: RawJsonItem[] = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).items)
        ? ((data as Record<string, unknown>).items as RawJsonItem[])
        : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).files)
          ? ((data as Record<string, unknown>).files as RawJsonItem[])
          : [];

    return this.normalizeJsonItems(items, baseParsed, cleanPath);
  }

  public normalizeJsonItems(items: RawJsonItem[], baseUrl: URL, relativeDirPath: string): RawDirectoryEntry[] {
    const entries: RawDirectoryEntry[] = [];

    for (const item of items) {
      const rawName = item.name || item.filename || item.title;
      if (!rawName) continue;
      const name = String(rawName).trim();
      if (!name || name === '.' || name === '..') continue;

      const isDir = Boolean(item.is_dir || item.isDir || item.type === 'directory' || item.type === 'folder' || item.type === 'dir');
      const itemPath = item.path ? sanitizePath(item.path) : relativeDirPath ? `${relativeDirPath}/${name}` : name;
      const itemUrl = item.url
        ? validateUrl(item.url).toString()
        : new URL(itemPath, baseUrl.toString().endsWith('/') ? baseUrl.toString() : `${baseUrl.toString()}/`).toString();

      entries.push({
        name,
        path: isDir && !itemPath.endsWith('/') ? `${itemPath}/` : itemPath,
        url: itemUrl,
        type: isDir ? 'directory' : 'file',
        sizeBytes: typeof item.size === 'number' ? item.size : typeof item.sizeBytes === 'number' ? item.sizeBytes : undefined,
      });
    }

    return entries;
  }
}
