import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CatalogService,
  SafeAsyncStorageDriver,
} from '../../src/engine/service/catalog-service';
import { PersistentCatalogRepository } from '../../src/engine/repository/persistent-catalog-repository';
import { InMemorySourceRegistry } from '../../src/engine/adapters/in-memory-source-registry';
import {
  AVAILABLE,
  MOVIES,
  SERIES,
  TITLES,
  contentItemToTitle,
  syncCatalogTitles,
  top10Rank,
} from '../../src/data/mock';
import type { Movie, Series } from '../../src/engine/models/content';
import { maskUrl, validateUrl } from '../../src/engine/security/url-validator';

// In-memory mock storage for testing persistence across restarts
class MockStorageDriver {
  private readonly store = new Map<string, string>();

  public async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  public async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}

test('Integration 1 & 2: Ingestion, Title Mapping, and Strict Playability Gate', async () => {
  const storage = new MockStorageDriver();
  const repo = new PersistentCatalogRepository(storage, 'test:catalog:gate');
  const service = new CatalogService(storage, repo);

  const verifiedMovie: Movie = {
    id: 'movie-101',
    sourceId: 'src-alpha',
    sourcePath: '/movies/inception.2010.1080p.mkv',
    name: 'Inception',
    kind: 'movie',
    year: 2010,
    maturity: '13+',
    genres: ['Sci-Fi', 'Action'],
    moods: ['Mind-Bending'],
    runtime: 148,
    videoUrl: 'http://bdix.local/movies/inception.mp4',
    quality: ['HD', '5.1'],
    artwork: {
      source: 'sidecar',
      posterUrl: 'http://bdix.local/movies/inception-poster.jpg',
      backdropUrl: 'http://bdix.local/movies/inception-backdrop.jpg',
    },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now() - 5000,
    updatedAt: Date.now() - 5000,
  };

  const unverifiedMovie: Movie = {
    id: 'movie-unverified',
    sourceId: 'src-alpha',
    sourcePath: '/movies/unverified.mkv',
    name: 'Unverified Movie',
    kind: 'movie',
    year: 2024,
    maturity: 'ALL',
    genres: ['Drama'],
    moods: [],
    runtime: 90,
    videoUrl: 'http://bdix.local/movies/unverified.mp4',
    quality: ['HD'],
    artwork: { source: 'none' },
    verificationState: 'UNVERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  const rejectedMovie: Movie = {
    id: 'movie-rejected',
    sourceId: 'src-alpha',
    sourcePath: '/movies/broken.mkv',
    name: 'Broken Video',
    kind: 'movie',
    year: 2023,
    maturity: 'ALL',
    genres: ['Comedy'],
    moods: [],
    runtime: 90,
    videoUrl: 'http://bdix.local/movies/broken.mp4',
    quality: ['HD'],
    artwork: { source: 'none' },
    verificationState: 'REJECTED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.saveItems([verifiedMovie, unverifiedMovie, rejectedMovie]);

  const titles = await service.initialize();

  // Acceptance Check: Only verified items are published in normal catalog
  assert.equal(titles.length, 1);
  assert.equal(titles[0].id, 'movie-101');
  assert.equal(titles[0].name, 'Inception');
  assert.equal(titles[0].posterUrl, 'http://bdix.local/movies/inception-poster.jpg');
  assert.equal(titles[0].video, 'http://bdix.local/movies/inception.mp4');

  // Verify AVAILABLE array in mock state is synchronized
  assert.equal(AVAILABLE.length, 1);
  assert.equal(AVAILABLE[0].id, 'movie-101');
  assert.equal(MOVIES.length, 1);
  assert.equal(SERIES.length, 0);

  // Unverified and Rejected items must never be present
  assert.ok(!AVAILABLE.some((t) => t.id === 'movie-unverified'));
  assert.ok(!AVAILABLE.some((t) => t.id === 'movie-rejected'));
});

test('Integration 3 & 4: Poster-Only Items Blocked & Missing Artwork Allowed', async () => {
  const storage = new MockStorageDriver();
  const repo = new PersistentCatalogRepository(storage, 'test:catalog:artwork');
  const service = new CatalogService(storage, repo);

  // Item with great poster but NO valid video URL / rejected playback
  const posterOnlyItem: Movie = {
    id: 'poster-only-1',
    sourceId: 'src-alpha',
    sourcePath: '/posters/fake.jpg',
    name: 'Ghost Movie With Poster',
    kind: 'movie',
    year: 2025,
    maturity: 'ALL',
    genres: ['Horror'],
    moods: ['Spooky'],
    runtime: 100,
    videoUrl: '', // No valid video!
    quality: [],
    artwork: {
      source: 'remote',
      posterUrl: 'https://images.example.com/beautiful-poster.jpg',
      backdropUrl: 'https://images.example.com/beautiful-backdrop.jpg',
    },
    verificationState: 'UNVERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Item with verified video stream but NO poster/artwork
  const streamWithoutArtwork: Movie = {
    id: 'movie-no-art',
    sourceId: 'src-alpha',
    sourcePath: '/streams/indie_film.mp4',
    name: 'Indie Film Without Poster',
    kind: 'movie',
    year: 2022,
    maturity: 'ALL',
    genres: ['Documentary'],
    moods: ['Inspiring'],
    runtime: 75,
    videoUrl: 'http://bdix.local/streams/indie_film.mp4',
    quality: ['HD'],
    artwork: { source: 'none' },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.saveItems([posterOnlyItem, streamWithoutArtwork]);
  const titles = await service.initialize();

  // Poster-only unverified item MUST NOT appear
  assert.ok(!titles.some((t) => t.id === 'poster-only-1'));
  // Verified stream without artwork MUST appear
  assert.ok(titles.some((t) => t.id === 'movie-no-art'));
});

test('Integration 5, 6 & 7: Episodic Series Filtering, Season Pruning, and 0-Episode Series Exclusion', async () => {
  const storage = new MockStorageDriver();
  const repo = new PersistentCatalogRepository(storage, 'test:catalog:episodic');
  const service = new CatalogService(storage, repo);

  const seriesWithMixedEpisodes: Series = {
    id: 'series-stranger',
    sourceId: 'src-alpha',
    sourcePath: '/tv/Stranger Things',
    name: 'Stranger Things',
    kind: 'series',
    year: 2016,
    maturity: '16+',
    genres: ['Sci-Fi', 'Drama'],
    moods: ['Ominous'],
    artwork: { source: 'none' },
    quality: ['4K'],
    verificationState: 'VERIFIED',
    totalSeasons: 2,
    totalEpisodes: 3,
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
    seasons: [
      {
        seasonNumber: 1,
        name: 'Season 1',
        episodes: [
          {
            id: 'st-s01e01',
            seriesId: 'series-stranger',
            seasonNumber: 1,
            episodeNumber: 1,
            name: 'Chapter One: The Vanishing',
            runtime: 48,
            videoUrl: 'http://bdix.local/tv/st.s01e01.mp4',
            sourcePath: '/tv/Stranger Things/S01E01.mp4',
            verificationState: 'VERIFIED',
          },
          {
            id: 'st-s01e02',
            seriesId: 'series-stranger',
            seasonNumber: 1,
            episodeNumber: 2,
            name: 'Chapter Two: The Weirdo',
            runtime: 55,
            videoUrl: '', // Unverified / missing video
            sourcePath: '/tv/Stranger Things/S01E02.mp4',
            verificationState: 'UNVERIFIED',
          },
        ],
      },
      {
        seasonNumber: 2,
        name: 'Season 2',
        episodes: [
          {
            id: 'st-s02e01',
            seriesId: 'series-stranger',
            seasonNumber: 2,
            episodeNumber: 1,
            name: 'Chapter One: MADMAX',
            runtime: 48,
            videoUrl: '', // Whole season unverified!
            sourcePath: '/tv/Stranger Things/S02E01.mp4',
            verificationState: 'REJECTED',
          },
        ],
      },
    ],
  };

  const emptySeries: Series = {
    id: 'series-ghost',
    sourceId: 'src-alpha',
    sourcePath: '/tv/Ghost Series',
    name: 'Ghost Series With No Verified Video',
    kind: 'series',
    year: 2023,
    maturity: 'ALL',
    genres: ['Mystery'],
    moods: [],
    artwork: { source: 'none' },
    quality: ['HD'],
    verificationState: 'VERIFIED',
    totalSeasons: 1,
    totalEpisodes: 1,
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            id: 'ghost-s01e01',
            seriesId: 'series-ghost',
            seasonNumber: 1,
            episodeNumber: 1,
            name: 'Ghost Ep',
            runtime: 30,
            videoUrl: '',
            sourcePath: '/tv/ghost.mkv',
            verificationState: 'REJECTED',
          },
        ],
      },
    ],
  };

  await repo.saveItems([seriesWithMixedEpisodes, emptySeries]);
  const titles = await service.initialize();

  // Series with 0 verified episodes must NOT appear
  assert.ok(!titles.some((t) => t.id === 'series-ghost'));

  // Series with verified episodes must appear
  const st = titles.find((t) => t.id === 'series-stranger');
  assert.ok(st);

  // Acceptance: Season 2 had 0 verified episodes, so it must be pruned
  assert.equal(st.seasons.length, 1);
  assert.equal(st.seasons[0].number, 1);

  // Acceptance: Season 1 only publishes the verified episode 1, not unverified episode 2
  assert.equal(st.seasons[0].episodes.length, 1);
  assert.equal(st.seasons[0].episodes[0].number, 1);
  assert.equal(st.seasons[0].episodes[0].id, 'st-s01e01');
});

test('Integration 8, 9, 10 & 11: Multi-Source Mirror Failover & Exhaustion Isolation', async () => {
  const storage = new MockStorageDriver();
  const repo = new PersistentCatalogRepository(storage, 'test:catalog:failover');
  const service = new CatalogService(storage, repo);

  const movieWithMirrors: Movie = {
    id: 'movie-oppenheimer',
    sourceId: 'mirror-primary',
    sourcePath: '/movies/oppenheimer.mp4',
    name: 'Oppenheimer',
    kind: 'movie',
    year: 2023,
    maturity: '16+',
    genres: ['Biography', 'Drama'],
    moods: ['Intense'],
    runtime: 180,
    videoUrl: 'http://mirror1.bdix/oppenheimer.mp4',
    quality: ['4K'],
    artwork: { source: 'none' },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
    sources: [
      {
        sourceId: 'mirror-primary',
        sourcePath: '/movies/oppenheimer.mp4',
        url: 'http://mirror1.bdix/oppenheimer.mp4',
        verificationState: 'VERIFIED',
        lastVerifiedAt: Date.now(),
        consecutiveFailures: 0,
      },
      {
        sourceId: 'mirror-backup',
        sourcePath: '/storage/oppenheimer.mp4',
        url: 'http://mirror2.bdix/oppenheimer.mp4',
        verificationState: 'VERIFIED',
        lastVerifiedAt: Date.now(),
        consecutiveFailures: 0,
      },
    ],
  };

  const unrelatedMovie: Movie = {
    id: 'movie-barbie',
    sourceId: 'mirror-backup',
    sourcePath: '/movies/barbie.mp4',
    name: 'Barbie',
    kind: 'movie',
    year: 2023,
    maturity: '13+',
    genres: ['Comedy'],
    moods: ['Fun'],
    runtime: 114,
    videoUrl: 'http://mirror2.bdix/barbie.mp4',
    quality: ['HD'],
    artwork: { source: 'none' },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.saveItems([movieWithMirrors, unrelatedMovie]);
  await service.initialize();

  // Failover test 1: Mirror 1 fails
  const nextMirror = await service.failoverSource(
    'movie-oppenheimer',
    'http://mirror1.bdix/oppenheimer.mp4',
  );

  // Acceptance: Seamlessly failover to Mirror 2 of Oppenheimer
  assert.equal(nextMirror, 'http://mirror2.bdix/oppenheimer.mp4');

  // Acceptance (Rule 6): NEVER substitute a different movie!
  assert.notEqual(nextMirror, 'http://mirror2.bdix/barbie.mp4');

  const oppenheimer = await repo.getMovie('movie-oppenheimer');
  assert.equal(oppenheimer?.videoUrl, 'http://mirror2.bdix/oppenheimer.mp4');
  assert.equal(oppenheimer?.verificationState, 'VERIFIED');

  // Failover test 2: Mirror 2 also fails (Total exhaustion)
  const exhausted = await service.failoverSource(
    'movie-oppenheimer',
    'http://mirror2.bdix/oppenheimer.mp4',
  );

  // Acceptance: When all mirrors are exhausted, returns null and marks item rejected
  assert.equal(exhausted, null);

  const updatedOppenheimer = await repo.getMovie('movie-oppenheimer');
  assert.equal(updatedOppenheimer?.verificationState, 'REJECTED');

  // Acceptance: Total exhausted item is automatically purged from AVAILABLE titles
  assert.ok(!AVAILABLE.some((t) => t.id === 'movie-oppenheimer'));

  // Acceptance: Unrelated movie remains unaffected and playable
  assert.ok(AVAILABLE.some((t) => t.id === 'movie-barbie'));
});

test('Integration 12: Search and Category Filtering Against Verified Items Only', async () => {
  const storage = new MockStorageDriver();
  const repo = new PersistentCatalogRepository(storage, 'test:catalog:search');
  const service = new CatalogService(storage, repo);

  const animeTitle: Movie = {
    id: 'anime-naruto',
    sourceId: 'src-anime',
    sourcePath: '/anime/naruto.mkv',
    name: 'Naruto The Movie',
    kind: 'movie',
    year: 2004,
    maturity: '13+',
    genres: ['Anime', 'Action', 'Shonen'],
    moods: ['Adventurous'],
    runtime: 95,
    videoUrl: 'http://bdix.local/anime/naruto.mp4',
    quality: ['HD'],
    artwork: { source: 'none' },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  const fakeSearchTitle: Movie = {
    id: 'anime-fake',
    sourceId: 'src-anime',
    sourcePath: '/anime/fake.mkv',
    name: 'Naruto Unverified Fake',
    kind: 'movie',
    year: 2024,
    maturity: '13+',
    genres: ['Anime'],
    moods: [],
    runtime: 90,
    videoUrl: '',
    quality: [],
    artwork: { source: 'none' },
    verificationState: 'REJECTED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.saveItems([animeTitle, fakeSearchTitle]);
  await service.initialize();

  // Search query
  const matches = await service.search('Naruto');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'anime-naruto');
  assert.ok(!matches.some((m) => m.id === 'anime-fake'));
});

test('Integration 13: Persistent Storage Flush and Cold Restart Recovery', async () => {
  const sharedStorage = new MockStorageDriver();

  // Instance 1 writes to storage
  const repo1 = new PersistentCatalogRepository(sharedStorage, 'cinator:persistent:test');
  const item: Movie = {
    id: 'persisted-1',
    sourceId: 'src-persisted',
    sourcePath: '/movies/interstellar.mp4',
    name: 'Interstellar',
    kind: 'movie',
    year: 2014,
    maturity: '13+',
    genres: ['Sci-Fi', 'Adventure'],
    moods: ['Visionary'],
    runtime: 169,
    videoUrl: 'http://bdix.local/interstellar.mp4',
    quality: ['4K', 'HDR'],
    artwork: { source: 'sidecar', posterUrl: 'http://bdix.local/poster.jpg' },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };
  await repo1.saveItem(item);
  await repo1.persistToStorage();

  // Instance 2 simulates cold app startup reading from disk
  const repo2 = new PersistentCatalogRepository(sharedStorage, 'cinator:persistent:test');
  const service2 = new CatalogService(sharedStorage, repo2);
  const titles = await service2.initialize();

  assert.equal(titles.length, 1);
  assert.equal(titles[0].id, 'persisted-1');
  assert.equal(titles[0].name, 'Interstellar');
  assert.equal(titles[0].quality.includes('4K'), true);
});

test('Integration 14: Source Offline Isolation and Deletion Cleanup', async () => {
  const storage = new MockStorageDriver();
  const repo = new PersistentCatalogRepository(storage, 'test:catalog:isolation');

  const sourceAMovie: Movie = {
    id: 'movie-src-a',
    sourceId: 'source-a',
    sourcePath: '/a/movie.mp4',
    name: 'Movie From Source A',
    kind: 'movie',
    runtime: 90,
    videoUrl: 'http://server-a.bdix/movie.mp4',
    quality: ['HD'],
    genres: ['Drama'],
    moods: [],
    maturity: 'ALL',
    artwork: { source: 'none' },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  const sourceBMovie: Movie = {
    id: 'movie-src-b',
    sourceId: 'source-b',
    sourcePath: '/b/movie.mp4',
    name: 'Movie From Source B',
    kind: 'movie',
    runtime: 90,
    videoUrl: 'http://server-b.bdix/movie.mp4',
    quality: ['HD'],
    genres: ['Comedy'],
    moods: [],
    maturity: 'ALL',
    artwork: { source: 'none' },
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.saveItems([sourceAMovie, sourceBMovie]);

  // Mark source-a offline
  const affected = await repo.markSourceOffline('source-a');
  assert.equal(affected, 1);

  // Only verified items are returned in find()
  const activeItems = await repo.find({ verifiedOnly: true });
  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].id, 'movie-src-b');
});

test('Integration 15: Security & Credential Redaction in UI Integration', () => {
  // FTP passwords in URLs must be masked before exposing to UI logs/models
  const rawUrl = 'ftp://admin:superSecretP@ss@192.168.1.10:21/videos/movie.mp4';
  const redacted = maskUrl(rawUrl);
  assert.ok(!redacted.includes('superSecretP@ss'));
  assert.ok(redacted.includes('***'));

  // Cloud metadata endpoint SSRF checks
  assert.throws(() => validateUrl('http://169.254.169.254/latest/meta-data'));
  assert.throws(() => validateUrl('http://metadata.google.internal/computeMetadata'));
  assert.doesNotThrow(() => validateUrl('http://103.151.60.162:8080/movies/video.mp4'));
});
