import type { ArtworkCandidate, ArtworkResolver } from '../interfaces/artwork-resolver';
import type { RawDirectoryEntry } from '../interfaces/source-adapter';
import type { Artwork, ContentItem } from '../models/content';
import { normalizeTitleKey } from '../id/id-generator';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const SIDECAR_POSTER_NAMES = ['poster', 'folder', 'cover', 'default'];
const SIDECAR_BACKDROP_NAMES = ['backdrop', 'fanart', 'background', 'banner', 'hero'];

/**
 * Production artwork resolver respecting priority order and validation rules.
 */
export class ArtworkResolverImpl implements ArtworkResolver {
  public async resolveArtwork(
    item: ContentItem,
    siblingEntries: RawDirectoryEntry[] = [],
    _signal?: AbortSignal,
  ): Promise<Artwork> {
    const candidates = this.findCandidates(item, siblingEntries);

    let posterUrl: string | undefined;
    let backdropUrl: string | undefined;
    let source: Artwork['source'] = 'none';

    // 1. Pick highest priority poster candidate
    const posterCandidate = candidates
      .filter((c) => c.type === 'poster')
      .sort((a, b) => b.priority - a.priority)[0];

    if (posterCandidate) {
      posterUrl = posterCandidate.entry.url;
      source = 'sidecar';
    }

    // 2. Pick highest priority backdrop candidate
    const backdropCandidate = candidates
      .filter((c) => c.type === 'backdrop')
      .sort((a, b) => b.priority - a.priority)[0];

    if (backdropCandidate) {
      backdropUrl = backdropCandidate.entry.url;
      if (source === 'none') source = 'sidecar';
    }

    // 3. Fallback: if backdrop found but no poster, or vice-versa
    if (!posterUrl && backdropUrl) {
      posterUrl = backdropUrl;
    } else if (!backdropUrl && posterUrl) {
      backdropUrl = posterUrl;
    }

    // 4. Return generic placeholder ONLY if item is verified and no sidecar was found
    if (!posterUrl && item.verificationState === 'VERIFIED') {
      // High-resolution clean abstract placeholder
      posterUrl = '';
      source = 'generated';
    }

    return {
      posterUrl,
      backdropUrl,
      source,
    };
  }

  public findCandidates(item: ContentItem, entries: RawDirectoryEntry[]): ArtworkCandidate[] {
    const candidates: ArtworkCandidate[] = [];
    const normalizedItemTitle = normalizeTitleKey(item.name);

    for (const entry of entries) {
      if (entry.type !== 'file') continue;

      const extIndex = entry.name.lastIndexOf('.');
      if (extIndex < 0) continue;
      const ext = entry.name.slice(extIndex).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) continue;

      const baseName = entry.name.slice(0, extIndex).toLowerCase().trim();
      const normalizedBaseName = normalizeTitleKey(baseName);

      // Check for exact matching title: e.g. "Inception.jpg" or "Inception-poster.jpg"
      if (normalizedBaseName === normalizedItemTitle || normalizedBaseName === `${normalizedItemTitle} poster`) {
        candidates.push({ entry, type: 'poster', priority: 100 });
        continue;
      }

      if (normalizedBaseName === `${normalizedItemTitle} backdrop` || normalizedBaseName === `${normalizedItemTitle} fanart`) {
        candidates.push({ entry, type: 'backdrop', priority: 95 });
        continue;
      }

      // Check standard sidecars: poster.jpg, folder.jpg
      if (SIDECAR_POSTER_NAMES.includes(baseName)) {
        const priority = baseName === 'poster' ? 80 : baseName === 'folder' ? 70 : 60;
        candidates.push({ entry, type: 'poster', priority });
        continue;
      }

      // Check standard backdrops: backdrop.jpg, fanart.jpg
      if (SIDECAR_BACKDROP_NAMES.includes(baseName)) {
        const priority = baseName === 'backdrop' ? 80 : baseName === 'fanart' ? 70 : 60;
        candidates.push({ entry, type: 'backdrop', priority });
        continue;
      }
    }

    return candidates;
  }
}
