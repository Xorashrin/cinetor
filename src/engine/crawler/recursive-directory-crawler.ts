import { FtpDirectoryAdapter } from '../adapters/ftp-directory-adapter';
import { HttpDirectoryAdapter } from '../adapters/http-directory-adapter';
import { JsonDirectoryAdapter } from '../adapters/json-directory-adapter';
import type { CrawlEvent, CrawlOptions, DirectoryCrawler } from '../interfaces/directory-crawler';
import type { RawDirectoryEntry, SourceAdapter } from '../interfaces/source-adapter';
import type { MediaSource } from '../models/source';
import { sanitizePath } from '../security/url-validator';
import { Semaphore } from '../utils/concurrency';

const defaultAdapterResolver = (source: MediaSource): SourceAdapter => {
  if (source.protocol === 'ftp' || source.protocol === 'ftps') {
    return new FtpDirectoryAdapter();
  }
  if (source.type === 'json_api') {
    return new JsonDirectoryAdapter();
  }
  return new HttpDirectoryAdapter();
};

const DEFAULT_VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.ts',
  '.m4v',
  '.flv',
  '.wmv',
];

const DEFAULT_SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.sub'];
const DEFAULT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const DEFAULT_EXCLUDE_FOLDERS = [
  '@eadir',
  '.trash',
  '.ds_store',
  'lost+found',
  '$recycle.bin',
  'system volume information',
];

interface QueueItem {
  path: string;
  depth: number;
}

/**
 * Robust recursive directory crawler with loop detection, depth boundaries,
 * bounded concurrency, and fault isolation.
 */
export class RecursiveDirectoryCrawler implements DirectoryCrawler {
  private readonly adapterResolver: (source: MediaSource) => SourceAdapter;
  private readonly semaphore: Semaphore;

  constructor(
    adapterResolver: (source: MediaSource) => SourceAdapter = defaultAdapterResolver,
    concurrency: number = 3,
  ) {
    this.adapterResolver = adapterResolver;
    this.semaphore = new Semaphore(concurrency);
  }

  public async *crawl(
    source: MediaSource,
    startPath: string = '',
    options: CrawlOptions = {},
    signal?: AbortSignal,
  ): AsyncIterable<CrawlEvent> {
    const maxDepth = options.maxDepth ?? 8;
    const maxFiles = options.maxFiles ?? 5000;
    const allowedVideoExts = options.allowedExtensions ?? DEFAULT_VIDEO_EXTENSIONS;
    const excludeFolders = (options.excludeFolders ?? DEFAULT_EXCLUDE_FOLDERS).map((f) => f.toLowerCase());

    const adapter = this.adapterResolver(source);
    const visitedUrls = new Set<string>();
    const queue: QueueItem[] = [{ path: sanitizePath(startPath), depth: 0 }];

    let fileCount = 0;

    while (queue.length > 0) {
      if (signal?.aborted) {
        return;
      }

      if (fileCount >= maxFiles) {
        break;
      }

      const current = queue.shift()!;
      if (current.depth > maxDepth) {
        continue;
      }

      // Check folder exclusion
      const folderName = current.path.split('/').filter(Boolean).pop()?.toLowerCase();
      if (folderName && excludeFolders.includes(folderName)) {
        continue;
      }

      // Fetch directory entries with bounded concurrency & error isolation
      let entries: RawDirectoryEntry[] = [];
      try {
        entries = await this.semaphore.run(
          () => adapter.listDirectory(source, current.path, signal),
          signal,
        );
      } catch (err: unknown) {
        // Skip inaccessible directories without aborting the entire scan
        yield {
          type: 'error',
          depth: current.depth,
          path: current.path,
          error: err instanceof Error ? err : new Error(String(err)),
        };
        continue;
      }

      yield {
        type: 'directory',
        depth: current.depth,
        path: current.path,
      };

      // Collect sibling non-video entries (e.g. sidecar posters/subtitles) and video files
      for (const entry of entries) {
        if (signal?.aborted || fileCount >= maxFiles) {
          break;
        }

        const canonicalUrl = entry.url.toLowerCase().replace(/\/+$/, '');

        if (entry.type === 'directory') {
          // Loop and cycle detection
          if (!visitedUrls.has(canonicalUrl)) {
            visitedUrls.add(canonicalUrl);
            queue.push({
              path: sanitizePath(entry.path),
              depth: current.depth + 1,
            });
          }
        } else {
          // File discovered
          const ext = this.getExtension(entry.name);
          const isVideo = allowedVideoExts.some((v) => v.toLowerCase() === ext);
          const isImage = DEFAULT_IMAGE_EXTENSIONS.includes(ext);
          const isSubtitle = DEFAULT_SUBTITLE_EXTENSIONS.includes(ext);

          if (isVideo || isImage || isSubtitle) {
            if (isVideo) {
              fileCount++;
            }
            yield {
              type: 'file',
              depth: current.depth,
              path: entry.path,
              entry,
            };
          }
        }
      }
    }

    yield {
      type: 'finish',
      depth: 0,
      path: startPath,
    };
  }

  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  }
}
