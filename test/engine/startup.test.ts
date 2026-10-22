import test from 'node:test';
import assert from 'node:assert';
import { CatalogService, SafeAsyncStorageDriver } from '../../src/engine/service/catalog-service';
import { RuleBasedContentClassifier } from '../../src/engine/classifier/rule-based-content-classifier';
import { RuleBasedFilenameParser } from '../../src/engine/parser/rule-based-filename-parser';
import { GENRES } from '../../src/data/mock';
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
