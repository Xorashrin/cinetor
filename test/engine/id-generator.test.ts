import test from 'node:test';
import assert from 'node:assert';
import {
  generateContentId,
  generateEpisodeId,
  generateScanJobId,
  generateSourceId,
  normalizeTitleKey,
} from '../../src/engine/id/id-generator';

test('ID Generator - Deterministic Content IDs', () => {
  const id1 = generateContentId('movie', 'The Dark Knight', 2008);
  const id2 = generateContentId('movie', 'The Dark Knight', 2008);
  const id3 = generateContentId('movie', 'the  dark   knight', 2008);

  // Exact same input produces identical IDs
  assert.strictEqual(id1, id2);
  // Case and whitespace variations normalize to identical ID
  assert.strictEqual(id1, id3);
  assert.match(id1, /^cin_m_the_dark_knight_2008_[0-9a-f]{8}$/);

  // Different year produces different ID
  const idDifferentYear = generateContentId('movie', 'The Dark Knight', 2012);
  assert.notStrictEqual(id1, idDifferentYear);

  // Series prefix
  const seriesId = generateContentId('series', 'Stranger Things', 2016);
  assert.match(seriesId, /^cin_s_stranger_things_2016_[0-9a-f]{8}$/);
});

test('ID Generator - Episode ID Determinism & Zero Padding', () => {
  const seriesId = 'cin_s_breaking_bad_2008_abc12345';
  const ep1 = generateEpisodeId(seriesId, 1, 5);
  const ep2 = generateEpisodeId(seriesId, 1, 5);
  const ep10 = generateEpisodeId(seriesId, 2, 13);

  assert.strictEqual(ep1, ep2);
  assert.strictEqual(ep1, 'cin_s_breaking_bad_2008_abc12345_s01e05');
  assert.strictEqual(ep10, 'cin_s_breaking_bad_2008_abc12345_s02e13');
});

test('ID Generator - Source ID Generation', () => {
  const src1 = generateSourceId('http://bdix.local/movies/');
  const src2 = generateSourceId('http://bdix.local/movies');
  const srcHttps = generateSourceId('https://bdix.local/movies');

  // Trailing slash handled uniformly
  assert.strictEqual(src1, src2);
  assert.strictEqual(src1, 'src_bdix_local_movies_b507ca3f');
  // Different protocol produces different hash
  assert.notStrictEqual(src1, srcHttps);
});

test('ID Generator - Title Normalization with Diacritics and Symbols', () => {
  const norm1 = normalizeTitleKey('Amélie (2001)!');
  const norm2 = normalizeTitleKey('amelie 2001');

  assert.strictEqual(norm1, 'amelie 2001');
  assert.strictEqual(norm2, 'amelie 2001');
});

test('ID Generator - Scan Job ID Format', () => {
  const jobId = generateScanJobId('src_bdix_main');
  assert.match(jobId, /^job_src_bdix_mai_[0-9a-z]+_[0-9a-f]{4}$/);
});
