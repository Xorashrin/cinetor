import test from 'node:test';
import assert from 'node:assert';
import { InMemoryCatalogRepository } from '../../src/engine/repository/in-memory-catalog-repository';
import type { Movie, Series } from '../../src/engine/models/content';

test('CatalogRepository - CRUD and Queries', async () => {
  const repo = new InMemoryCatalogRepository();

  const movie1: Movie = {
    id: 'cin_m_interstellar_2014_abc',
    sourceId: 'src_1',
    sourcePath: 'Interstellar.2014.mkv',
    name: 'Interstellar',
    kind: 'movie',
    year: 2014,
    maturity: '13+',
    genres: ['Sci-Fi', 'Adventure'],
    moods: ['Mind-Bending'],
    artwork: { source: 'none' },
    quality: ['HD', '5.1'],
    runtime: 169,
    videoUrl: 'http://example.com/interstellar.mkv',
    discoveredAt: 1000,
    updatedAt: 1000,
  };

  const movie2: Movie = {
    id: 'cin_m_dune_2021_def',
    sourceId: 'src_1',
    sourcePath: 'Dune.2021.mkv',
    name: 'Dune: Part One',
    kind: 'movie',
    year: 2021,
    maturity: '13+',
    genres: ['Sci-Fi', 'Action'],
    moods: ['Epic'],
    artwork: { source: 'none' },
    quality: ['4K'],
    runtime: 155,
    videoUrl: 'http://example.com/dune.mkv',
    discoveredAt: 2000,
    updatedAt: 2000,
  };

  const series1: Series = {
    id: 'cin_s_arcane_2021_ghi',
    sourceId: 'src_2',
    sourcePath: 'Arcane',
    name: 'Arcane',
    kind: 'series',
    year: 2021,
    maturity: '16+',
    genres: ['Anime', 'Action', 'Sci-Fi'],
    moods: ['Dark'],
    artwork: { source: 'none' },
    quality: ['HD'],
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            id: 'cin_s_arcane_2021_ghi_s01e01',
            seriesId: 'cin_s_arcane_2021_ghi',
            seasonNumber: 1,
            episodeNumber: 1,
            name: 'Episode 1',
            runtime: 40,
            videoUrl: 'http://example.com/arcane/s01e01.mp4',
            sourcePath: 'Arcane/S01E01.mp4',
          },
        ],
      },
    ],
    totalEpisodes: 1,
    totalSeasons: 1,
    discoveredAt: 3000,
    updatedAt: 3000,
  };

  await repo.saveItems([movie1, movie2, series1]);

  // getItem
  const fetched = await repo.getItem('cin_m_interstellar_2014_abc');
  assert.strictEqual(fetched?.name, 'Interstellar');

  // getMovie / getSeries type-checked getters
  const m = await repo.getMovie('cin_m_dune_2021_def');
  assert.strictEqual(m?.kind, 'movie');
  const s = await repo.getSeries('cin_s_arcane_2021_ghi');
  assert.strictEqual(s?.kind, 'series');

  // find by kind
  const movies = await repo.find({ kind: 'movie' });
  assert.strictEqual(movies.length, 2);

  // find by genre
  const anime = await repo.find({ genres: ['Anime'] });
  assert.strictEqual(anime.length, 1);
  assert.strictEqual(anime[0].name, 'Arcane');

  // search
  const searchResults = await repo.search('dune');
  assert.strictEqual(searchResults.length, 1);
  assert.strictEqual(searchResults[0].name, 'Dune: Part One');

  // stats
  const stats = await repo.getStats();
  assert.strictEqual(stats.totalItems, 3);
  assert.strictEqual(stats.moviesCount, 2);
  assert.strictEqual(stats.seriesCount, 1);
  assert.strictEqual(stats.episodesCount, 1);
  assert.strictEqual(stats.sourcesCount, 2);

  // removeBySource
  const removed = await repo.removeBySource('src_1');
  assert.strictEqual(removed, 2);
  const remaining = await repo.find();
  assert.strictEqual(remaining.length, 1);
});
