import test from 'node:test';
import assert from 'node:assert';
import { HttpDirectoryAdapter } from '../../src/engine/adapters/http-directory-adapter';
import { JsonDirectoryAdapter } from '../../src/engine/adapters/json-directory-adapter';
import { FtpDirectoryAdapter } from '../../src/engine/adapters/ftp-directory-adapter';
import type { MediaSource } from '../../src/engine/models/source';

test('Adapters - Apache / Nginx Autoindex HTML Parsing', () => {
  const adapter = new HttpDirectoryAdapter();

  const mockAutoindexHtml = `
  <!DOCTYPE html>
  <html>
  <head><title>Index of /media/movies/</title></head>
  <body>
  <h1>Index of /media/movies/</h1>
  <table>
    <tr><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=M;O=A">Last modified</a></th><th><a href="?C=S;O=A">Size</a></th></tr>
    <tr><td colspan="5"><hr></td></tr>
    <tr><td><a href="/media/">Parent Directory</a></td><td>&nbsp;</td><td align="right">  - </td></tr>
    <tr><td><a href="Action/">Action/</a></td><td align="right">2024-05-10 12:30  </td><td align="right">  - </td></tr>
    <tr><td><a href="Dune.Part.Two.2024.1080p.mkv">Dune.Part.Two.2024.1080p.mkv</a></td><td align="right">2024-05-11 15:40  </td><td align="right">2.4G</td></tr>
    <tr><td><a href="Dune.jpg">Dune.jpg</a></td><td align="right">2024-05-11 15:42  </td><td align="right">150K</td></tr>
  </table>
  </body>
  </html>
  `;

  const baseUrl = new URL('http://bdix.local/media/movies/');
  const entries = adapter.parseAutoindexHtml(mockAutoindexHtml, baseUrl, 'movies');

  assert.strictEqual(entries.length, 3);

  // Folder entry
  const folder = entries.find((e) => e.name === 'Action');
  assert.strictEqual(folder?.type, 'directory');
  assert.strictEqual(folder?.path, 'movies/Action/');
  assert.strictEqual(folder?.url, 'http://bdix.local/media/movies/Action/');

  // Video file entry
  const video = entries.find((e) => e.name === 'Dune.Part.Two.2024.1080p.mkv');
  assert.strictEqual(video?.type, 'file');
  assert.strictEqual(video?.path, 'movies/Dune.Part.Two.2024.1080p.mkv');
  assert.strictEqual(video?.url, 'http://bdix.local/media/movies/Dune.Part.Two.2024.1080p.mkv');

  // Poster image entry
  const poster = entries.find((e) => e.name === 'Dune.jpg');
  assert.strictEqual(poster?.type, 'file');
  assert.strictEqual(poster?.path, 'movies/Dune.jpg');
});

test('Adapters - JSON Directory Listing Normalization', () => {
  const adapter = new JsonDirectoryAdapter();

  const mockJsonItems = [
    { name: 'Oppenheimer.2023.mp4', type: 'file' as const, sizeBytes: 2500000000 },
    { name: 'Sci-Fi', is_dir: true },
  ];

  const baseUrl = new URL('http://api.bdix.local/v1/files');
  const entries = adapter.normalizeJsonItems(mockJsonItems, baseUrl, 'catalog');

  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].name, 'Oppenheimer.2023.mp4');
  assert.strictEqual(entries[0].type, 'file');
  assert.strictEqual(entries[0].sizeBytes, 2500000000);
  assert.strictEqual(entries[1].name, 'Sci-Fi');
  assert.strictEqual(entries[1].type, 'directory');
});

test('Adapters - FTP Listing Parsing (UNIX and Windows styles)', () => {
  const adapter = new FtpDirectoryAdapter();

  const mockFtpListing = [
    'drwxr-xr-x   4 user     group        4096 May 10 14:30 Movies',
    '-rw-r--r--   1 user     group   2147483648 May 11 18:20 Avatar.2009.mkv',
    '05-12-24  02:30PM       <DIR>          TV_Series',
    '05-12-24  03:15PM             10485760 sample.mp4',
  ].join('\n');

  const entries = adapter.parseFtpListing(mockFtpListing, 'ftp://ftp.bdix.local/media', '');

  assert.strictEqual(entries.length, 4);
  assert.strictEqual(entries[0].name, 'Movies');
  assert.strictEqual(entries[0].type, 'directory');

  assert.strictEqual(entries[1].name, 'Avatar.2009.mkv');
  assert.strictEqual(entries[1].type, 'file');
  assert.strictEqual(entries[1].sizeBytes, 2147483648);

  assert.strictEqual(entries[2].name, 'TV_Series');
  assert.strictEqual(entries[2].type, 'directory');

  assert.strictEqual(entries[3].name, 'sample.mp4');
  assert.strictEqual(entries[3].sizeBytes, 10485760);
});

test('Adapters - FTP Error Isolation when Raw Transport is Missing', async () => {
  const adapter = new FtpDirectoryAdapter();
  const source: MediaSource = {
    id: 'src_ftp',
    name: 'Raw FTP Source',
    baseUrl: 'ftp://ftp.example.com/movies',
    protocol: 'ftp',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await assert.rejects(
    async () => adapter.listDirectory(source),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /requires a configured HTTP gateway/);
      return true;
    },
  );
});
