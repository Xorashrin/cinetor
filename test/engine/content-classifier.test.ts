import test from 'node:test';
import assert from 'node:assert';
import { RuleBasedContentClassifier } from '../../src/engine/classifier/rule-based-content-classifier';
import { RuleBasedFilenameParser } from '../../src/engine/parser/rule-based-filename-parser';

test('ContentClassifier - Anime Classification', () => {
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();

  const parsed = parser.parse('Attack on Titan S04E12 1080p.mkv');
  const result = classifier.classify(parsed, ['Anime', 'Attack on Titan', 'Season 4']);

  assert.strictEqual(result.kind, 'series');
  assert.ok(result.genres.includes('Anime'));
  assert.ok(result.genres.includes('Action'));
  assert.strictEqual(result.maturity, '13+');
});

test('ContentClassifier - K-Drama Classification', () => {
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();

  const parsed = parser.parse('Crash.Landing.on.You.S01E01.720p.mkv');
  const result = classifier.classify(parsed, ['K-Drama', 'Crash Landing on You']);

  assert.strictEqual(result.kind, 'series');
  assert.ok(result.genres.includes('K-Drama'));
  assert.ok(result.genres.includes('Romance'));
});

test('ContentClassifier - Kids and Cartoon Classification', () => {
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();

  const parsed = parser.parse('Peppa Pig Cartoon Special.mp4');
  const result = classifier.classify(parsed, ['Kids', 'Animation']);

  assert.ok(result.genres.includes('Kids'));
  assert.strictEqual(result.maturity, 'ALL');
});

test('ContentClassifier - Adult Content 18+ Maturity Rating', () => {
  const parser = new RuleBasedFilenameParser();
  const classifier = new RuleBasedContentClassifier();

  const parsed = parser.parse('Late Night Romance 18+ Uncensored.mp4');
  const result = classifier.classify(parsed, ['Adult']);

  assert.strictEqual(result.maturity, '18+');
});
