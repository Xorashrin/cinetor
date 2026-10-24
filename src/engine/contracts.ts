import type { Title } from '../data/mock';
import { EngineError } from './model';

export type CatalogSection = 'home' | 'anime' | 'kdrama' | 'others';
export type EngineId = 'bdix' | 'nuvio' | 'cloudstream';
export interface ContentRef {
  namespace: 'tmdb';
  mediaType: 'movie' | 'tv';
  externalId: number;
  season?: number;
  episode?: number;
}
export function contentRef(title: Title, episodeId?: string): ContentRef {
  const match = /^tmdb:(movie|tv):([1-9]\d*)$/.exec(title.id);
  if (!match || !Number.isSafeInteger(Number(match[2])) || (title.kind === 'movie') !== (match[1] === 'movie'))
    throw new EngineError('configuration');
  const ref: ContentRef = { namespace: 'tmdb', mediaType: match[1] as 'movie' | 'tv', externalId: Number(match[2]) };
  if (ref.mediaType === 'tv') {
    const coordinate = episodeId && new RegExp(`^${title.id}:s(\\d+)e([1-9]\\d*)$`).exec(episodeId);
    if (!coordinate) throw new EngineError('configuration');
    ref.season = Number(coordinate[1]);
    ref.episode = Number(coordinate[2]);
    if (!Number.isSafeInteger(ref.season) || !Number.isSafeInteger(ref.episode)) throw new EngineError('configuration');
  } else if (episodeId) throw new EngineError('configuration');
  return ref;
}
export function contentKey(ref: ContentRef): string {
  if (ref.namespace !== 'tmdb' || !Number.isSafeInteger(ref.externalId) || ref.externalId <= 0 ||
      (ref.mediaType !== 'movie' && ref.mediaType !== 'tv') ||
      (ref.mediaType === 'movie' && (ref.season !== undefined || ref.episode !== undefined)) ||
      (ref.mediaType === 'tv' && (!Number.isSafeInteger(ref.season) || (ref.season ?? -1) < 0 || !Number.isSafeInteger(ref.episode) || (ref.episode ?? 0) < 1))) throw new EngineError('configuration');
  return `tmdb:${ref.mediaType}:${ref.externalId}${ref.mediaType === 'tv' ? `:s${ref.season}e${ref.episode}` : ''}`;
}
export function sameContent(left: ContentRef, right: ContentRef): boolean {
  return contentKey(left) === contentKey(right);
}
export function sectionFor(title: Title): CatalogSection | undefined {
  if (title.genres.some(genre => genre.normalize('NFKC').trim().toLowerCase() === 'adult (18+)') || title.maturity === '18+' || title.id === 'empty') return undefined;
  if (title.genres.includes('Anime') && title.originalLanguage === 'ja' && title.genres.includes('Animation')) return 'anime';
  if (title.genres.includes('K-Drama') && title.originalLanguage === 'ko' && title.kind === 'series') return 'kdrama';
  if (title.genres.includes('Animation') || title.genres.includes('Documentary') || ['bn', 'hi', 'ta', 'te', 'ml', 'kn', 'mr', 'ur'].includes(title.originalLanguage ?? '')) return 'others';
  return 'home';
}
export const SECTION_LABELS: Record<CatalogSection, string> = { home: 'Home', anime: 'Anime', kdrama: 'K-Drama', others: 'Others' };
