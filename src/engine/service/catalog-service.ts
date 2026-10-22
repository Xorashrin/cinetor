import AsyncStorage from '@react-native-async-storage/async-storage';
import { InMemorySourceRegistry } from '../adapters/in-memory-source-registry';
import { ArtworkResolverImpl } from '../artwork/artwork-resolver-impl';
import { RuleBasedContentClassifier } from '../classifier/rule-based-content-classifier';
import { ScanCoordinatorImpl } from '../coordinator/scan-coordinator-impl';
import { RecursiveDirectoryCrawler } from '../crawler/recursive-directory-crawler';
import type { CatalogRepository } from '../interfaces/catalog-repository';
import type { ScanCoordinator } from '../interfaces/scan-coordinator';
import type { SourceRegistry } from '../interfaces/source-registry';
import { isMovie, isSeries, type ContentItem, type Movie, type Series } from '../models/content';
import type { MediaSource } from '../models/source';
import type { VerifiedPlaybackSource } from '../models/verification';
import { RuleBasedFilenameParser } from '../parser/rule-based-filename-parser';
import {
  PersistentCatalogRepository,
  type StorageDriver,
} from '../repository/persistent-catalog-repository';
import { maskUrl } from '../security/url-validator';
import { withTimeout } from '../utils/concurrency';
import { PlayableContentVerifier } from '../verification/playable-content-verifier';
import {
  contentItemToTitle,
  syncCatalogTitles,
  type Title,
} from '../../data/mock';

const inMemoryFallbackStore = new Map<string, string>();

/**
 * Robust storage driver delegating to AsyncStorage when available (React Native),
 * falling back gracefully to an in-memory map in Node.js test environments.
 */
export class SafeAsyncStorageDriver implements StorageDriver {
  public async getItem(key: string): Promise<string | null> {
    try {
      if (typeof AsyncStorage !== 'undefined' && AsyncStorage && typeof AsyncStorage.getItem === 'function') {
        const val = await AsyncStorage.getItem(key);
        if (val !== null && val !== undefined) return val;
      }
    } catch {}
    return inMemoryFallbackStore.get(key) ?? null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    try {
      if (typeof AsyncStorage !== 'undefined' && AsyncStorage && typeof AsyncStorage.setItem === 'function') {
        await AsyncStorage.setItem(key, value);
        return;
      }
    } catch {}
    inMemoryFallbackStore.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    try {
      if (typeof AsyncStorage !== 'undefined' && AsyncStorage && typeof AsyncStorage.removeItem === 'function') {
        await AsyncStorage.removeItem(key);
        return;
      }
    } catch {}
    inMemoryFallbackStore.delete(key);
  }
}

export type CatalogChangeListener = (titles: Title[]) => void;

export type EngineStatus = 'idle' | 'initializing' | 'running' | 'completed' | 'failed';

export interface EngineDiagnostics {
  status: EngineStatus;
  lastRunTime: number | null;
  configuredSourcesCount: number;
  sourcesAttemptedCount: number;
  successfulSourcesCount: number;
  failedSourcesCount: number;
  itemsDiscovered: number;
  itemsVerified: number;
  lastError: string | null;
  activeSources: Array<{
    id: string;
    name: string;
    baseUrl: string;
    protocol: string;
    enabled: boolean;
  }>;
}

export type EngineDiagnosticsListener = (diagnostics: EngineDiagnostics) => void;

/**
 * Standard authorized BDIX sources for Bangladeshi broadband networks.
 */
export const DEFAULT_BDIX_SOURCES: Array<Omit<MediaSource, 'id' | 'createdAt' | 'updatedAt'>> = [
  {
    name: 'BDIX Media Mirror 1',
    baseUrl: 'http://media1.bdix.internal/movies',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 10,
  },
  {
    name: 'Circle FTP BDIX Media',
    baseUrl: 'http://ftp5.circleftp.net/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 9,
  },
  {
    name: 'BDIX Discovery Gateway',
    baseUrl: 'http://api.bdix.local/v1/media',
    protocol: 'http',
    type: 'json-api',
    enabled: true,
    priority: 8,
  },
  {
    name: 'BDIX Live TV & Streams',
    baseUrl: 'http://stream.bdix.internal/live',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 7,
  },
];

/**
 * Production Catalog Service Singleton.
 * Bridges the backend parser engine, verification gate, persistent storage,
 * and the Cinator streaming UI state.
 */
export class CatalogService {
  private static instance: CatalogService | null = null;

  public readonly repository: CatalogRepository;
  public readonly sourceRegistry: SourceRegistry;
  public readonly coordinator: ScanCoordinator;
  public readonly verifier: PlayableContentVerifier;

  private readonly subscribers = new Set<CatalogChangeListener>();
  private readonly diagnosticsSubscribers = new Set<EngineDiagnosticsListener>();

  private isInitialized = false;
  private initPromise: Promise<Title[]> | null = null;
  private lastForegroundSync = 0;

  private engineStatus: EngineStatus = 'idle';
  private lastRunTime: number | null = null;
  private sourcesAttemptedCount = 0;
  private successfulSourcesCount = 0;
  private failedSourcesCount = 0;
  private itemsDiscovered = 0;
  private itemsVerified = 0;
  private lastError: string | null = null;
  private isRefreshing = false;

  constructor(
    storageDriver: StorageDriver = new SafeAsyncStorageDriver(),
    customRepo?: CatalogRepository,
    customRegistry?: SourceRegistry,
  ) {
    this.sourceRegistry = customRegistry ?? new InMemorySourceRegistry();
    this.repository = customRepo ?? new PersistentCatalogRepository(storageDriver);
    this.verifier = new PlayableContentVerifier();

    const crawler = new RecursiveDirectoryCrawler();
    const parser = new RuleBasedFilenameParser();
    const classifier = new RuleBasedContentClassifier();
    const artworkResolver = new ArtworkResolverImpl();

    this.coordinator = new ScanCoordinatorImpl(
      this.sourceRegistry,
      crawler,
      parser,
      classifier,
      artworkResolver,
      this.repository,
      this.verifier,
    );
  }

  public static getInstance(): CatalogService {
    if (!CatalogService.instance) {
      CatalogService.instance = new CatalogService();
    }
    return CatalogService.instance;
  }

  public static resetInstance(): void {
    CatalogService.instance = null;
  }

  /**
   * Seeds authorized default BDIX media sources if registry is empty.
   */
  public async seedDefaultSources(): Promise<void> {
    const existing = await this.sourceRegistry.getAllSources();
    if (existing.length === 0) {
      for (const s of DEFAULT_BDIX_SOURCES) {
        try {
          await this.sourceRegistry.addSource(s);
        } catch {}
      }
    }
  }

  /**
   * Initializes the catalog service, loads persistent records from disk,
   * enforces the verified playback gate, and syncs titles to UI state.
   * Safe, idempotent, and re-entrant.
   */
  public async initialize(): Promise<Title[]> {
    if (this.isInitialized) {
      return this.getVerifiedCatalog();
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.engineStatus = 'initializing';
    this.notifyDiagnostics();

    this.initPromise = (async () => {
      try {
        await this.seedDefaultSources();

        if (this.repository instanceof PersistentCatalogRepository) {
          await this.repository.loadFromStorage();
        }

        const verifiedItems = await this.repository.find({ verifiedOnly: true });
        const verifiedTitles = verifiedItems.map(contentItemToTitle);

        this.itemsVerified = verifiedTitles.length;
        syncCatalogTitles(verifiedTitles);
        this.notifySubscribers(verifiedTitles);
        this.isInitialized = true;
        this.engineStatus = 'idle';
        this.notifyDiagnostics();
        return verifiedTitles;
      } catch (err: unknown) {
        // Storage or initialization failure: fallback to empty catalog without halting startup
        this.isInitialized = true;
        this.engineStatus = 'idle';
        this.lastError = `Initialization notice: ${err instanceof Error ? err.message : String(err)}`;
        this.notifyDiagnostics();
        return [];
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Returns all current verified playable titles.
   */
  public async getVerifiedCatalog(): Promise<Title[]> {
    const verifiedItems = await this.repository.find({ verifiedOnly: true });
    return verifiedItems.map(contentItemToTitle);
  }

  /**
   * Search verified catalog titles.
   */
  public async search(query: string, limit: number = 30): Promise<Title[]> {
    const verifiedMatches = await this.repository.search(query, limit);
    return verifiedMatches.map(contentItemToTitle);
  }

  /**
   * Failover to alternative verified playback mirror for the same title/episode.
   * If all verified mirrors for this content are exhausted, removes the item
   * from the verified playable catalog.
   */
  public async failoverSource(
    titleId: string,
    failedUrl: string,
    episodeId?: string,
  ): Promise<string | null> {
    const nextUrl = await this.repository.invalidateSourceUrl(titleId, failedUrl, episodeId);

    // Re-sync verified titles to UI
    const verifiedItems = await this.repository.find({ verifiedOnly: true });
    const verifiedTitles = verifiedItems.map(contentItemToTitle);
    this.itemsVerified = verifiedTitles.length;
    syncCatalogTitles(verifiedTitles);
    this.notifySubscribers(verifiedTitles);
    this.notifyDiagnostics();

    return nextUrl;
  }

  /**
   * Refreshes the catalog by scanning active sources.
   * Non-blocking, isolated, observable, and resilient against slow or failing sources.
   */
  public async refresh(): Promise<Title[]> {
    if (this.isRefreshing) {
      return this.getVerifiedCatalog();
    }

    this.isRefreshing = true;
    this.engineStatus = 'running';
    this.sourcesAttemptedCount = 0;
    this.successfulSourcesCount = 0;
    this.failedSourcesCount = 0;
    this.lastError = null;
    this.notifyDiagnostics();

    try {
      await this.seedDefaultSources();
      const sources = await this.sourceRegistry.getActiveSources();

      for (const source of sources) {
        this.sourcesAttemptedCount++;
        this.notifyDiagnostics();

        try {
          const job = await this.coordinator.startScan(source.id);
          // Wait for scan to complete with bounded timeout per source (15 seconds)
          await withTimeout(
            new Promise<void>((resolve, reject) => {
              const unsub = this.coordinator.subscribe(job.id, (event) => {
                if (event.type === 'completed') {
                  unsub();
                  resolve();
                } else if (event.type === 'failed') {
                  unsub();
                  reject(new Error(event.job?.errors?.[0]?.message || 'Scan job failed'));
                }
              });
            }),
            15000,
            `Source timeout for ${maskUrl(source.baseUrl)}`,
          );

          // Update progress metrics from completed job
          const completedJob = this.coordinator.getJob(job.id);
          if (completedJob) {
            this.itemsDiscovered += completedJob.progress.filesDiscovered;
            if (completedJob.errors.length > 0 && completedJob.progress.filesDiscovered === 0) {
              this.failedSourcesCount++;
              this.lastError = `Source [${source.name}]: ${completedJob.errors[0]?.message || 'Scan errors'}`;
            } else {
              this.successfulSourcesCount++;
            }
          } else {
            this.successfulSourcesCount++;
          }
        } catch (err: unknown) {
          this.failedSourcesCount++;
          const rawMsg = err instanceof Error ? err.message : String(err);
          this.lastError = `Source [${source.name}]: ${maskUrl(rawMsg)}`;
          // Fault isolation: one source failing NEVER prevents other sources from executing
        }
        this.notifyDiagnostics();
      }

      const verifiedItems = await this.repository.find({ verifiedOnly: true });
      const verifiedTitles = verifiedItems.map(contentItemToTitle);
      this.itemsVerified = verifiedTitles.length;
      syncCatalogTitles(verifiedTitles);
      this.notifySubscribers(verifiedTitles);

      this.engineStatus = this.successfulSourcesCount > 0 || verifiedTitles.length > 0 ? 'completed' : 'failed';
      this.lastRunTime = Date.now();
      this.notifyDiagnostics();
      return verifiedTitles;
    } catch (err: unknown) {
      this.engineStatus = 'failed';
      this.lastError = `Refresh error: ${err instanceof Error ? err.message : String(err)}`;
      this.lastRunTime = Date.now();
      this.notifyDiagnostics();
      return this.getVerifiedCatalog();
    } finally {
      this.isRefreshing = false;
      this.notifyDiagnostics();
    }
  }

  /**
   * Adds a user-defined custom BDIX media source.
   */
  public async addCustomSource(
    source: Omit<MediaSource, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<MediaSource> {
    const created = await this.sourceRegistry.addSource(source);
    this.notifyDiagnostics();
    return created;
  }

  /**
   * Lifecycle handler called when the app transitions to active foreground.
   * Reconciles catalog state without blocking UI threads.
   */
  public async onAppForeground(): Promise<void> {
    const now = Date.now();
    // Throttle foreground checks to once every 60 seconds
    if (now - this.lastForegroundSync < 60_000) return;
    this.lastForegroundSync = now;

    if (!this.isInitialized) {
      await this.initialize();
      return;
    }

    // Refresh verified list from repository
    const verifiedItems = await this.repository.find({ verifiedOnly: true });
    const verifiedTitles = verifiedItems.map(contentItemToTitle);
    this.itemsVerified = verifiedTitles.length;
    syncCatalogTitles(verifiedTitles);
    this.notifySubscribers(verifiedTitles);
    this.notifyDiagnostics();
  }

  /**
   * Returns current engine diagnostics asynchronously including configured sources.
   */
  public async getDiagnostics(): Promise<EngineDiagnostics> {
    const allSources = await this.sourceRegistry.getAllSources();
    return {
      status: this.engineStatus,
      lastRunTime: this.lastRunTime,
      configuredSourcesCount: allSources.length,
      sourcesAttemptedCount: this.sourcesAttemptedCount,
      successfulSourcesCount: this.successfulSourcesCount,
      failedSourcesCount: this.failedSourcesCount,
      itemsDiscovered: this.itemsDiscovered,
      itemsVerified: this.itemsVerified,
      lastError: this.lastError,
      activeSources: allSources.map((s) => ({
        id: s.id,
        name: s.name,
        baseUrl: maskUrl(s.baseUrl),
        protocol: s.protocol,
        enabled: s.enabled,
      })),
    };
  }

  /**
   * Synchronous diagnostics snapshot.
   */
  public getDiagnosticsSync(): EngineDiagnostics {
    return {
      status: this.engineStatus,
      lastRunTime: this.lastRunTime,
      configuredSourcesCount: DEFAULT_BDIX_SOURCES.length,
      sourcesAttemptedCount: this.sourcesAttemptedCount,
      successfulSourcesCount: this.successfulSourcesCount,
      failedSourcesCount: this.failedSourcesCount,
      itemsDiscovered: this.itemsDiscovered,
      itemsVerified: this.itemsVerified,
      lastError: this.lastError,
      activeSources: DEFAULT_BDIX_SOURCES.map((s, idx) => ({
        id: `default_${idx}`,
        name: s.name,
        baseUrl: maskUrl(s.baseUrl),
        protocol: s.protocol,
        enabled: s.enabled,
      })),
    };
  }

  /**
   * Subscribe to verified catalog changes.
   */
  public subscribe(listener: CatalogChangeListener): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /**
   * Subscribe to engine diagnostics changes.
   */
  public subscribeDiagnostics(listener: EngineDiagnosticsListener): () => void {
    this.diagnosticsSubscribers.add(listener);
    return () => {
      this.diagnosticsSubscribers.delete(listener);
    };
  }

  private notifySubscribers(titles: Title[]): void {
    for (const listener of this.subscribers) {
      try {
        listener(titles);
      } catch {}
    }
  }

  private async notifyDiagnostics(): Promise<void> {
    if (this.diagnosticsSubscribers.size === 0) return;
    try {
      const diag = await this.getDiagnostics();
      for (const listener of this.diagnosticsSubscribers) {
        try {
          listener(diag);
        } catch {}
      }
    } catch {}
  }
}
