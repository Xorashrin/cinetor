import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createDownloadClient, downloadKey, isOfflineMediaUri,
  type NativeDownload, type NativeDownloads, type QueueDownload,
} from '../../modules/cinetor-media/src/download-client';

const id = '01234567-89ab-4cde-8fab-0123456789ab';
const offline = `cinetor-offline://download/${id}`;
const entry = (fields: Partial<NativeDownload> = {}): NativeDownload => ({
  key: 'profile:movie', id, status: 'queued', container: 'hls', bytesDownloaded: 0,
  totalBytes: null, progress: null, updatedAt: 1, restartRequired: false, ...fields,
});

function fixture() {
  const listeners = new Set<(value: NativeDownload) => void>();
  let current: NativeDownload | null = entry();
  let queueOptions: QueueDownload | undefined;
  const cancellations: string[] = [];
  const removedUris: string[] = [];
  const native: NativeDownloads = {
    getDownloads: async () => current ? [current] : [],
    query: async () => current,
    queue: async options => { queueOptions = options; return current!; },
    restart: async () => current!,
    pause: async () => current,
    cancel: async key => { cancellations.push(key); },
    cancelAttempt: async (key, attempt) => { if (current?.id === attempt) cancellations.push(key); },
    delete: async () => undefined,
    deleteLocalFile: async uri => { removedUris.push(uri); },
    getStorageInfo: async () => ({ freeBytes: 512, totalBytes: 1024, usedBytes: 256, reservedBytes: 128 }),
    getCapabilities: async () => ({ available: true, platform: 'android', maxParallelDownloads: 2, perHostLimit: 1, notificationsAllowed: false }),
    setDownloadPolicy: async () => undefined,
    addListener: (_name, listener) => {
      listeners.add(listener);
      return { remove: () => { listeners.delete(listener); } };
    },
  };
  return {
    native, listeners, cancellations, removedUris,
    options: () => queueOptions,
    emit(value: NativeDownload) { current = value; listeners.forEach(listener => listener(value)); },
    set(value: NativeDownload | null) { current = value; },
  };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test('download keys are profile-qualified without treating content identifiers as paths', () => {
  assert.equal(downloadKey('title', 'episode', 'profile'), 'profile:episode');
  assert.equal(downloadKey('title', undefined, 'other'), 'other:title');
  assert.equal(downloadKey('title'), 'default:title');
  assert.equal(isOfflineMediaUri(offline), true);
  assert.equal(isOfflineMediaUri(`${offline}?url=https://example.test`), false);
  assert.equal(isOfflineMediaUri('file:///other.mp4'), false);
});

test('download bridge forwards resolved source credentials and original header origin, without JS transfers', async () => {
  const f = fixture();
  const client = createDownloadClient(() => f.native);
  const progress: number[] = [];
  const promise = client.downloadVideo('profile:movie', 'https://cdn.example.test/media', value => progress.push(value),
    { Authorization: 'fixture-only' }, undefined, 'hls', 'https://origin.example.test');
  await tick();
  assert.deepEqual(f.options(), {
    key: 'profile:movie', url: 'https://cdn.example.test/media', headers: { Authorization: 'fixture-only' },
    container: 'hls', headerOrigin: 'https://origin.example.test',
  });
  assert.deepEqual(progress, []);
  f.emit(entry({ status: 'downloading', bytesDownloaded: 100, progress: null, updatedAt: 2 }));
  assert.deepEqual(progress, [], 'unknown lengths must not invent a percentage');
  f.emit(entry({ status: 'downloading', progress: 0.5, updatedAt: 3 }));
  f.emit(entry({ status: 'downloaded', progress: 1, localUri: offline, sizeMB: 8, updatedAt: 4 }));
  assert.deepEqual(await promise, { localUri: offline, sizeMB: 8, savedToDevice: false });
  assert.deepEqual(progress, [0.5, 1]);
  assert.equal(f.listeners.size, 0);
  assert.equal(client.isActive('profile:movie'), false);
});

test('fast completion before queue acknowledgement is retained and listeners are released', async () => {
  const f = fixture();
  f.native.queue = async () => {
    f.emit(entry({ status: 'downloaded', localUri: offline, sizeMB: 2, progress: 1, updatedAt: 3 }));
    return entry();
  };
  const client = createDownloadClient(() => f.native);
  assert.equal((await client.downloadVideo('profile:movie', 'https://example.test/movie.m3u8', () => undefined)).localUri, offline);
  assert.equal(f.listeners.size, 0);
});

test('completed status alone is not a playable verified result', async () => {
  const f = fixture();
  f.set(entry({ status: 'downloaded', progress: 1 }));
  await assert.rejects(createDownloadClient(() => f.native).downloadVideo('profile:movie', 'https://example.test/movie.mp4', () => undefined), /verified offline media/);
  assert.equal(f.listeners.size, 0);
});

test('abort before queue sends no work; abort during queue cancels after acknowledgement', async () => {
  const first = fixture();
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(createDownloadClient(() => first.native).downloadVideo('profile:movie', 'https://example.test/movie.mp4', () => undefined, {}, alreadyAborted.signal), { name: 'AbortError' });
  assert.equal(first.options(), undefined);
  const f = fixture();
  let acknowledge!: (value: NativeDownload) => void;
  f.native.queue = () => new Promise(resolve => { acknowledge = resolve; });
  const controller = new AbortController();
  const waiting = createDownloadClient(() => f.native).downloadVideo('profile:movie', 'https://example.test/movie.mp4', () => undefined, {}, controller.signal);
  controller.abort();
  assert.deepEqual(f.cancellations, []);
  acknowledge(entry());
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.deepEqual(f.cancellations, ['profile:movie']);
  assert.equal(f.listeners.size, 0);
});

test('stale progress, removal, and cancellation cannot affect a replacement attempt', async () => {
  const f = fixture();
  const client = createDownloadClient(() => f.native);
  const progress: number[] = [];
  const waiting = client.downloadVideo('profile:movie', 'https://example.test/movie.mp4', value => progress.push(value));
  await tick();
  f.emit(entry({ id: 'old-attempt', status: 'failed', removed: true, updatedAt: 0 }));
  f.emit(entry({ id: 'old-attempt', status: 'downloaded', localUri: offline, sizeMB: 99, updatedAt: 0 }));
  assert.deepEqual(progress, []);
  f.emit(entry({ status: 'downloaded', localUri: offline, sizeMB: 1, updatedAt: 2 }));
  assert.equal((await waiting).sizeMB, 1);
});

test('pause is honest and restart can use a newly resolved source', async () => {
  const f = fixture();
  const client = createDownloadClient(() => f.native);
  const waiting = client.downloadVideo('profile:movie', 'https://example.test/movie.mp4', () => undefined);
  await tick();
  f.emit(entry({ status: 'paused', restartRequired: true, updatedAt: 3 }));
  await assert.rejects(waiting, /Restart begins from zero/);
  let restarted: unknown;
  f.native.restart = async options => { restarted = options; return entry({ id: 'new-attempt' }); };
  await client.restartDownload('profile:movie', 'https://replacement.example.test/video.mpd', {}, 'dash', 'https://replacement.example.test');
  assert.deepEqual(restarted, { key: 'profile:movie', url: 'https://replacement.example.test/video.mpd', headers: {}, container: 'dash', headerOrigin: 'https://replacement.example.test' });
});

test('active restart settles the old waiter and preserves the replacement and its ownership', { timeout: 1000 }, async () => {
  const f = fixture();
  const client = createDownloadClient(() => f.native);
  const controller = new AbortController();
  const waiting = client.downloadVideo('profile:movie', 'https://example.test/movie.mp4', () => undefined, {}, controller.signal);
  const rejected = assert.rejects(waiting, { name: 'AbortError' });
  await tick();
  const replacementId = '12345678-9abc-4def-8abc-123456789abc';
  const replacement = entry({ id: replacementId, updatedAt: 3 });
  f.native.restart = async () => {
    // Native must emit the old UUID's terminal event before publishing its replacement.
    f.emit(entry({ status: 'failed', removed: true, errorCode: 'canceled', updatedAt: 3 }));
    f.emit(replacement);
    return replacement;
  };
  assert.equal((await client.restartDownload('profile:movie')).id, replacementId);
  controller.abort();
  await rejected;
  assert.equal(f.listeners.size, 0, 'the original waiter must release its native subscription');
  assert.equal(client.isActive('profile:movie'), false, 'the original active-key waiter must be released');
  assert.deepEqual(f.cancellations, [], 'a stale abort must not cancel the replacement');
  await f.native.cancelAttempt('profile:movie', id);
  assert.deepEqual(f.cancellations, [], 'native attempt ownership must reject an obsolete ID');
  assert.equal((await client.queryDownload('profile:movie'))?.id, replacementId);
  const replacementWaiting = client.downloadVideo('profile:movie', 'https://example.test/movie.mp4', () => undefined);
  await tick();
  f.emit(entry({ id: replacementId, status: 'downloaded', localUri: `cinetor-offline://download/${replacementId}`, sizeMB: 2, updatedAt: 4 }));
  assert.equal((await replacementWaiting).sizeMB, 2);
  assert.equal(f.listeners.size, 0);
});

test('native snapshots restore active state and native storage/delete policies stay authoritative', async () => {
  const f = fixture();
  f.set(entry({ status: 'downloading', bytesDownloaded: 11 }));
  const client = createDownloadClient(() => f.native);
  await client.getDownloads();
  assert.equal(client.isActive('profile:movie'), true);
  const updates: NativeDownload[] = [];
  const unsubscribe = client.subscribeDownloadUpdates(value => updates.push(value));
  f.emit(entry({ status: 'failed', removed: true, updatedAt: 5 }));
  assert.equal(client.isActive('profile:movie'), false);
  unsubscribe();
  assert.equal(updates.length, 1);
  assert.deepEqual(await client.getStorageInfo(), { freeBytes: 512, totalBytes: 1024, usedBytes: 256, reservedBytes: 128 });
  await client.deleteLocalFile(offline);
  assert.deepEqual(f.removedUris, [offline]);
  let policy: unknown;
  f.native.setDownloadPolicy = async value => { policy = value; };
  await client.setDownloadPolicy({ wifiOnly: false });
  assert.deepEqual(policy, { wifiOnly: false });
});

test('native security/lifecycle invariants are wired, not a JS HLS or simulated storage fallback', async () => {
  const root = new URL('../../modules/cinetor-media/', import.meta.url);
  const engine = await readFile(new URL('android/src/main/java/expo/modules/cinetormedia/MediaEngine.kt', root), 'utf8');
  const http = await readFile(new URL('android/src/main/java/expo/modules/cinetormedia/MediaHttp.kt', root), 'utf8');
  const view = await readFile(new URL('android/src/main/java/expo/modules/cinetormedia/OfflineVideoView.kt', root), 'utf8');
  const service = await readFile(new URL('android/src/main/java/expo/modules/cinetormedia/CinetorDownloadService.kt', root), 'utf8');
  const module = await readFile(new URL('android/src/main/java/expo/modules/cinetormedia/CinetorMediaModule.kt', root), 'utf8');
  const wrapper = await readFile(new URL('../../src/components/OfflineVideo.tsx', root), 'utf8');
  assert.match(wrapper, /requireNativeModule\('CinetorMedia'\);\s*NativeVideo = requireNativeViewManager/);
  assert.match(engine, /engine\.sessions\.remove\(id, source\)/);
  assert.match(engine, /emit\(previous, true\)[\s\S]*store\.records\[key\] = record/);
  assert.match(http, /MediaSafety\.validateRepresentation\(session\.download, ranged/);
  assert.match(http, /ManifestValidation\.hlsEncryptionKeyUris\(playlist\)/);
  assert.match(engine, /manager\.maxParallelDownloads = 2/);
  assert.match(engine, /manager\.minRetryCount = 0/);
  assert.match(engine, /setUpstreamDataSourceFactory\(null\)/);
  assert.match(engine, /DownloadHelper\.Factory\(\)/);
  assert.match(engine, /setTrackSelectionParameters\(DownloadHelper\.DEFAULT_TRACK_SELECTOR_PARAMETERS\)/);
  assert.match(engine, /STATE_STOPPED/);
  assert.match(http, /followRedirects\(false\)/);
  assert.match(http, /session\.rootOrigin/);
  assert.match(http, /header\("If-Range"/);
  assert.match(http, /result\.code != 206/);
  assert.match(http, /result\.code == 416/);
  assert.match(http, /socketFactory\(network\.socketFactory\)/);
  assert.match(http, /Semaphore\(1, true\)/);
  assert.doesNotMatch(module, /AsyncFunction\("register/);
  assert.match(view, /override fun onRenderedFirstFrame\(\)/);
  assert.match(view, /TrackSelectionOverride\(group\.mediaTrackGroup/);
  assert.match(service, /VISIBILITY_SECRET/);
  assert.doesNotMatch(service, /record\.key|record\.url|titleId|Authorization/);
});
