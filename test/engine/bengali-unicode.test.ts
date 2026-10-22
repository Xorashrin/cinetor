import test from 'node:test';
import assert from 'node:assert';
import { RuleBasedFilenameParser } from '../../src/engine/parser/rule-based-filename-parser';
import { RuleBasedContentClassifier } from '../../src/engine/classifier/rule-based-content-classifier';

test('Bengali & Unicode - Movie Filename Parsing', () => {
  const parser = new RuleBasedFilenameParser();

  // Pure Bengali title with year
  const result1 = parser.parse('তুফান (2024).mp4');
  assert.strictEqual(result1.title, 'তুফান');
  assert.strictEqual(result1.year, 2024);
  assert.strictEqual(result1.originalFilename, 'তুফান (2024).mp4');
  assert.strictEqual(result1.isEpisodic, false);

  // Mixed Bengali-English title
  const result2 = parser.parse('হাওয়া (2022) Hawa 1080p WebRip.mkv');
  assert.ok(result2.title.includes('হাওয়া'));
  assert.ok(result2.title.includes('Hawa'));
  assert.strictEqual(result2.year, 2022);
  assert.strictEqual(result2.resolution, '1080p');
  assert.strictEqual(result2.sourceType, 'WEBRIP');
});

test('Bengali & Unicode - Episodic Series Parsing', () => {
  const parser = new RuleBasedFilenameParser();

  // Bengali series with S01E01 and Dual Audio
  const result = parser.parse('কারাগার.Karagar.S01E01.720p.WEB-DL.[Bangla+Hindi.Dual.Audio].mkv');
  assert.ok(result.title.includes('কারাগার'));
  assert.ok(result.title.includes('Karagar'));
  assert.strictEqual(result.isEpisodic, true);
  assert.strictEqual(result.seasonNumber, 1);
  assert.strictEqual(result.episodeNumber, 1);
  assert.strictEqual(result.resolution, '720p');

  // Language tags recognized
  assert.ok(result.languages?.includes('Bangla'));
  assert.ok(result.languages?.includes('Hindi'));
  assert.ok(result.languages?.includes('Dual Audio'));
});

test('Bengali & Unicode - Series with Bengali Season and Episode notation', () => {
  const parser = new RuleBasedFilenameParser();

  const result = parser.parse('তকদীর পর্ব 03.mp4', 'তকদীর সিজন 1');
  assert.strictEqual(result.isEpisodic, true);
  assert.strictEqual(result.episodeNumber, 3);
  assert.strictEqual(result.seasonNumber, 1);
});

test('Bengali & Unicode - Cartoon Classification vs Anime Distinction', () => {
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();

  // Cartoon (Doraemon, Tom and Jerry, etc.)
  const parsedCartoon = parser.parse('Doraemon Stand by Me (2014) [Bangla Dubbed].mp4');
  const cartoonClass = classifier.classify(parsedCartoon, ['Cartoons']);
  assert.ok(cartoonClass.genres.includes('Kids'));
  assert.strictEqual(cartoonClass.genres.includes('Anime'), false); // Must remain distinguishable!
  assert.strictEqual(cartoonClass.maturity, 'ALL');

  // Anime (Demon Slayer, etc.)
  const parsedAnime = parser.parse('Demon Slayer S03E01 1080p.mkv');
  const animeClass = classifier.classify(parsedAnime, ['Anime']);
  assert.ok(animeClass.genres.includes('Anime'));
  assert.strictEqual(animeClass.genres.includes('Kids'), false);
  assert.strictEqual(animeClass.maturity, '13+');
});
