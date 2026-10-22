import test from 'node:test';
import assert from 'node:assert';
import { RuleBasedFilenameParser } from '../../src/engine/parser/rule-based-filename-parser';

test('FilenameParser - Standard Movie Parsing', () => {
  const parser = new RuleBasedFilenameParser();
  const result = parser.parse('Inception.2010.1080p.BluRay.x264.mkv');

  assert.strictEqual(result.title, 'Inception');
  assert.strictEqual(result.year, 2010);
  assert.strictEqual(result.isEpisodic, false);
  assert.strictEqual(result.resolution, '1080p');
  assert.strictEqual(result.container, 'mkv');
  assert.strictEqual(result.videoCodec, 'x264');
  assert.strictEqual(result.sourceType, 'BLURAY');
  assert.ok(result.quality.includes('HD'));
});

test('FilenameParser - 4K UHD HDR 5.1 Movie Parsing', () => {
  const parser = new RuleBasedFilenameParser();
  const result = parser.parse('Oppenheimer (2023) [2160p] [4K] [HDR] [5.1].mp4');

  assert.strictEqual(result.title, 'Oppenheimer');
  assert.strictEqual(result.year, 2023);
  assert.strictEqual(result.resolution, '4K');
  assert.strictEqual(result.container, 'mp4');
  assert.ok(result.quality.includes('4K'));
  assert.ok(result.quality.includes('HDR'));
  assert.ok(result.quality.includes('5.1'));
});

test('FilenameParser - Standard TV Episodic Parsing (S01E02)', () => {
  const parser = new RuleBasedFilenameParser();
  const result = parser.parse('Breaking.Bad.S01E02.720p.HDTV.x264.mkv');

  assert.strictEqual(result.title, 'Breaking Bad');
  assert.strictEqual(result.isEpisodic, true);
  assert.strictEqual(result.seasonNumber, 1);
  assert.strictEqual(result.episodeNumber, 2);
  assert.strictEqual(result.resolution, '720p');
});

test('FilenameParser - Multi-Episode File (S01E01-E03)', () => {
  const parser = new RuleBasedFilenameParser();
  const result = parser.parse('Sherlock.S01E01-E03.1080p.mkv');

  assert.strictEqual(result.title, 'Sherlock');
  assert.strictEqual(result.isEpisodic, true);
  assert.strictEqual(result.seasonNumber, 1);
  assert.strictEqual(result.episodeNumber, 1);
  assert.deepStrictEqual(result.episodeNumbers, [1, 2, 3]);
});

test('FilenameParser - Fallback to Parent Folder when filename is just S02E05.mkv', () => {
  const parser = new RuleBasedFilenameParser();
  const result = parser.parse('Stranger Things/Season 02/S02E05.mkv');

  assert.strictEqual(result.title, 'Stranger Things');
  assert.strictEqual(result.isEpisodic, true);
  assert.strictEqual(result.seasonNumber, 2);
  assert.strictEqual(result.episodeNumber, 5);
});
