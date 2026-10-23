import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadResources, planOfflineHls } from '../../src/providers/offline';
import { ProviderHttp } from '../../src/providers/request';
import { EngineError } from '../../src/engine/model';

function playlists(rows: Record<string, string>): ProviderHttp {
  return new ProviderHttp(async input => {
    const value = rows[String(input)];
    return new Response(value ?? 'Missing', { status: value ? 200 : 404 });
  });
}
const finite = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n';

test('offline HLS packages highest quality, default audio, initialization segments, and keys locally', async () => {
  const http = playlists({
    'https://media.example/index.m3u8': '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="main",NAME="English",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="main"\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500,AUDIO="main",SUBTITLES="subs"\nhigh.m3u8\n',
    'https://media.example/high.m3u8': '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nclip.m4s\n#EXTINF:6,\nclip2.m4s\n#EXT-X-ENDLIST\n',
    'https://media.example/audio.m3u8': finite,
  });
  const plan = await planOfflineHls('https://media.example/index.m3u8', http);
  assert.equal(plan.entry, 'index.m3u8');
  assert.equal(plan.playlists.length, 3);
  assert.equal(plan.resources.length, 5);
  assert.equal(plan.resources[0].encryptionKey, true);
  const master = plan.playlists.find(row => row.path === plan.entry)?.contents;
  assert.ok(master?.includes('video-0.m3u8'));
  assert.ok(master?.includes('URI="audio-0.m3u8"'));
  assert.ok(!master?.includes('SUBTITLES='));
  assert.ok(!master?.includes('low.m3u8'));
  for (const row of plan.playlists) assert.ok(!row.contents.includes('https://'));
  assert.equal(plan.resources[0].url, 'https://media.example/key.bin');
});

test('offline HLS refuses live, DRM, byte ranges, malformed manifests, and unsafe media URLs', async () => {
  const invalid = [
    finite.replace('#EXT-X-ENDLIST\n', ''),
    finite.replace('#EXTINF:', '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"\n#EXTINF:'),
    finite.replace('#EXTINF:', '#EXT-X-BYTERANGE:100@0\n#EXTINF:'),
    finite.replace('segment.ts', 'https://127.0.0.1/segment.ts'),
    finite.replace('#EXTM3U', '<html>'),
  ];
  for (const value of invalid) {
    await assert.rejects(planOfflineHls('https://media.example/index.m3u8', playlists({ 'https://media.example/index.m3u8': value })),
      error => error instanceof EngineError);
  }
});

test('offline HLS rewrites repeated resources once and cancellation aborts manifest requests', async () => {
  const repeated = finite.replace('#EXT-X-ENDLIST', '#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST');
  const plan = await planOfflineHls('https://media.example/index.m3u8', playlists({ 'https://media.example/index.m3u8': repeated }));
  assert.equal(plan.resources.length, 1);
  assert.equal(plan.playlists[0].contents.match(/media-0.ts/g)?.length, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(planOfflineHls('https://media.example/index.m3u8', playlists({}), {}, controller.signal),
    error => error instanceof EngineError && error.code === 'cancelled');
});

test('offline download pool bounds concurrency and waits for workers after failure or cancellation', async () => {
  const resources = Array.from({ length: 9 }, (_, index) => ({ url: `https://media.example/${index}.ts`, path: `${index}.ts`, encryptionKey: false }));
  let active = 0, peak = 0, completed = 0;
  await downloadResources(resources, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
  }, new AbortController().signal, value => { completed = value; });
  assert.equal(peak, 3);
  assert.equal(completed, resources.length);
  let calls = 0;
  await assert.rejects(downloadResources(resources, async row => {
    calls++;
    active++;
    try {
      if (row.path === '0.ts') throw new Error('Transfer failed');
      await new Promise(resolve => setTimeout(resolve, 5));
    } finally { active--; }
  }, new AbortController().signal, () => undefined), /Transfer failed/);
  assert.equal(active, 0);
  assert.ok(calls <= 3);
  const controller = new AbortController();
  let cancelled = 0;
  await assert.rejects(downloadResources(resources, async () => {
    cancelled++;
    controller.abort();
  }, controller.signal, () => undefined), error => error instanceof EngineError && error.code === 'cancelled');
  assert.ok(cancelled <= 3);
});
