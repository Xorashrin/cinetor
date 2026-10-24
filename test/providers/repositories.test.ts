import assert from 'node:assert/strict';
import test from 'node:test';
import { RepositoryStore, parseRepositoryDocument, repositoryUrl, type RepositoryDocument } from '../../src/providers/repositories';

const hash = 'a'.repeat(64);
const document = (value: unknown, url = 'https://repository.example/repo.json'): RepositoryDocument => {
  const bodyText = JSON.stringify(value);
  return { url, bodyText, byteLength: Buffer.byteLength(bodyText), sha256: hash };
};
const storage = () => {
  const rows = new Map<string, string>();
  return { rows, async getItem(key: string) { return rows.get(key) ?? null; }, async setItem(key: string, value: string) { rows.set(key, value); } };
};
test('repository metadata cannot admit executable artifacts or promote publisher hashes', () => {
  const parsed = parseRepositoryDocument('cloudstream', document([{ name: 'Owned fixture', internalName: 'fixture', version: 1, url: './fixture.cs3', sha256: hash, status: 1 }, { name: 'Disabled fixture', url: './disabled.cs3', status: 0 }]));
  assert.equal(parsed.entries[0].status, 'quarantined');
  assert.equal(parsed.entries[0].artifactUrl, 'https://repository.example/fixture.cs3');
  assert.equal(parsed.entries[0].claimedSha256, hash);
  assert.equal(parsed.entries[1].status, 'publisher-disabled');
  assert.deepEqual(parsed.indexes, []);
});
test('repository addresses reject private literals, credentials, queries, fragments, and nonstandard ports', () => {
  for (const url of ['http://repository.example/repo.json', 'https://127.0.0.1/repo.json', 'https://user:secret@repository.example/repo.json', 'https://repository.example/repo.json?token=secret', 'https://repository.example/repo.json#token', 'https://repository.example:8443/repo.json']) assert.throws(() => repositoryUrl(url));
  const entry = parseRepositoryDocument('nuvio', document({ providers: [{ id: 'fixture', name: 'Fixture', url: 'https://repository.example/fixture.js?token=secret' }] })).entries[0];
  assert.equal(entry.status, 'invalid'); assert.equal(entry.artifactUrl, undefined);
  assert.equal(JSON.stringify(entry).includes('secret'), false);
});
test('descriptor traversal is explicit, bounded, and never follows executable entry URLs', async () => {
  const requests: string[] = [];
  const saved = storage();
  const store = new RepositoryStore(saved, async url => {
    requests.push(url);
    return url.endsWith('repo.json') ? document({ pluginLists: ['./plugins.json'] }) : document([{ name: 'Fixture', url: './fixture.cs3' }], url);
  });
  await store.load(); await store.add({ name: 'Review queue', engine: 'cloudstream', url: 'https://repository.example/repo.json' });
  assert.deepEqual(requests, []);
  const id = store.getSnapshot().repositories[0].id;
  await store.refresh(id);
  assert.deepEqual(requests, ['https://repository.example/repo.json', 'https://repository.example/plugins.json']);
  const record = store.getSnapshot().repositories[0];
  assert.equal(record.state, 'quarantined'); assert.equal(record.documents.length, 2); assert.equal(record.entries[0].status, 'quarantined');
  assert.equal(record.changes?.added, 1);
  assert.throws(() => parseRepositoryDocument('cloudstream', document({ pluginLists: Array.from({ length: 5 }, (_, i) => `https://repository.example/${i}.json`) })), { code: 'size' });
});
test('failed refresh retains inventory, cancellation discards late work, and malformed storage stays untouched', async () => {
  let fail = false;
  const saved = storage();
  const store = new RepositoryStore(saved, async () => {
    if (fail) throw new Error('network');
    return document([{ name: 'Fixture', url: './fixture.js' }]);
  });
  await store.load(); await store.add({ name: 'Fixture repository', engine: 'nuvio', url: 'https://repository.example/repo.json' });
  const id = store.getSnapshot().repositories[0].id;
  await store.refresh(id); fail = true;
  await assert.rejects(store.refresh(id));
  assert.equal(store.getSnapshot().repositories[0].entries.length, 1);
  assert.equal(store.getSnapshot().repositories[0].state, 'error');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(store.refresh(id, abort.signal), { code: 'cancelled' });
  const poisoned = storage(); poisoned.rows.set('cinetor:repository-intake:v1', '{broken');
  const locked = new RepositoryStore(poisoned, async () => document([]));
  assert.equal(locked.ready, false);
  await assert.rejects(locked.load());
  assert.equal(locked.ready, false);
  await assert.rejects(locked.add({ name: 'Cannot overwrite', engine: 'nuvio', url: 'https://repository.example/repo.json' }), { code: 'storage' });
  assert.equal(poisoned.rows.get('cinetor:repository-intake:v1'), '{broken');
});
