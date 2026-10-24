import type { Title } from '../data/mock';
import { sectionFor } from '../engine/contracts';

export type SearchSort = 'relevance' | 'newest' | 'rating' | 'title';

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function metric(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : -1;
}

export function searchTitles(titles: Title[], query: string, sort: SearchSort = 'relevance'): Title[] {
  const phrase = normalize(query);
  if (!phrase) return [];
  const terms = [...new Set(phrase.split(' '))];
  return titles
    .filter(title => sectionFor(title) !== undefined)
    .map(title => {
      const name = normalize(title.name);
      const metadata = [name, ...title.genres, ...title.cast, ...title.creators, ...title.moods].map(normalize);
      const score = name === phrase ? 3 : name.startsWith(phrase) ? 2 : name.includes(phrase) ? 1 : 0;
      return { title, name, score, matches: terms.every(term => metadata.some(field => field.includes(term))) };
    })
    .filter(entry => entry.matches)
    .sort((a, b) => {
      let order = 0;
      if (sort === 'newest') order = metric(b.title.year) - metric(a.title.year);
      else if (sort === 'rating') order = metric(b.title.rating) - metric(a.title.rating);
      else if (sort === 'title') order = compareText(a.name, b.name);
      else order = b.score - a.score;
      return order || metric(b.title.popularity) - metric(a.title.popularity) || compareText(a.title.id, b.title.id);
    })
    .map(entry => entry.title);
}
