import test from 'node:test';
import assert from 'node:assert';
import { InMemorySourceRegistry } from '../../src/engine/adapters/in-memory-source-registry';
import { RuleBasedContentClassifier } from '../../src/engine/classifier/rule-based-content-classifier';
import { ScanCoordinatorImpl } from '../../src/engine/coordinator/scan-coordinator-impl';
import type { ArtworkResolver } from '../../src/engine/interfaces/artwork-resolver';
import type { CrawlEvent, DirectoryCrawler } from '../../src/engine/interfaces/directory-crawler';
import { RuleBasedFilenameParser } from '../../src/engine/parser/rule-based-filename-parser';
import { InMemoryCatalogRepository } from '../../src/engine/repository/in-memory-catalog-repository';
import { PlayableContentVerifier } from '../../src/engine/verification/playable-content-verifier';
import type { VerificationResult } from '../../src/engine/models/verification';

// Mock DirectoryCrawler yielding mock directory & file events
class MockDirectoryCrawler implements DirectoryCrawler {
  private readonly events: CrawlEvent[];
  private readonly delayMs: number;

  constructor(events: CrawlEvent[], delayMs: number = 0) {
    this.events = events;
    this.delayMs = delayMs;
  }

  public async *crawl(): AsyncIterable<CrawlEvent> {
    for (const event of this.events) {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      yield event;
    }
  }
}

// Mock ArtworkResolver
class MockArtworkResolver implements ArtworkResolver {
  public async resolveArtwork(): Promise<{ source: 'none' }> {
    return { source: 'none' };
  }
}

// Mock PlayableContentVerifier avoiding external network calls in unit tests
class MockPlayableContentVerifier extends PlayableContentVerifier {
  public override async verifyMediaSource(videoUrl: string): Promise<VerificationResult> {
    if (videoUrl.includes('inaccessible') || videoUrl.includes('broken')) {
      return {
        state: 'REJECTED',
        playable: false,
        latencyMs: 1,
        rejectionReason: 'File inaccessible on source',
      };
    }
    return {
      state: 'VERIFIED',
      playable: true,
      container: videoUrl.endsWith('.mkv') ? 'mkv' : 'mp4',
      fileSizeBytes: 104857600,
      latencyMs: 2,
    };
  }
}

test('ScanCoordinator - Full scan pipeline and catalog persistence', async () => {
  const registry = new InMemorySourceRegistry();
  const repo = new InMemoryCatalogRepository();
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();
  const artwork = new MockArtworkResolver();
  const verifier = new MockPlayableContentVerifier();

  const source = await registry.addSource({
    name: 'Test BDIX Server',
    baseUrl: 'http://bdix.test/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
  });

  const mockEvents: CrawlEvent[] = [
    { type: 'directory', depth: 1, path: 'movies' },
    {
      type: 'file',
      depth: 2,
      path: 'movies/Inception.2010.1080p.mkv',
      entry: {
        name: 'Inception.2010.1080p.mkv',
        path: 'movies/Inception.2010.1080p.mkv',
        url: 'http://bdix.test/media/movies/Inception.2010.1080p.mkv',
        type: 'file',
      },
    },
    { type: 'directory', depth: 1, path: 'series' },
    {
      type: 'file',
      depth: 2,
      path: 'series/Arcane/Season 1/Arcane.S01E01.720p.mkv',
      entry: {
        name: 'Arcane.S01E01.720p.mkv',
        path: 'series/Arcane/Season 1/Arcane.S01E01.720p.mkv',
        url: 'http://bdix.test/media/series/Arcane/Season 1/Arcane.S01E01.720p.mkv',
        type: 'file',
      },
    },
  ];

  const crawler = new MockDirectoryCrawler(mockEvents);
  const coordinator = new ScanCoordinatorImpl(registry, crawler, parser, classifier, artwork, repo, verifier);

  const job = await coordinator.startScan(source.id);
  assert.strictEqual(job.sourceId, source.id);

  // Wait briefly for async scan pipeline to complete
  await new Promise((resolve) => setTimeout(resolve, 50));

  const completedJob = coordinator.getJob(job.id);
  assert.strictEqual(completedJob?.status, 'completed');
  assert.strictEqual(completedJob?.progress.filesDiscovered, 2);
  assert.strictEqual(completedJob?.progress.itemsParsed, 2);

  // Verify catalog repository contains the parsed movie and series
  const items = await repo.find();
  assert.strictEqual(items.length, 2);

  const movie = await repo.getMovie(items.find((i) => i.kind === 'movie')!.id);
  assert.strictEqual(movie?.name, 'Inception');
  assert.strictEqual(movie?.year, 2010);
  assert.strictEqual(movie?.verificationState, 'VERIFIED');

  const series = await repo.getSeries(items.find((i) => i.kind === 'series')!.id);
  assert.strictEqual(series?.name, 'Arcane');
  assert.strictEqual(series?.totalEpisodes, 1);
  assert.strictEqual(series?.seasons[0].episodes[0].seasonNumber, 1);
  assert.strictEqual(series?.seasons[0].episodes[0].episodeNumber, 1);
  assert.strictEqual(series?.verificationState, 'VERIFIED');
});

test('ScanCoordinator - Cancellation support via cancelScan()', async () => {
  const registry = new InMemorySourceRegistry();
  const repo = new InMemoryCatalogRepository();
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();
  const artwork = new MockArtworkResolver();
  const verifier = new MockPlayableContentVerifier();

  const source = await registry.addSource({
    name: 'Long Running Source',
    baseUrl: 'http://bdix.long/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
  });

  // Events with delay to allow cancellation midway
  const mockEvents: CrawlEvent[] = [
    { type: 'directory', depth: 1, path: 'folder1' },
    { type: 'directory', depth: 2, path: 'folder2' },
    { type: 'directory', depth: 3, path: 'folder3' },
  ];

  const crawler = new MockDirectoryCrawler(mockEvents, 30);
  const coordinator = new ScanCoordinatorImpl(registry, crawler, parser, classifier, artwork, repo, verifier);

  const job = await coordinator.startScan(source.id);
  assert.strictEqual(job.status, 'pending');

  // Cancel immediately
  const cancelled = await coordinator.cancelScan(job.id);
  assert.strictEqual(cancelled, true);

  await new Promise((resolve) => setTimeout(resolve, 40));

  const jobAfter = coordinator.getJob(job.id);
  assert.strictEqual(jobAfter?.status, 'cancelled');
});

test('ScanCoordinator - Limit enforcement (maxItems)', async () => {
  const registry = new InMemorySourceRegistry();
  const repo = new InMemoryCatalogRepository();
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();
  const artwork = new MockArtworkResolver();
  const verifier = new MockPlayableContentVerifier();

  const source = await registry.addSource({
    name: 'Limited Source',
    baseUrl: 'http://bdix.limit/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
  });

  const mockEvents: CrawlEvent[] = [
    {
      type: 'file',
      depth: 1,
      path: 'Movie1.2021.mkv',
      entry: { name: 'Movie1.2021.mkv', path: 'Movie1.2021.mkv', url: 'http://test/1.mkv', type: 'file' },
    },
    {
      type: 'file',
      depth: 1,
      path: 'Movie2.2022.mkv',
      entry: { name: 'Movie2.2022.mkv', path: 'Movie2.2022.mkv', url: 'http://test/2.mkv', type: 'file' },
    },
    {
      type: 'file',
      depth: 1,
      path: 'Movie3.2023.mkv',
      entry: { name: 'Movie3.2023.mkv', path: 'Movie3.2023.mkv', url: 'http://test/3.mkv', type: 'file' },
    },
  ];

  const crawler = new MockDirectoryCrawler(mockEvents);
  const coordinator = new ScanCoordinatorImpl(registry, crawler, parser, classifier, artwork, repo, verifier);

  // Set maxItems limit to 2
  const job = await coordinator.startScan(source.id, { maxItems: 2 });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const completedJob = coordinator.getJob(job.id);
  assert.strictEqual(completedJob?.status, 'failed');
  assert.ok(completedJob?.errors.some((e) => e.code === 'ENGINE_LIMIT_EXCEEDED'));
  assert.strictEqual(completedJob?.progress.itemsParsed, 2);
});
