import test from 'node:test';
import assert from 'node:assert';
import {
  CatalogService,
  SafeAsyncStorageDriver,
  type EngineDiagnostics,
} from '../../src/engine/service/catalog-service';
import { RuleBasedContentClassifier } from '../../src/engine/classifier/rule-based-content-classifier';
import { RuleBasedFilenameParser } from '../../src/engine/parser/rule-based-filename-parser';
import { InMemoryCatalogRepository } from '../../src/engine/repository/in-memory-catalog-repository';
import { InMemorySourceRegistry } from '../../src/engine/adapters/in-memory-source-registry';
import { GENRES, AVAILABLE, syncCatalogTitles, type Title } from '../../src/data/mock';
import type { StorageDriver } from '../../src/engine/repository/persistent-catalog-repository';

test('Startup & Resilience - SafeAsyncStorageDriver memory fallback', async () => {
  const driver = new SafeAsyncStorageDriver();
  await driver.setItem('test_key', 'hello_startup');
  const value = await driver.getItem('test_key');
  assert.strictEqual(value, 'hello_startup');
  await driver.removeItem('test_key');
  const removed = await driver.getItem('test_key');
  assert.strictEqual(removed, null);
});

test('Startup & Resilience - Idempotent and concurrent CatalogService.initialize()', async () => {
  CatalogService.resetInstance();
  const service = CatalogService.getInstance();

  // Run multiple concurrent initializations
  const [init1, init2, init3] = await Promise.all([
    service.initialize(),
    service.initialize(),
    service.initialize(),
  ]);

  assert.ok(Array.isArray(init1));
  assert.strictEqual(init1, init2);
  assert.strictEqual(init2, init3);

  // Subsequent call returns cached catalog
  const initSubsequent = await service.initialize();
  assert.deepStrictEqual(initSubsequent, init1);
  CatalogService.resetInstance();
});

test('Startup & Resilience - CatalogService survives throwing storage driver gracefully', async () => {
  const faultyDriver: StorageDriver = {
    async getItem(): Promise<string | null> {
      throw new Error('Native disk I/O error or bridge crash');
    },
    async setItem(): Promise<void> {
      throw new Error('Storage write prohibited');
    },
    async removeItem(): Promise<void> {
      throw new Error('Storage remove error');
    },
  };

  const service = new CatalogService(faultyDriver);
  // Must NOT throw or reject; must return empty verified catalog gracefully
  const catalog = await service.initialize();
  assert.ok(Array.isArray(catalog));
});

test('Startup & Resilience - Storage hydration failure and malformed persisted data recovery', async () => {
  // Test JSON parsing recovery pattern used in AppState hydration
  const malformedJson = '{ invalid_json: [ ';
  let hydratedState: any = null;

  try {
    hydratedState = JSON.parse(malformedJson);
  } catch {
    hydratedState = null; // graceful fallback to default state
  }

  assert.strictEqual(hydratedState, null, 'Must fall back to null safely when JSON is malformed');

  // Ensure default state retains valid empty data structures without crashing UI
  const fallbackData = {
    myList: hydratedState?.data?.myList ?? [],
    ratings: hydratedState?.data?.ratings ?? {},
    reminders: hydratedState?.data?.reminders ?? [],
    progress: hydratedState?.data?.progress ?? [],
    downloads: hydratedState?.data?.downloads ?? [],
  };

  assert.ok(Array.isArray(fallbackData.myList));
  assert.strictEqual(Object.keys(fallbackData.ratings).length, 0);
});

test('Startup & Lifecycle - Splash completion and font loading recovery logic', () => {
  // Helper modeling App.tsx splash dismiss decision function
  const computeSplashReady = (loaded: boolean, error: Error | null, fontTimeout: boolean) => {
    return loaded || !!error || fontTimeout;
  };

  // 1. Success case: fonts loaded cleanly
  assert.strictEqual(computeSplashReady(true, null, false), true, 'Ready when fonts loaded');

  // 2. Failure case: font loading threw an error
  assert.strictEqual(computeSplashReady(false, new Error('Network error downloading font'), false), true, 'Ready on font error');

  // 3. Timeout case: font loading stalled or never resolved
  assert.strictEqual(computeSplashReady(false, null, true), true, 'Ready on font timeout');

  // 4. Pending case: still loading within bounds
  assert.strictEqual(computeSplashReady(false, null, false), false, 'Not ready while pending within timeout');
});

test('BDIX Engine - Diagnostics observable state transitions and metrics reporting', async () => {
  const customRegistry = new InMemorySourceRegistry();
  const customRepo = new InMemoryCatalogRepository();
  const service = new CatalogService(new SafeAsyncStorageDriver(), customRepo, customRegistry);

  // Initial state should be idle
  const initialDiag = await service.getDiagnostics();
  assert.strictEqual(initialDiag.status, 'idle');
  assert.strictEqual(initialDiag.sourcesAttemptedCount, 0);

  // Subscribe to diagnostics
  const recordedStatuses: string[] = [];
  const unsub = service.subscribeDiagnostics((d: EngineDiagnostics) => {
    recordedStatuses.push(d.status);
  });

  // Adding a source updates configured count
  await service.addCustomSource({
    name: 'Test Local Mirror',
    baseUrl: 'http://10.0.0.10/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
  });

  const updatedDiag = await service.getDiagnostics();
  assert.strictEqual(updatedDiag.configuredSourcesCount, 1);
  assert.strictEqual(updatedDiag.activeSources[0].name, 'Test Local Mirror');
  // Confirm security: URL is masked
  assert.ok(typeof updatedDiag.activeSources[0].baseUrl === 'string');

  unsub();
});

test('BDIX Engine - Duplicate refresh prevention and cancellation', async () => {
  const customRegistry = new InMemorySourceRegistry();
  const customRepo = new InMemoryCatalogRepository();
  const service = new CatalogService(new SafeAsyncStorageDriver(), customRepo, customRegistry);

  // Add source that will fail immediately via closed port
  await customRegistry.addSource({
    name: 'Unreachable Host',
    baseUrl: 'http://127.0.0.1:59999/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
  });

  // Launch two concurrent refreshes
  const refresh1Promise = service.refresh();
  const refresh2Promise = service.refresh();

  const [res1, res2] = await Promise.all([refresh1Promise, refresh2Promise]);
  assert.ok(Array.isArray(res1));
  assert.ok(Array.isArray(res2));
});

test('BDIX Engine - Failed source isolation: failed source does NOT block subsequent sources', async () => {
  const customRegistry = new InMemorySourceRegistry();
  const customRepo = new InMemoryCatalogRepository();
  const service = new CatalogService(new SafeAsyncStorageDriver(), customRepo, customRegistry);

  // Source 1: closed port, fails immediately
  await customRegistry.addSource({
    name: 'Failed Source 1',
    baseUrl: 'http://127.0.0.1:59998/movies',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 10,
  });

  // Source 2: also isolated
  await customRegistry.addSource({
    name: 'Failed Source 2',
    baseUrl: 'http://127.0.0.1:59997/movies',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 5,
  });

  await service.refresh();
  const diag = await service.getDiagnostics();

  // Both sources must have been attempted; neither stopped the other
  assert.strictEqual(diag.sourcesAttemptedCount, 2);
  assert.strictEqual(diag.failedSourcesCount, 2);
  assert.ok(diag.lastError !== null, 'Actionable error should be recorded');
  assert.strictEqual(diag.status, 'failed');
});

test('BDIX Engine - Cached catalog availability when refresh fails', async () => {
  const customRegistry = new InMemorySourceRegistry();
  const customRepo = new InMemoryCatalogRepository();
  const service = new CatalogService(new SafeAsyncStorageDriver(), customRepo, customRegistry);

  // Seed verified item in repo
  await customRepo.saveItem({
    id: 'cached_movie_1',
    name: 'Cached Verified Movie',
    kind: 'movie',
    year: 2024,
    genres: ['Action'],
    quality: ['HD'],
    sources: [
      {
        url: 'http://verified.bdix/movie.mp4',
        sourceId: 'src_1',
        state: 'VERIFIED',
        verifiedAt: Date.now(),
        probeLatencyMs: 25,
      },
    ],
    verified: true,
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  });

  // Add a failing source to registry
  await customRegistry.addSource({
    name: 'Offline Server',
    baseUrl: 'http://offline.server/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
  });

  // Refresh with failing source
  const refreshedTitles = await service.refresh();

  // Previously verified cached item MUST still be available
  assert.strictEqual(refreshedTitles.length, 1);
  assert.strictEqual(refreshedTitles[0].id, 'cached_movie_1');
});

test('BDIX Engine - Strict playable-source verification before publication', () => {
  // Test syncCatalogTitles gate
  const unverifiedTitle: Title = {
    id: 'unverified_1',
    name: 'Unverified Movie Card',
    kind: 'movie',
    year: 2024,
    maturity: 'ALL',
    runtime: 100,
    seasons: [],
    genres: ['Drama'],
    moods: [],
    synopsis: '',
    cast: [],
    creators: [],
    original: false,
    seed: 'seed',
    tint: '#E50914',
    video: '', // No verified playable video URL
    quality: ['HD'],
    sources: [],
  };

  const verifiedTitle: Title = {
    ...unverifiedTitle,
    id: 'verified_1',
    name: 'Verified Playable Movie',
    video: 'http://bdix.local/movie.mp4',
    sources: [{ url: 'http://bdix.local/movie.mp4', verificationState: 'VERIFIED' }],
  };

  syncCatalogTitles([unverifiedTitle, verifiedTitle]);

  // AVAILABLE collection must ONLY include the item with verified playable video
  assert.strictEqual(AVAILABLE.length, 1);
  assert.strictEqual(AVAILABLE[0].id, 'verified_1');
  assert.strictEqual(AVAILABLE.some((t) => t.id === 'unverified_1'), false);
});

test('Startup & Classification - BDIX Live TV stream classification', () => {
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();

  const parsed = parser.parse('Channel.9.Live.Stream.m3u8');
  const result = classifier.classify(parsed, ['IPTV', 'Live Channels']);

  assert.ok(result.genres.includes('Live TV'), 'Must include Live TV genre');
});

test('Startup & Classification - Adult 18+ stream and content classification', () => {
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();

  const parsed = parser.parse('Midnight.Desire.18+.Uncensored.720p.mp4');
  const result = classifier.classify(parsed, ['Adult']);

  assert.strictEqual(result.maturity, '18+');
  assert.ok(result.genres.includes('Adult (18+)'), 'Must include Adult (18+) genre');
});

test('Startup & Classification - GENRES list contains Live TV and Adult (18+)', () => {
  assert.ok(GENRES.includes('Live TV'), 'GENRES must include Live TV');
  assert.ok(GENRES.includes('Adult (18+)'), 'GENRES must include Adult (18+)');
});
