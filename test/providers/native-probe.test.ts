import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNativeProbe, type NativeMediaProbeResult } from '../../src/providers/nativeProbeValidation';
import type { PlaybackSourceRef } from '../../src/data/mock';

const source: PlaybackSourceRef = { url: 'https://media.example/movie.mp4', container: 'mp4', downloadable: true, representationId: 'f'.repeat(64) };
const bytes = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
const result: NativeMediaProbeResult = { statusCode: 206, url: source.url, headers: { 'Content-Range': 'bytes 0-15/1024' }, bodyBase64: bytes.toString('base64'), bodyText: '', byteLength: bytes.length, kind: 'prefix', representationId: 'a'.repeat(64) };

test('native probe replaces provider identity with native representation evidence, never decoder proof', () => {
  const checked = validateNativeProbe(source, result);
  assert.equal(checked.representationId, result.representationId);
  assert.equal(checked.verificationState, 'transport-verified');
  assert.equal(checked.fileSizeBytes, 1024);
  assert.equal(checked.headerOrigin, 'https://media.example');
});
test('native probe rejects missing digest, private redirects, and mismatched range bytes', () => {
  for (const representationId of [undefined, 'b'.repeat(63), 'native-token']) assert.throws(() => validateNativeProbe(source, { ...result, representationId }), { code: 'malformed' });
  assert.throws(() => validateNativeProbe(source, { ...result, url: 'https://127.0.0.1/file.mp4' }), { code: 'scope' });
  assert.throws(() => validateNativeProbe(source, { ...result, headers: { 'content-range': 'bytes 0-20/1024' } }), { code: 'malformed' });
  assert.throws(() => validateNativeProbe(source, { ...result, bodyBase64: 'not base64' }), { code: 'malformed' });
});
const manifest = (bodyText: string): NativeMediaProbeResult => ({ ...result, statusCode: 200, kind: 'manifest', bodyText, bodyBase64: '', byteLength: Buffer.byteLength(bodyText), headers: {} });
test('manifest evidence preserves native representation and permits finite non-DRM HLS candidates', () => {
  const hls = { ...source, container: 'hls' };
  for (const key of ['', '#EXT-X-KEY:METHOD=NONE\n', '#EXT-X-KEY:METHOD=AES-128,URI="key"\n', '#EXT-X-KEY:URI="key",METHOD=AES-128\n', '#EXT-X-KEY:KEYFORMAT="identity",URI="key",METHOD=AES-128\n']) {
    const checked = validateNativeProbe(hls, manifest(`#EXTM3U\n${key}#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST\n`));
    assert.equal(checked.representationId, result.representationId);
    assert.equal(checked.verificationState, 'manifest-verified');
    assert.equal(checked.downloadable, true);
  }
  const master = validateNativeProbe(hls, manifest('#EXTM3U\n#EXT-X-SESSION-KEY:URI="key",METHOD=AES-128,KEYFORMAT="identity"\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nchild.m3u8\n'));
  assert.equal(master.downloadable, true);
  const live = validateNativeProbe(hls, manifest('#EXTM3U\n#EXTINF:2,\nsegment.ts\n'));
  assert.equal(live.downloadable, false);
  const steered = validateNativeProbe(hls, manifest('#EXTM3U\n#EXT-X-CONTENT-STEERING:SERVER-URI="steering.json"\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nchild.m3u8\n'));
  assert.equal(steered.downloadable, false);
  const disabled = validateNativeProbe({ ...hls, downloadable: false }, manifest('#EXTM3U\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST\n'));
  assert.equal(disabled.downloadable, false);
  const dynamic = validateNativeProbe({ ...source, container: 'dash' }, manifest('<MPD type="dynamic"></MPD>'));
  assert.equal(dynamic.downloadable, false);
});
test('native HLS probe rejects DRM, missing key URIs, duplicate attributes, and malformed key declarations', () => {
  for (const key of ['METHOD=SAMPLE-AES,URI="key"', 'KEYFORMAT="com.example.drm",METHOD=AES-128,URI="key"', 'METHOD=AES-128', 'URI="key"', 'METHOD=AES-128,METHOD=NONE,URI="key"', 'METHOD=AES-128,,URI="key"', 'METHOD=AES-128,URI="key",', 'METHOD=NONE,URI="key"']) {
    assert.throws(() => validateNativeProbe({ ...source, container: 'hls' }, manifest(`#EXTM3U\n#EXT-X-KEY:${key}\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST\n`)), { code: 'unsupported' });
  }
  assert.throws(() => validateNativeProbe({ ...source, container: 'hls' }, manifest('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=NONE\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nchild.m3u8\n')), { code: 'unsupported' });
});
test('Matroska and WebM stay online-only even when a provider advertises download support', () => {
  const body = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  for (const container of ['mkv', 'webm']) {
    const checked = validateNativeProbe({ ...source, container }, { ...result, byteLength: 4, bodyBase64: body.toString('base64'), headers: { 'content-range': 'bytes 0-3/1024' } });
    assert.equal(checked.downloadable, false);
  }
});
