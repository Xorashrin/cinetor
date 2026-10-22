import test from 'node:test';
import assert from 'node:assert';
import {
  PersistentCatalogRepository,
  type StorageDriver,
} from '../../src/engine/repository/persistent-catalog-repository';
import type { Movie, Series } from '../../src/engine/models/content';

// Mock storage driver simulating disk / AsyncStorage
class MockStorageDriver implements StorageDriver {
  private store = new Map<string, string>();

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

test('Persistent Catalog - Multi-Source Deduplication and Alternative Playback Mirrors', async () => {
  const storage = new MockStorageDriver();
  const repo = new PersistentCatalogRepository(storage);

  // Movie from Primary Source 1
  const movieFromSource1: Movie = {
    id: 'cin_m_dune_2021_abc12345',
    sourceId: 'src_mirror_1',
    sourcePath: 'movies/Dune.2021.1080p.mkv',
    name: 'Dune',
    kind: 'movie',
    year: 2021,
    maturity: '13+',
    genres: ['Sci-Fi', 'Adventure'],
    moods: ['Epic'],
    artwork: { posterUrl: 'http://mirror1/dune.jpg', source: 'sidecar' },
    quality: ['HD', '5.1'],
    runtime: 155,
    videoUrl: 'http://mirror1/movies/Dune.2021.1080p.mkv',
    sources: [
      {
        sourceId: 'src_mirror_1',
        sourcePath: 'movies/Dune.2021.1080p.mkv',
        url: 'http://mirror1/movies/Dune.2021.1080p.mkv',
        verificationState: 'VERIFIED',
        container: 'mkv',
        lastVerifiedAt: 1000,
        consecutiveFailures: 0,
      },
    ],
    verificationState: 'VERIFIED',
    discoveredAt: 1000,
    updatedAt: 1000,
  };

  // Same Movie from Secondary Source 2 (e.g. higher resolution or backup mirror)
  const movieFromSource2: Movie = {
    id: 'cin_m_dune_2021_abc12345', // Identical deterministic ID
    sourceId: 'src_mirror_2',
    sourcePath: '4K/Dune.2021.2160p.mkv',
    name: 'Dune',
    kind: 'movie',
    year: 2021,
    maturity: '13+',
    genres: ['Sci-Fi', 'Action'],
    moods: ['Visually Striking'],
    artwork: { source: 'none' },
    quality: ['4K', 'HDR'],
    runtime: 155,
    videoUrl: 'http://mirror2/4K/Dune.2021.2160p.mkv',
    sources: [
      {
        sourceId: 'src_mirror_2',
        sourcePath: '4K/Dune.2021.2160p.mkv',
        url: 'http://mirror2/4K/Dune.2021.2160p.mkv',
        verificationState: 'VERIFIED',
        container: 'mkv',
        lastVerifiedAt: 2000,
        consecutiveFailures: 0,
      },
    ],
    verificationState: 'VERIFIED',
    discoveredAt: 2000,
    updatedAt: 2000,
  };

  await repo.saveItem(movieFromSource1);
  await repo.saveItem(movieFromSource2);

  // Verification: The movie is NOT duplicated into 2 cards
  const catalog = await repo.find();
  assert.strictEqual(catalog.length, 1);

  const merged = await repo.getMovie('cin_m_dune_2021_abc12345');
  assert.strictEqual(merged?.name, 'Dune');
  // Both sources are preserved for multi-source playback failover
  assert.strictEqual(merged?.sources?.length, 2);
  assert.ok(merged?.sources?.some((s) => s.sourceId === 'src_mirror_1'));
  assert.ok(merged?.sources?.some((s) => s.sourceId === 'src_mirror_2'));

  // Quality tags merged
  assert.ok(merged?.quality.includes('HD'));
  assert.ok(merged?.quality.includes('4K'));
});

test('Persistent Catalog - Storage Driver Flush and Recovery', async () => {
  const storage = new MockStorageDriver();
  const repo1 = new PersistentCatalogRepository(storage, 'test_key');

  const movie: Movie = {
    id: 'cin_m_avatar_2009_123',
    sourceId: 'src_1',
    sourcePath: 'Avatar.2009.mkv',
    name: 'Avatar',
    kind: 'movie',
    year: 2009,
    maturity: '13+',
    genres: ['Action', 'Sci-Fi'],
    moods: ['Imaginative'],
    artwork: { source: 'none' },
    quality: ['HD'],
    runtime: 162,
    videoUrl: 'http://test/avatar.mkv',
    verificationState: 'VERIFIED',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo1.saveItems([movie]);

  // Create a brand new repository instance with the same storage driver
  const repo2 = new PersistentCatalogRepository(storage, 'test_key');
  const loadedCount = await repo2.loadFromStorage();

  assert.strictEqual(loadedCount, 1);
  const recovered = await repo2.getMovie('cin_m_avatar_2009_123');
  assert.strictEqual(recovered?.name, 'Avatar');
  assert.strictEqual(recovered?.verificationState, 'VERIFIED');
});

test('Persistent Catalog - Source Offline Isolation', async () => {
  const repo = new PersistentCatalogRepository();

  const item1: Movie = {
    id: 'cin_m_source_a_2020',
    sourceId: 'src_healthy',
    sourcePath: 'movieA.mkv',
    name: 'Healthy Movie',
    kind: 'movie',
    maturity: '13+',
    genres: ['Action'],
    moods: ['Exciting'],
    artwork: { source: 'none' },
    quality: ['HD'],
    runtime: 100,
    videoUrl: 'http://healthy/movieA.mkv',
    verificationState: 'VERIFIED',
    discoveredAt: 1000,
    updatedAt: 1000,
  };

  const item2: Movie = {
    id: 'cin_m_source_b_2020',
    sourceId: 'src_offline',
    sourcePath: 'movieB.mkv',
    name: 'Offline Movie',
    kind: 'movie',
    maturity: '13+',
    genres: ['Drama'],
    moods: ['Emotional'],
    artwork: { source: 'none' },
    quality: ['HD'],
    runtime: 110,
    videoUrl: 'http://offline/movieB.mkv',
    verificationState: 'VERIFIED',
    discoveredAt: 1000,
    updatedAt: 1000,
  };

  await repo.saveItems([item1, item2]);

  // Mark src_offline as dead and purge its items
  const removedCount = await repo.removeBySource('src_offline');
  assert.strictEqual(removedCount, 1);

  // Healthy source content remains fully intact
  const remaining = await repo.find();
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].id, 'cin_m_source_a_2020');
});
