import assert from 'node:assert/strict';
import test from 'node:test';
import { searchTitles } from '../../src/providers/search';
import { DEFAULT_TITLE, type Title } from '../../src/data/mock';

function title(id: string, name: string, patch: Partial<Title> = {}): Title {
  return { ...DEFAULT_TITLE, id, name, year: 2023, maturity: 'UNRATED', original: false, genres: [], cast: [], creators: [], moods: [], quality: [], ...patch };
}

test('relevance prefers exact names, prefixes and substrings before other metadata', () => {
  const rows = [
    title('genre', 'A Documentary', { genres: ['Alien'], popularity: 100 }),
    title('substring', 'The Alien', { popularity: 20 }),
    title('prefix', 'Alien: Romulus', { popularity: 10 }),
    title('exact', 'Alien', { popularity: 1 }),
  ];
  const copy = [...rows];
  assert.deepEqual(searchTitles(rows, 'alien').map(row => row.id), ['exact', 'prefix', 'substring', 'genre']);
  assert.deepEqual(rows, copy);
});

test('search normalizes Unicode NFKC and treats query terms as AND across name and metadata', () => {
  const rows = [
    title('match', 'Game of Thrones', { genres: ['Fantasy'], cast: ['Peter Dinklage'], creators: ['David Benioff'], moods: ['Epic'] }),
    title('partial', 'Game of Thrones', { genres: ['Drama'] }),
    title('fullwidth', 'ＡＬＩＥＮ'),
  ];
  assert.deepEqual(searchTitles(rows, '  thrones   peter epic benioff ').map(row => row.id), ['match']);
  assert.deepEqual(searchTitles(rows, 'alien').map(row => row.id), ['fullwidth']);
  assert.deepEqual(searchTitles(rows, 'thrones fantasy').map(row => row.id), ['match']);
  assert.deepEqual(searchTitles(rows, 'thrones comedy'), []);
  assert.deepEqual(searchTitles(rows, '  '), []);
});

test('newest, rating and title sorts use deterministic popularity and ID fallbacks', () => {
  const rows = [
    title('b', 'Drama Zeta', { year: 2020, rating: 9, popularity: 10 }),
    title('a', 'Drama Alpha', { year: 2024, rating: 7, popularity: 10 }),
    title('c', 'Drama Beta', { year: 2024, rating: 8, popularity: 20 }),
    title('d', 'Drama Missing', { year: 0, rating: undefined, popularity: undefined }),
  ];
  assert.deepEqual(searchTitles(rows, 'drama', 'newest').map(row => row.id), ['c', 'a', 'b', 'd']);
  assert.deepEqual(searchTitles(rows, 'drama', 'rating').map(row => row.id), ['b', 'c', 'a', 'd']);
  assert.deepEqual(searchTitles(rows, 'drama', 'title').map(row => row.id), ['a', 'c', 'd', 'b']);
  assert.deepEqual(searchTitles([...rows].reverse(), 'drama').map(row => row.id), ['c', 'a', 'b', 'd']);
});

test('adult rows stay excluded regardless of sort and malformed numeric metrics do not destabilize ordering', () => {
  const rows = [
    title('adult-rating', 'Drama', { maturity: '18+', rating: 10 }),
    title('adult-genre', 'Drama', { genres: ['Adult (18+)'], popularity: 100 }),
    title('safe', 'Drama', { rating: 8 }),
    title('invalid', 'Drama', { rating: Number.NaN, popularity: Number.POSITIVE_INFINITY }),
  ];
  assert.deepEqual(searchTitles(rows, 'drama', 'rating').map(row => row.id), ['safe', 'invalid']);
});
