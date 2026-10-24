import assert from 'node:assert/strict';
import test from 'node:test';
import { removeOwnedDownload } from '../../src/state/downloadRemoval';
import type { NativeDownload } from '../../modules/cinetor-media/src/download-client';

const key = 'main:tmdb:movie:810';
const legacy = 'file:///private/downloads/legacy.mp4';
const record: NativeDownload = { key, id: '01234567-89ab-4cde-8fab-0123456789ab', status: 'downloaded', container: 'mp4', bytesDownloaded: 16, totalBytes: 16, progress: 1, updatedAt: 1, restartRequired: false };
function fixture(current: NativeDownload | null) {
  const calls: string[] = [];
  const native = {
    async query(value: string) { calls.push(`query:${value}`); return current; },
    async delete(value: string) { calls.push(`delete:${value}`); },
    async deleteLocalFile(uri: string) { calls.push(`file:${uri}`); },
  };
  return { calls, native };
}
test('native download deletion never follows with a second file deletion', async () => {
  const f = fixture(record);
  await removeOwnedDownload(key, legacy, f.native);
  assert.deepEqual(f.calls, [`query:${key}`, `delete:${key}`]);
});
test('legacy file deletion uses native path validation only when no native record exists', async () => {
  const f = fixture(null);
  await removeOwnedDownload(key, legacy, f.native);
  assert.deepEqual(f.calls, [`query:${key}`, `file:${legacy}`]);
});
test('metadata-only and stale offline capabilities do not trigger arbitrary file deletion', async () => {
  for (const uri of [undefined, `cinetor-offline://download/${record.id}`, 'https://media.example/movie.mp4']) {
    const f = fixture(null);
    await removeOwnedDownload(key, uri, f.native);
    assert.deepEqual(f.calls, [`query:${key}`]);
  }
});
test('query or native deletion failures propagate without trying a second deletion path', async () => {
  for (const operation of ['query', 'delete'] as const) {
    const f = fixture(record);
    f.native[operation] = async () => { throw new Error('fixture deletion failure'); };
    await assert.rejects(removeOwnedDownload(key, legacy, f.native), /fixture deletion failure/);
    assert.equal(f.calls.some(value => value.startsWith('file:')), false);
  }
});
