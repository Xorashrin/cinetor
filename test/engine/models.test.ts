import test from 'node:test';
import assert from 'node:assert';
import {
  isMovie,
  isSeries,
  type Artwork,
  type ContentItem,
  type Episode,
  type Movie,
  type Season,
  type Series,
} from '../../src/engine/models/content';
import {
  CancellationError,
  EngineError,
  EngineErrorCode,
  LimitExceededError,
  NetworkError,
  ParseError,
  TimeoutError,
} from '../../src/engine/models/errors';
import type { MediaSource } from '../../src/engine/models/source';
import type { ScanJob } from '../../src/engine/models/scan';

test('Models - ContentItem, Movie and Series Type Guards', () => {
  const artwork: Artwork = {
    posterUrl: 'http://example.com/poster.jpg',
    source: 'remote',
  };

  const movie: Movie = {
    id: 'cin_m_interstellar_2014_12345678',
    sourceId: 'src_bdix_1',
    sourcePath: 'movies/Interstellar.2014.mkv',
    name: 'Interstellar',
    kind: 'movie',
    year: 2014,
    maturity: '13+',
    genres: ['Sci-Fi', 'Adventure'],
    moods: ['Mind-Bending', 'Visually Striking'],
    artwork,
    quality: ['HD', '5.1'],
    runtime: 169,
    videoUrl: 'http://example.com/movies/Interstellar.2014.mkv',
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  const episode: Episode = {
    id: 'cin_s_arcane_2021_abc_s01e01',
    seriesId: 'cin_s_arcane_2021_abc',
    seasonNumber: 1,
    episodeNumber: 1,
    name: 'Welcome to the Playground',
    runtime: 42,
    videoUrl: 'http://example.com/arcane/s01e01.mp4',
    sourcePath: 'tv/Arcane/Season 1/S01E01.mp4',
  };

  const season: Season = {
    seasonNumber: 1,
    episodes: [episode],
  };

  const series: Series = {
    id: 'cin_s_arcane_2021_abc',
    sourceId: 'src_bdix_1',
    sourcePath: 'tv/Arcane',
    name: 'Arcane',
    kind: 'series',
    year: 2021,
    maturity: '16+',
    genres: ['Animation', 'Sci-Fi', 'Action'],
    moods: ['Dark', 'Stylized'],
    artwork,
    quality: ['4K', 'HDR', '5.1'],
    seasons: [season],
    totalEpisodes: 1,
    totalSeasons: 1,
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  assert.strictEqual(isMovie(movie), true);
  assert.strictEqual(isSeries(movie), false);
  assert.strictEqual(isSeries(series), true);
  assert.strictEqual(isMovie(series), false);
  assert.strictEqual(movie.runtime, 169);
  assert.strictEqual(series.seasons[0].episodes[0].name, 'Welcome to the Playground');
});

test('Models - MediaSource and ScanJob interfaces', () => {
  const source: MediaSource = {
    id: 'src_local_bdix_01',
    name: 'Local BDIX Mirror',
    baseUrl: 'http://172.16.50.2/media',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 10,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const job: ScanJob = {
    id: 'job_src_local_123',
    sourceId: source.id,
    status: 'running',
    startedAt: Date.now(),
    progress: {
      directoriesVisited: 5,
      filesDiscovered: 42,
      itemsParsed: 20,
      itemsAdded: 15,
      itemsUpdated: 5,
    },
    limits: {
      maxDepth: 4,
      maxItems: 500,
      timeoutMs: 30000,
    },
    errors: [],
  };

  assert.strictEqual(source.id, 'src_local_bdix_01');
  assert.strictEqual(source.enabled, true);
  assert.strictEqual(job.progress.itemsParsed, 20);
});

test('Models - Structured Engine Errors', () => {
  const generic = new EngineError('Base error', EngineErrorCode.UNKNOWN, { foo: 'bar' });
  const network = new NetworkError('Connection reset', { host: 'bdix.example' });
  const timeout = new TimeoutError('Probe timed out after 5000ms');
  const cancelled = new CancellationError();
  const parse = new ParseError('Failed to parse HTML directory');
  const limit = new LimitExceededError('Max depth reached');

  assert.strictEqual(generic.code, EngineErrorCode.UNKNOWN);
  assert.strictEqual(generic.details?.foo, 'bar');

  assert.strictEqual(network.code, EngineErrorCode.NETWORK_ERROR);
  assert.strictEqual(network.name, 'NetworkError');

  assert.strictEqual(timeout.code, EngineErrorCode.TIMEOUT);
  assert.strictEqual(timeout.name, 'TimeoutError');

  assert.strictEqual(cancelled.code, EngineErrorCode.CANCELLED);
  assert.strictEqual(cancelled.name, 'CancellationError');

  assert.strictEqual(parse.code, EngineErrorCode.PARSE_ERROR);
  assert.strictEqual(limit.code, EngineErrorCode.LIMIT_EXCEEDED);
});
