import test from 'node:test';
import assert from 'node:assert';
import { RecursiveDirectoryCrawler } from '../../src/engine/crawler/recursive-directory-crawler';
import type { RawDirectoryEntry, SourceAdapter } from '../../src/engine/interfaces/source-adapter';
import type { MediaSource } from '../../src/engine/models/source';

// Synthetic directory tree adapter simulating nested movie and series folders
class SyntheticDirectoryAdapter implements SourceAdapter {
  public readonly protocol = 'http';
  public readonly supportedTypes = ['directory-listing'] as const;

  private readonly tree: Record<string, RawDirectoryEntry[]> = {
    '': [
      { name: 'Movies', path: 'Movies/', url: 'http://test/Movies/', type: 'directory' },
      { name: 'TV', path: 'TV/', url: 'http://test/TV/', type: 'directory' },
      { name: 'Inaccessible', path: 'Inaccessible/', url: 'http://test/Inaccessible/', type: 'directory' },
      { name: 'Loop', path: 'Loop/', url: 'http://test/', type: 'directory' }, // Points back to root!
    ],
    'Movies': [
      { name: 'Inception (2010)', path: 'Movies/Inception (2010)/', url: 'http://test/Movies/Inception%20(2010)/', type: 'directory' },
    ],
    'Movies/Inception (2010)': [
      { name: 'Inception.2010.1080p.mkv', path: 'Movies/Inception (2010)/Inception.2010.1080p.mkv', url: 'http://test/Movies/Inception%20(2010)/Inception.2010.1080p.mkv', type: 'file' },
      { name: 'poster.jpg', path: 'Movies/Inception (2010)/poster.jpg', url: 'http://test/Movies/Inception%20(2010)/poster.jpg', type: 'file' },
      { name: 'Inception.srt', path: 'Movies/Inception (2010)/Inception.srt', url: 'http://test/Movies/Inception%20(2010)/Inception.srt', type: 'file' },
    ],
    'TV': [
      { name: 'Dark', path: 'TV/Dark/', url: 'http://test/TV/Dark/', type: 'directory' },
    ],
    'TV/Dark': [
      { name: 'Season 1', path: 'TV/Dark/Season 1/', url: 'http://test/TV/Dark/Season%201/', type: 'directory' },
    ],
    'TV/Dark/Season 1': [
      { name: 'Dark.S01E01.720p.mkv', path: 'TV/Dark/Season 1/Dark.S01E01.720p.mkv', url: 'http://test/TV/Dark/Season%201/Dark.S01E01.720p.mkv', type: 'file' },
      { name: 'Dark.S01E02.720p.mkv', path: 'TV/Dark/Season 1/Dark.S01E02.720p.mkv', url: 'http://test/TV/Dark/Season%201/Dark.S01E02.720p.mkv', type: 'file' },
    ],
  };

  public canHandle(): boolean {
    return true;
  }

  public async listDirectory(_source: MediaSource, relativePath: string): Promise<RawDirectoryEntry[]> {
    const clean = relativePath.replace(/\/+$/, '');
    if (clean === 'Inaccessible') {
      throw new Error('HTTP 403 Forbidden: Inaccessible directory');
    }
    return this.tree[clean] ?? [];
  }
}

test('Crawler - Nested Directory Traversal, Loop Prevention & Error Isolation', async () => {
  const adapter = new SyntheticDirectoryAdapter();
  const crawler = new RecursiveDirectoryCrawler(() => adapter, 2);

  const source: MediaSource = {
    id: 'src_synthetic',
    name: 'Synthetic Source',
    baseUrl: 'http://test/',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const discoveredFiles: string[] = [];
  const errorPaths: string[] = [];
  let finishSeen = false;

  for await (const event of crawler.crawl(source, '', { maxDepth: 6 })) {
    if (event.type === 'file' && event.entry) {
      discoveredFiles.push(event.entry.name);
    } else if (event.type === 'error') {
      errorPaths.push(event.path);
    } else if (event.type === 'finish') {
      finishSeen = true;
    }
  }

  assert.strictEqual(finishSeen, true);

  // Files correctly discovered across deep subdirectories
  assert.ok(discoveredFiles.includes('Inception.2010.1080p.mkv'));
  assert.ok(discoveredFiles.includes('poster.jpg'));
  assert.ok(discoveredFiles.includes('Dark.S01E01.720p.mkv'));
  assert.ok(discoveredFiles.includes('Dark.S01E02.720p.mkv'));

  // Inaccessible directory error was captured without crashing crawl
  assert.ok(errorPaths.some((p) => p.startsWith('Inaccessible')));

  // Loop was prevented (did not hang or discover infinite items)
  assert.strictEqual(discoveredFiles.length, 5); // 3 in Inception folder, 2 in Dark folder
});

test('Crawler - Depth Boundary Enforcement', async () => {
  const adapter = new SyntheticDirectoryAdapter();
  // Set maxDepth: 1 -> only top-level folders, should not reach deep files at depth 2 or 3
  const crawler = new RecursiveDirectoryCrawler(() => adapter, 2);

  const source: MediaSource = {
    id: 'src_depth',
    name: 'Depth Test',
    baseUrl: 'http://test/',
    protocol: 'http',
    type: 'directory-listing',
    enabled: true,
    priority: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const discoveredFiles: string[] = [];
  for await (const event of crawler.crawl(source, '', { maxDepth: 1 })) {
    if (event.type === 'file' && event.entry) {
      discoveredFiles.push(event.entry.name);
    }
  }

  // Deep files at depth 2+ were not crawled
  assert.strictEqual(discoveredFiles.length, 0);
});
