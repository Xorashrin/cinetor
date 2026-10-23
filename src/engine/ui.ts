import type { Title } from '../data/mock';
import type { CineHdCatalog } from '../providers/metadata';
export function toTitle(title: Title): Title { return title; }
export function feedTitles(catalog: CineHdCatalog, category: 'home' | 'anime' | 'kdrama'): Title[] { return catalog.query(category); }
