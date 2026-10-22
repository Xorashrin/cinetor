import test from 'node:test';
import assert from 'node:assert';
import { PlayableContentVerifier } from '../../src/engine/verification/playable-content-verifier';
import { PersistentCatalogRepository } from '../../src/engine/repository/persistent-catalog-repository';
import type { Movie } from '../../src/engine/models/content';

test('Verification - Container Magic Byte Inspection', () => {
  const verifier = new PlayableContentVerifier();

  // MKV EBML Header [0x1a, 0x45, 0xdf, 0xa3]
  const mkvBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
  assert.strictEqual(verifier.detectContainer(mkvBytes, '/movies/test.mkv'), 'mkv');

  // MP4 ftyp Box (offset 4 has 'f','t','y','p')
  const mp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  assert.strictEqual(verifier.detectContainer(mp4Bytes, '/movies/sample.mp4'), 'mp4');

  // TS Sync Byte (0x47)
  const tsBytes = new Uint8Array([0x47, 0x40, 0x00, 0x10]);
  assert.strictEqual(verifier.detectContainer(tsBytes, '/stream/live.ts'), 'ts');
});

test('Verification - Rejection of Invalid Media URLs and Extensions', async () => {
  const verifier = new PlayableContentVerifier();

  // Unsupported text/html file
  const nonMediaResult = await verifier.verifyMediaSource('http://bdix.local/index.html');
  assert.strictEqual(nonMediaResult.state, 'REJECTED');
  assert.strictEqual(nonMediaResult.playable, false);
  assert.match(nonMediaResult.rejectionReason!, /Unsupported media extension/);

  // Malformed URL
  const malformedResult = await verifier.verifyMediaSource('not_a_valid_url');
  assert.strictEqual(malformedResult.state, 'REJECTED');
  assert.strictEqual(malformedResult.playable, false);
});

test('Verification - Item with Poster but No Valid Video MUST NOT Appear in Normal Catalog', async () => {
  const repo = new PersistentCatalogRepository();

  // Movie that was discovered with a poster but whose video verification was REJECTED
  const fakeOrBrokenMovie: Movie = {
    id: 'cin_m_phantom_video_2024_1111',
    sourceId: 'src_broken',
    sourcePath: 'movies/Phantom.2024.mkv',
    name: 'Phantom Movie',
    kind: 'movie',
    year: 2024,
    maturity: '13+',
    genres: ['Action'],
    moods: ['Exciting'],
    artwork: {
      posterUrl: 'http://bdix.local/movies/Phantom.jpg',
      source: 'sidecar',
    },
    quality: ['HD'],
    runtime: 120,
    videoUrl: 'http://bdix.local/movies/Phantom.2024.mkv',
    verificationState: 'REJECTED', // Verification failed or video inaccessible!
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Movie that passed verification with a verified playable stream
  const verifiedMovie: Movie = {
    id: 'cin_m_valid_movie_2024_2222',
    sourceId: 'src_valid',
    sourcePath: 'movies/Valid.2024.mp4',
    name: 'Valid Verified Movie',
    kind: 'movie',
    year: 2024,
    maturity: '13+',
    genres: ['Action'],
    moods: ['Exciting'],
    artwork: {
      posterUrl: 'http://bdix.local/movies/Valid.jpg',
      source: 'sidecar',
    },
    quality: ['HD'],
    runtime: 105,
    videoUrl: 'http://bdix.local/movies/Valid.2024.mp4',
    verificationState: 'VERIFIED', // Verified!
    discoveredAt: Date.now(),
    updatedAt: Date.now(),
  };

  await repo.saveItems([fakeOrBrokenMovie, verifiedMovie]);

  // Mandatory Quality Requirement:
  // Normal catalog query must strictly exclude unverified or rejected media!
  const normalCatalog = await repo.find({ verifiedOnly: true });

  assert.strictEqual(normalCatalog.length, 1);
  assert.strictEqual(normalCatalog[0].id, verifiedMovie.id);
  assert.strictEqual(normalCatalog[0].name, 'Valid Verified Movie');

  // Verify the unverified movie is NOT in search results either
  const searchResults = await repo.search('Phantom');
  assert.strictEqual(searchResults.length, 0);

  // If querying raw catalog with verifiedOnly: false, it is visible for administrative audits
  const rawCatalog = await repo.find({ verifiedOnly: false });
  assert.strictEqual(rawCatalog.length, 2);
});
