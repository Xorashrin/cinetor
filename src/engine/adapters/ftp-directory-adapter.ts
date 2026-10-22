import type { RawDirectoryEntry, SourceAdapter } from '../interfaces/source-adapter';
import { EngineError, EngineErrorCode, NetworkError } from '../models/errors';
import type { MediaSource, SourceProtocol, SourceType } from '../models/source';
import { maskUrl, sanitizePath, validateUrl } from '../security/url-validator';

// UNIX ls -l pattern: drwxr-xr-x  2 user group 4096 May 12 14:30 filename
const UNIX_LISTING_REGEX = /^([drwx-]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+[\d:]{4,5})\s+(.+)$/;
// Windows style pattern: 05-12-24  02:30PM  <DIR>  filename  OR  05-12-24 02:30PM  1428572 filename
const WINDOWS_LISTING_REGEX = /^(\d{2}-\d{2}-\d{2,4}\s+\d{1,2}:\d{2}(?:AM|PM))\s+(<DIR>|\d+)\s+(.+)$/i;

/**
 * Adapter for configured FTP and FTPS media sources.
 *
 * Implements standard FTP listing parsers and source isolation. In standard React Native
 * JavaScript runtimes without raw TCP socket modules, supports routing through a configured
 * HTTP bridge/gateway (e.g., source.metadata?.gatewayUrl) or provides clean error isolation.
 */
export class FtpDirectoryAdapter implements SourceAdapter {
  public readonly protocol: SourceProtocol = 'ftp';
  public readonly supportedTypes: SourceType[] = ['directory-listing'];

  public canHandle(source: MediaSource): boolean {
    return source.protocol === 'ftp' || source.protocol === 'ftps';
  }

  public async listDirectory(
    source: MediaSource,
    relativePath: string = '',
    signal?: AbortSignal,
  ): Promise<RawDirectoryEntry[]> {
    const cleanPath = sanitizePath(relativePath);
    validateUrl(source.baseUrl, { allowedProtocols: ['ftp', 'ftps'] });

    // If an HTTP-to-FTP gateway / proxy is configured
    const gatewayUrl = source.metadata?.gatewayUrl as string | undefined;
    if (gatewayUrl) {
      return this.fetchViaGateway(gatewayUrl, source, cleanPath, signal);
    }

    // In a pure JS runtime without an active native TCP socket module or gateway:
    // Fail cleanly with a structured EngineError rather than hanging or crashing.
    throw new EngineError(
      `Direct FTP socket streaming for ${maskUrl(source.baseUrl)} requires a configured HTTP gateway or native transport plugin in this runtime environment.`,
      EngineErrorCode.UNSUPPORTED_PROTOCOL,
      { sourceId: source.id, baseUrl: maskUrl(source.baseUrl) },
    );
  }

  private async fetchViaGateway(
    gatewayUrl: string,
    source: MediaSource,
    cleanPath: string,
    signal?: AbortSignal,
  ): Promise<RawDirectoryEntry[]> {
    const target = new URL(gatewayUrl);
    target.searchParams.set('target', source.baseUrl);
    if (cleanPath) target.searchParams.set('path', cleanPath);

    const res = await fetch(target.toString(), { signal, headers: source.headers });
    if (!res.ok) {
      throw new NetworkError(`FTP Gateway returned HTTP ${res.status} for ${maskUrl(source.baseUrl)}`);
    }

    const text = await res.text();
    return this.parseFtpListing(text, source.baseUrl, cleanPath);
  }

  /**
   * Parses standard UNIX and Windows FTP directory listing outputs.
   */
  public parseFtpListing(rawText: string, baseUrlStr: string, relativeDirPath: string): RawDirectoryEntry[] {
    const entries: RawDirectoryEntry[] = [];
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    for (const line of lines) {
      let isDir = false;
      let name = '';
      let sizeBytes: number | undefined;

      const unixMatch = line.match(UNIX_LISTING_REGEX);
      if (unixMatch) {
        const perms = unixMatch[1];
        sizeBytes = parseInt(unixMatch[2], 10);
        name = unixMatch[4].trim();
        isDir = perms.startsWith('d');
      } else {
        const winMatch = line.match(WINDOWS_LISTING_REGEX);
        if (winMatch) {
          const typeOrSize = winMatch[2];
          name = winMatch[3].trim();
          isDir = typeOrSize.toUpperCase() === '<DIR>';
          if (!isDir) {
            sizeBytes = parseInt(typeOrSize, 10);
          }
        }
      }

      if (!name || name === '.' || name === '..') {
        continue;
      }

      const itemPath = relativeDirPath ? `${relativeDirPath}/${name}` : name;
      const baseClean = baseUrlStr.replace(/\/+$/, '');
      const itemUrl = `${baseClean}/${itemPath}`;

      entries.push({
        name,
        path: isDir ? `${itemPath}/` : itemPath,
        url: itemUrl,
        type: isDir ? 'directory' : 'file',
        sizeBytes: isNaN(sizeBytes ?? NaN) ? undefined : sizeBytes,
      });
    }

    return entries;
  }
}
