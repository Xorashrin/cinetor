import { generateContentId, generateEpisodeId, generateScanJobId } from '../id/id-generator';
import type { ArtworkResolver } from '../interfaces/artwork-resolver';
import type { CatalogRepository } from '../interfaces/catalog-repository';
import type { ContentClassifier } from '../interfaces/content-classifier';
import type { DirectoryCrawler } from '../interfaces/directory-crawler';
import type { FilenameParser } from '../interfaces/filename-parser';
import type { RawDirectoryEntry } from '../interfaces/source-adapter';
import type { ScanCoordinator, ScanEvent, ScanSubscriber } from '../interfaces/scan-coordinator';
import type { SourceRegistry } from '../interfaces/source-registry';
import { isSeries, type Episode, type Movie, type Series } from '../models/content';
import {
  CancellationError,
  EngineError,
  EngineErrorCode,
  LimitExceededError,
  TimeoutError,
} from '../models/errors';
import type { ScanJob, ScanLimits } from '../models/scan';
import type { VerificationState, VerifiedPlaybackSource } from '../models/verification';
import { PlayableContentVerifier } from '../verification/playable-content-verifier';

const DEFAULT_LIMITS: Required<ScanLimits> = {
  maxDepth: 8,
  maxItems: 5000,
  timeoutMs: 60000,
  concurrency: 4,
  allowedExtensions: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.ts', '.m3u8'],
};

/**
 * Production implementation of ScanCoordinator.
 * Orchestrates crawling, parsing, classification, artwork resolution,
 * mandatory playable verification, and catalog persistence.
 */
export class ScanCoordinatorImpl implements ScanCoordinator {
  private readonly sourceRegistry: SourceRegistry;
  private readonly crawler: DirectoryCrawler;
  private readonly parser: FilenameParser;
  private readonly classifier: ContentClassifier;
  private readonly artworkResolver: ArtworkResolver;
  private readonly repository: CatalogRepository;
  private readonly verifier: PlayableContentVerifier;

  private readonly jobs = new Map<string, ScanJob>();
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly subscribers = new Map<string, Set<ScanSubscriber>>();

  constructor(
    sourceRegistry: SourceRegistry,
    crawler: DirectoryCrawler,
    parser: FilenameParser,
    classifier: ContentClassifier,
    artworkResolver: ArtworkResolver,
    repository: CatalogRepository,
    verifier: PlayableContentVerifier = new PlayableContentVerifier(),
  ) {
    this.sourceRegistry = sourceRegistry;
    this.crawler = crawler;
    this.parser = parser;
    this.classifier = classifier;
    this.artworkResolver = artworkResolver;
    this.repository = repository;
    this.verifier = verifier;
  }

  public async startScan(sourceId: string, limits?: ScanLimits): Promise<ScanJob> {
    const source = await this.sourceRegistry.getSource(sourceId);
    if (!source) {
      throw new EngineError(`Source not found: ${sourceId}`, EngineErrorCode.SOURCE_NOT_FOUND);
    }

    const jobId = generateScanJobId(sourceId);
    const effectiveLimits: ScanLimits = {
      ...DEFAULT_LIMITS,
      ...limits,
    };

    const job: ScanJob = {
      id: jobId,
      sourceId,
      status: 'pending',
      startedAt: Date.now(),
      progress: {
        directoriesVisited: 0,
        filesDiscovered: 0,
        itemsParsed: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
      },
      limits: effectiveLimits,
      errors: [],
    };

    this.jobs.set(jobId, job);
    const abortController = new AbortController();
    this.abortControllers.set(jobId, abortController);

    // Run scanning pipeline asynchronously
    this.executeScan(job, effectiveLimits, abortController.signal).catch(() => undefined);

    return { ...job };
  }

  public async cancelScan(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    const controller = this.abortControllers.get(jobId);

    if (!job || !controller || (job.status !== 'running' && job.status !== 'pending')) {
      return false;
    }

    controller.abort(new CancellationError('Scan manually cancelled by user'));
    job.status = 'cancelled';
    job.completedAt = Date.now();
    job.errors.push({
      code: EngineErrorCode.CANCELLED,
      message: 'Scan manually cancelled by user',
      timestamp: Date.now(),
    });

    this.notify(jobId, 'cancelled');
    this.cleanup(jobId);
    return true;
  }

  public getJob(jobId: string): ScanJob | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  public getActiveJobs(): ScanJob[] {
    return Array.from(this.jobs.values())
      .filter((j) => j.status === 'running' || j.status === 'pending')
      .map((j) => ({ ...j }));
  }

  public subscribe(jobId: string, listener: ScanSubscriber): () => void {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, new Set());
    }
    const set = this.subscribers.get(jobId)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.subscribers.delete(jobId);
      }
    };
  }

  private async executeScan(job: ScanJob, limits: ScanLimits, signal: AbortSignal): Promise<void> {
    const source = await this.sourceRegistry.getSource(job.sourceId);
    if (!source) return;

    job.status = 'running';
    this.notify(job.id, 'started');

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (limits.timeoutMs && limits.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        const controller = this.abortControllers.get(job.id);
        if (controller) {
          controller.abort(new TimeoutError(`Scan timed out after ${limits.timeoutMs}ms`));
        }
      }, limits.timeoutMs);
    }

    // Buffer to hold sibling entries for sidecar artwork resolution
    const directorySiblings = new Map<string, RawDirectoryEntry[]>();

    try {
      const crawlStream = this.crawler.crawl(
        source,
        '',
        {
          maxDepth: limits.maxDepth,
          maxFiles: limits.maxItems,
          allowedExtensions: limits.allowedExtensions,
        },
        signal,
      );

      for await (const event of crawlStream) {
        if (signal.aborted) {
          throw signal.reason || new CancellationError();
        }

        if (event.type === 'directory') {
          job.progress.directoriesVisited++;
          job.progress.currentDirectory = event.path;
          this.notify(job.id, 'progress');
        } else if (event.type === 'file' && event.entry) {
          job.progress.filesDiscovered++;

          // Track sibling entries per directory
          const dirKey = event.path.split('/').slice(0, -1).join('/') || '.';
          const siblings = directorySiblings.get(dirKey) ?? [];
          siblings.push(event.entry);
          directorySiblings.set(dirKey, siblings);

          // Check maxItems limit
          if (limits.maxItems && job.progress.itemsParsed >= limits.maxItems) {
            throw new LimitExceededError(`Exceeded maxItems limit of ${limits.maxItems}`);
          }

          // Check if file is a video
          const ext = event.entry.name.slice(event.entry.name.lastIndexOf('.')).toLowerCase();
          const isVideo = (limits.allowedExtensions ?? DEFAULT_LIMITS.allowedExtensions).includes(ext);

          if (isVideo) {
            await this.ingestFile(job, source.id, event.entry, siblings, signal);
            job.progress.itemsParsed++;
            this.notify(job.id, 'item_added');
          }
        } else if (event.type === 'error' && event.error) {
          job.errors.push({
            code: EngineErrorCode.PARSE_ERROR,
            message: event.error.message,
            path: event.path,
            timestamp: Date.now(),
          });
          this.notify(job.id, 'error');
        }
      }

      job.status = 'completed';
      job.completedAt = Date.now();
      this.notify(job.id, 'completed');
    } catch (err: unknown) {
      const isCancelled =
        signal.aborted ||
        (err instanceof EngineError && err.code === EngineErrorCode.CANCELLED) ||
        (err instanceof Error && err.name === 'AbortError');

      if (isCancelled) {
        job.status = 'cancelled';
        this.notify(job.id, 'cancelled');
      } else {
        job.status = 'failed';
        job.errors.push({
          code: err instanceof EngineError ? err.code : EngineErrorCode.UNKNOWN,
          message: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
        this.notify(job.id, 'failed');
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      job.completedAt = Date.now();
      this.cleanup(job.id);
    }
  }

  private async ingestFile(
    job: ScanJob,
    sourceId: string,
    entry: RawDirectoryEntry,
    siblings: RawDirectoryEntry[],
    signal: AbortSignal,
  ): Promise<void> {
    const filePath = entry.path;
    const fileUrl = entry.url;
    const segments = filePath.split('/').filter(Boolean);
    const filename = segments[segments.length - 1];
    const parent = segments.length > 1 ? segments[segments.length - 2] : undefined;

    const parsed = this.parser.parse(filename, parent, { sizeBytes: entry.sizeBytes, lastModified: entry.lastModified });
    const classification = this.classifier.classify(parsed, segments.slice(0, -1));

    // Mandatory Content Verification Check
    const verifyResult = await this.verifier.verifyMediaSource(fileUrl, {}, signal);

    const contentId = generateContentId(classification.kind, parsed.title, parsed.year);
    const now = Date.now();

    const playbackSource: VerifiedPlaybackSource = {
      sourceId,
      sourcePath: filePath,
      url: fileUrl,
      verificationState: verifyResult.state,
      container: verifyResult.container || parsed.container,
      fileSizeBytes: verifyResult.fileSizeBytes ?? parsed.fileSizeBytes,
      lastVerifiedAt: now,
      consecutiveFailures: verifyResult.state === 'VERIFIED' ? 0 : 1,
      latencyMs: verifyResult.latencyMs,
      httpStatus: verifyResult.httpStatus,
      rejectionReason: verifyResult.rejectionReason,
    };

    if (classification.kind === 'movie') {
      const existing = await this.repository.getMovie(contentId);
      const isNew = !existing;

      const movie: Movie = {
        id: contentId,
        sourceId,
        sourcePath: filePath,
        name: parsed.title,
        kind: 'movie',
        year: parsed.year,
        maturity: classification.maturity,
        genres: classification.genres,
        moods: classification.moods,
        artwork: existing?.artwork ?? { source: 'none' },
        quality: parsed.quality,
        badge: classification.badge,
        runtime: 110,
        videoUrl: verifyResult.state === 'VERIFIED' ? fileUrl : existing?.videoUrl || '',
        sources: [playbackSource],
        container: parsed.container,
        videoCodec: parsed.videoCodec,
        audioCodec: parsed.audioCodec,
        language: parsed.languages?.[0],
        verificationState: verifyResult.state,
        discoveredAt: existing ? existing.discoveredAt : now,
        updatedAt: now,
      };

      if (!existing || existing.artwork.source === 'none') {
        movie.artwork = await this.artworkResolver.resolveArtwork(movie, siblings, signal);
      }

      await this.repository.saveItem(movie);

      if (isNew) {
        job.progress.itemsAdded++;
      } else {
        job.progress.itemsUpdated++;
      }
    } else {
      // Series & Episodic Handling
      const existing = await this.repository.getSeries(contentId);
      const isNew = !existing;

      const seasonNum = parsed.seasonNumber ?? 1;
      const episodeNum = parsed.episodeNumber ?? 1;
      const episodeId = generateEpisodeId(contentId, seasonNum, episodeNum);

      const episode: Episode = {
        id: episodeId,
        seriesId: contentId,
        seasonNumber: seasonNum,
        episodeNumber: episodeNum,
        name: parsed.episodeTitle || `Episode ${episodeNum}`,
        runtime: 45,
        videoUrl: verifyResult.state === 'VERIFIED' ? fileUrl : '',
        sources: [playbackSource],
        sourcePath: filePath,
        container: parsed.container,
        videoCodec: parsed.videoCodec,
        audioCodec: parsed.audioCodec,
        quality: parsed.quality,
        verificationState: verifyResult.state,
      };

      const series: Series = existing ?? {
        id: contentId,
        sourceId,
        sourcePath: segments.slice(0, -1).join('/') || filePath,
        name: parsed.title,
        kind: 'series',
        year: parsed.year,
        maturity: classification.maturity,
        genres: classification.genres,
        moods: classification.moods,
        artwork: { source: 'none' },
        quality: parsed.quality,
        badge: classification.badge,
        verificationState: verifyResult.state,
        seasons: [],
        totalEpisodes: 0,
        totalSeasons: 0,
        discoveredAt: now,
        updatedAt: now,
      };

      let season = series.seasons.find((s) => s.seasonNumber === seasonNum);
      if (!season) {
        season = { seasonNumber: seasonNum, episodes: [] };
        series.seasons.push(season);
        series.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
      }

      const existingEpIndex = season.episodes.findIndex((e) => e.episodeNumber === episodeNum);
      if (existingEpIndex >= 0) {
        season.episodes[existingEpIndex] = episode;
      } else {
        season.episodes.push(episode);
        season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      }

      series.totalSeasons = series.seasons.length;
      series.totalEpisodes = series.seasons.reduce((acc, s) => acc + s.episodes.length, 0);
      series.updatedAt = now;

      // Series is verified if at least one episode is verified
      const hasVerifiedEpisode = series.seasons.some((s) => s.episodes.some((e) => e.verificationState === 'VERIFIED'));
      series.verificationState = hasVerifiedEpisode ? 'VERIFIED' : verifyResult.state;

      if (!existing || series.artwork.source === 'none') {
        series.artwork = await this.artworkResolver.resolveArtwork(series, siblings, signal);
      }

      await this.repository.saveItem(series);

      if (isNew) {
        job.progress.itemsAdded++;
      } else {
        job.progress.itemsUpdated++;
      }
    }
  }

  private notify(jobId: string, type: ScanEvent['type']): void {
    const job = this.jobs.get(jobId);
    const listeners = this.subscribers.get(jobId);
    if (!job || !listeners || listeners.size === 0) return;

    const event: ScanEvent = {
      jobId,
      type,
      job: { ...job },
      timestamp: Date.now(),
    };

    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Guard against subscriber errors
      }
    });
  }

  private cleanup(jobId: string): void {
    this.abortControllers.delete(jobId);
  }
}
