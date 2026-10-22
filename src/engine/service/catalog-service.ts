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
  private isInitialized = false;
  private initPromise: Promise<Title[]> | null = null;
  private lastForegroundSync = 0;

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

    this.initPromise = (async () => {
      try {
        if (this.repository instanceof PersistentCatalogRepository) {
          await this.repository.loadFromStorage();
        }

        const verifiedItems = await this.repository.find({ verifiedOnly: true });
        const verifiedTitles = verifiedItems.map(contentItemToTitle);

        syncCatalogTitles(verifiedTitles);
        this.notifySubscribers(verifiedTitles);
        this.isInitialized = true;
        return verifiedTitles;
      } catch {
        // Storage or initialization failure: fallback to empty catalog without halting startup
        this.isInitialized = true;
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
    syncCatalogTitles(verifiedTitles);
    this.notifySubscribers(verifiedTitles);

    return nextUrl;
  }

  /**
   * Refreshes the catalog by scanning active sources.
   */
  public async refresh(): Promise<Title[]> {
    const sources = await this.sourceRegistry.getActiveSources();
    for (const source of sources) {
      try {
        const job = await this.coordinator.startScan(source.id);
        // Wait for scan to complete
        await new Promise<void>((resolve) => {
          const unsub = this.coordinator.subscribe(job.id, (event) => {
            if (event.type === 'completed' || event.type === 'failed') {
              unsub();
              resolve();
            }
          });
        });
      } catch {
        // Source scan failed; isolate error and continue
      }
    }

    const verifiedItems = await this.repository.find({ verifiedOnly: true });
    const verifiedTitles = verifiedItems.map(contentItemToTitle);
    syncCatalogTitles(verifiedTitles);
    this.notifySubscribers(verifiedTitles);
    return verifiedTitles;
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
    syncCatalogTitles(verifiedTitles);
    this.notifySubscribers(verifiedTitles);
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

  private notifySubscribers(titles: Title[]): void {
    for (const listener of this.subscribers) {
      try {
        listener(titles);
      } catch {}
    }
  }
}
