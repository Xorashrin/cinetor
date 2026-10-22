import type { CatalogQuery, CatalogRepository, CatalogStats } from '../interfaces/catalog-repository';
import { isMovie, isSeries, type ContentItem, type Movie, type Series } from '../models/content';
import type { VerificationState, VerifiedPlaybackSource } from '../models/verification';

export interface StorageDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ExtendedCatalogQuery extends CatalogQuery {
  /**
   * If true (default), returns ONLY items that have been verified and confirmed playable.
   * If false, returns all catalog items including unverified or rejected ones.
   */
  verifiedOnly?: boolean;
}

const DEFAULT_STORAGE_KEY = 'cinator:catalog:v1';

/**
 * Production-ready Persistent Catalog Repository.
 *
 * Implements multi-source deduplication, verification publication gates,
 * and persistent storage synchronization.
 */
export class PersistentCatalogRepository implements CatalogRepository {
  private readonly items = new Map<string, ContentItem>();
  private readonly storageKey: string;
  private readonly storage?: StorageDriver;

  constructor(storage?: StorageDriver, storageKey: string = DEFAULT_STORAGE_KEY) {
    this.storage = storage;
    this.storageKey = storageKey;
  }

  /**
   * Loads catalog state from persistent storage.
   */
  public async loadFromStorage(): Promise<number> {
    if (!this.storage) return 0;
    try {
      const raw = await this.storage.getItem(this.storageKey);
      if (!raw) return 0;
      const parsed = JSON.parse(raw) as ContentItem[];
      if (Array.isArray(parsed)) {
        this.items.clear();
        for (const item of parsed) {
          this.items.set(item.id, item);
        }
        return this.items.size;
      }
    } catch {
      // Return 0 if storage is empty or corrupted
    }
    return 0;
  }

  /**
   * Flushes current catalog state to persistent storage.
   */
  public async persistToStorage(): Promise<void> {
    if (!this.storage) return;
    const array = Array.from(this.items.values());
    await this.storage.setItem(this.storageKey, JSON.stringify(array));
  }

  public async saveItem(item: ContentItem): Promise<void> {
    const existing = this.items.get(item.id);
    if (existing) {
      this.items.set(item.id, this.mergeItems(existing, item));
    } else {
      this.items.set(item.id, { ...item });
    }
  }

  public async saveItems(items: ContentItem[]): Promise<void> {
    for (const item of items) {
      await this.saveItem(item);
    }
    await this.persistToStorage().catch(() => undefined);
  }

  public async getItem(id: string): Promise<ContentItem | null> {
    const item = this.items.get(id);
    return item ? { ...item } : null;
  }

  public async getMovie(id: string): Promise<Movie | null> {
    const item = this.items.get(id);
    return item && isMovie(item) ? { ...item } : null;
  }

  public async getSeries(id: string): Promise<Series | null> {
    const item = this.items.get(id);
    return item && isSeries(item) ? { ...item } : null;
  }

  /**
   * Queries catalog items. By default, ONLY verified playable items are returned.
   */
  public async find(query: ExtendedCatalogQuery = { verifiedOnly: true }): Promise<ContentItem[]> {
    let result = Array.from(this.items.values());

    // 1. Mandatory Playable Verification Filter:
    // Items that are REJECTED, DISCOVERED, or unverified MUST NOT appear in normal catalog
    if (query.verifiedOnly !== false) {
      const verifiedList: ContentItem[] = [];
      for (const item of result) {
        if (item.verificationState !== 'VERIFIED') continue;
        if (isMovie(item)) {
          if (Boolean(item.videoUrl)) {
            verifiedList.push({ ...item });
          }
        } else if (isSeries(item)) {
          const verifiedSeasons = (item.seasons ?? [])
            .map((season) => ({
              ...season,
              episodes: (season.episodes ?? []).filter(
                (ep) => (ep.verificationState === 'VERIFIED' || !ep.verificationState) && Boolean(ep.videoUrl),
              ),
            }))
            .filter((season) => season.episodes.length > 0);

          const totalEpisodes = verifiedSeasons.reduce((acc, s) => acc + s.episodes.length, 0);
          if (totalEpisodes > 0) {
            verifiedList.push({
              ...item,
              seasons: verifiedSeasons,
              totalSeasons: verifiedSeasons.length,
              totalEpisodes,
            });
          }
        }
      }
      result = verifiedList;
    }

    if (query.kind) {
      result = result.filter((i) => i.kind === query.kind);
    }
    if (query.sourceId) {
      result = result.filter((i) => i.sourceId === query.sourceId);
    }
    if (query.year !== undefined) {
      result = result.filter((i) => i.year === query.year);
    }
    if (query.genres && query.genres.length > 0) {
      result = result.filter((i) => query.genres!.every((g) => i.genres.includes(g)));
    }

    // Sorting
    const sortBy = query.sortBy ?? 'name';
    const order = query.sortOrder === 'desc' ? -1 : 1;
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'year') cmp = (a.year ?? 0) - (b.year ?? 0);
      else if (sortBy === 'discoveredAt') cmp = a.discoveredAt - b.discoveredAt;
      else if (sortBy === 'updatedAt') cmp = a.updatedAt - b.updatedAt;
      return cmp * order;
    });

    // Pagination
    if (query.offset !== undefined && query.offset > 0) {
      result = result.slice(query.offset);
    }
    if (query.limit !== undefined && query.limit > 0) {
      result = result.slice(0, query.limit);
    }

    return result.map((i) => ({ ...i }));
  }

  public async search(text: string, limit: number = 30): Promise<ContentItem[]> {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);

    // Only search verified content
    const verifiedItems = (await this.find({ verifiedOnly: true })).filter((item) => {
      const haystack = `${item.name}|${item.originalName ?? ''}|${item.genres.join(' ')}|${item.synopsis ?? ''}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });

    verifiedItems.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 1 : 0;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 1 : 0;
      return bStarts - aStarts;
    });

    return verifiedItems.slice(0, limit);
  }

  public async remove(id: string): Promise<boolean> {
    const deleted = this.items.delete(id);
    if (deleted) {
      await this.persistToStorage().catch(() => undefined);
    }
    return deleted;
  }

  public async removeBySource(sourceId: string): Promise<number> {
    let count = 0;
    for (const [id, item] of this.items.entries()) {
      if (item.sourceId === sourceId) {
        this.items.delete(id);
        count++;
      }
    }
    if (count > 0) {
      await this.persistToStorage().catch(() => undefined);
    }
    return count;
  }

  public async clear(): Promise<void> {
    this.items.clear();
    await this.persistToStorage().catch(() => undefined);
  }

  public async invalidateSourceUrl(contentId: string, failedUrl: string, episodeId?: string): Promise<string | null> {
    const item = this.items.get(contentId);
    if (!item) return null;

    if (isMovie(item)) {
      if (item.sources) {
        for (const s of item.sources) {
          if (s.url === failedUrl) {
            s.verificationState = 'REJECTED';
            s.consecutiveFailures = (s.consecutiveFailures ?? 0) + 1;
          }
        }
      }
      const remaining = (item.sources ?? []).filter((s) => s.url !== failedUrl && s.verificationState === 'VERIFIED');
      if (remaining.length > 0) {
        item.videoUrl = remaining[0].url;
        item.updatedAt = Date.now();
        await this.persistToStorage().catch(() => undefined);
        return item.videoUrl;
      }
      item.verificationState = 'REJECTED';
      item.videoUrl = '';
      item.updatedAt = Date.now();
      await this.persistToStorage().catch(() => undefined);
      return null;
    }

    if (isSeries(item)) {
      let nextUrl: string | null = null;
      let targetEpFound = false;
      for (const season of item.seasons) {
        for (const ep of season.episodes) {
          if (!episodeId || ep.id === episodeId) {
            targetEpFound = true;
            if (ep.sources) {
              for (const s of ep.sources) {
                if (s.url === failedUrl) {
                  s.verificationState = 'REJECTED';
                  s.consecutiveFailures = (s.consecutiveFailures ?? 0) + 1;
                }
              }
            }
            const remaining = (ep.sources ?? []).filter((s) => s.url !== failedUrl && s.verificationState === 'VERIFIED');
            if (remaining.length > 0) {
              ep.videoUrl = remaining[0].url;
              nextUrl = ep.videoUrl;
            } else {
              ep.verificationState = 'REJECTED';
              ep.videoUrl = '';
            }
          }
        }
      }

      const anyVerified = item.seasons.some((s) => s.episodes.some((e) => e.verificationState === 'VERIFIED' && Boolean(e.videoUrl)));
      if (!anyVerified) {
        item.verificationState = 'REJECTED';
      }
      item.updatedAt = Date.now();
      await this.persistToStorage().catch(() => undefined);
      return targetEpFound ? nextUrl : null;
    }

    return null;
  }

  public async markSourceOffline(sourceId: string): Promise<number> {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.sourceId === sourceId) {
        if (isMovie(item)) {
          const remaining = (item.sources ?? []).filter((s) => s.sourceId !== sourceId && s.verificationState === 'VERIFIED');
          if (remaining.length > 0) {
            item.videoUrl = remaining[0].url;
          } else {
            item.verificationState = 'REJECTED';
            item.videoUrl = '';
          }
          count++;
        } else if (isSeries(item)) {
          let anyEpVerified = false;
          for (const s of item.seasons) {
            for (const ep of s.episodes) {
              const remaining = (ep.sources ?? []).filter((src) => src.sourceId !== sourceId && src.verificationState === 'VERIFIED');
              if (remaining.length > 0) {
                ep.videoUrl = remaining[0].url;
                anyEpVerified = true;
              } else {
                ep.verificationState = 'REJECTED';
                ep.videoUrl = '';
              }
            }
          }
          if (!anyEpVerified) {
            item.verificationState = 'REJECTED';
          }
          count++;
        }
      }
    }
    if (count > 0) {
      await this.persistToStorage().catch(() => undefined);
    }
    return count;
  }

  public async getStats(): Promise<CatalogStats> {
    let moviesCount = 0;
    let seriesCount = 0;
    let episodesCount = 0;
    const sources = new Set<string>();
    let lastUpdatedAt = 0;

    for (const item of this.items.values()) {
      if (item.verificationState !== 'VERIFIED') continue;

      sources.add(item.sourceId);
      if (item.updatedAt > lastUpdatedAt) {
        lastUpdatedAt = item.updatedAt;
      }
      if (isMovie(item)) {
        moviesCount++;
      } else if (isSeries(item)) {
        seriesCount++;
        episodesCount += item.totalEpisodes;
      }
    }

    return {
      totalItems: moviesCount + seriesCount,
      moviesCount,
      seriesCount,
      episodesCount,
      sourcesCount: sources.size,
      lastUpdatedAt,
    };
  }

  /**
   * Multi-source deduplication and merger.
   * Merges incoming movie or series with existing record, preserving multiple verified playback sources.
   */
  private mergeItems(existing: ContentItem, incoming: ContentItem): ContentItem {
    const now = Date.now();

    if (isMovie(existing) && isMovie(incoming)) {
      const mergedSources: VerifiedPlaybackSource[] = [...(existing.sources ?? [])];

      // Add incoming movie source if not present
      if (!mergedSources.some((s) => s.url === incoming.videoUrl)) {
        mergedSources.push({
          sourceId: incoming.sourceId,
          sourcePath: incoming.sourcePath,
          url: incoming.videoUrl,
          verificationState: incoming.verificationState,
          container: incoming.container,
          fileSizeBytes: incoming.fileSize,
          lastVerifiedAt: incoming.updatedAt,
          consecutiveFailures: 0,
        });
      }

      // Pick best artwork
      const artwork = existing.artwork.source !== 'none' ? existing.artwork : incoming.artwork;

      return {
        ...existing,
        name: existing.name || incoming.name,
        genres: Array.from(new Set([...existing.genres, ...incoming.genres])),
        moods: Array.from(new Set([...existing.moods, ...incoming.moods])),
        quality: Array.from(new Set([...existing.quality, ...incoming.quality])),
        sources: mergedSources,
        artwork,
        videoUrl: existing.videoUrl || incoming.videoUrl,
        verificationState:
          existing.verificationState === 'VERIFIED' || incoming.verificationState === 'VERIFIED'
            ? 'VERIFIED'
            : incoming.verificationState,
        updatedAt: now,
      };
    }

    if (isSeries(existing) && isSeries(incoming)) {
      // Merge seasons & episodes
      const seasonsMap = new Map<number, (typeof existing.seasons)[0]>();
      for (const s of existing.seasons) {
        seasonsMap.set(s.seasonNumber, { ...s, episodes: [...s.episodes] });
      }

      for (const inSeason of incoming.seasons) {
        const curSeason = seasonsMap.get(inSeason.seasonNumber);
        if (!curSeason) {
          seasonsMap.set(inSeason.seasonNumber, inSeason);
        } else {
          // Merge episodes within season
          for (const inEp of inSeason.episodes) {
            const epIdx = curSeason.episodes.findIndex((e) => e.episodeNumber === inEp.episodeNumber);
            if (epIdx >= 0) {
              const curEp = curSeason.episodes[epIdx];
              const epSources = [...(curEp.sources ?? [])];
              if (!epSources.some((s) => s.url === inEp.videoUrl)) {
                epSources.push({
                  sourceId: incoming.sourceId,
                  sourcePath: inEp.sourcePath,
                  url: inEp.videoUrl,
                  verificationState: inEp.verificationState ?? 'VERIFIED',
                  container: inEp.container,
                  fileSizeBytes: inEp.fileSize,
                  lastVerifiedAt: now,
                  consecutiveFailures: 0,
                });
              }
              curSeason.episodes[epIdx] = {
                ...curEp,
                sources: epSources,
                videoUrl: curEp.videoUrl || inEp.videoUrl,
              };
            } else {
              curSeason.episodes.push(inEp);
            }
          }
          curSeason.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
        }
      }

      const mergedSeasons = Array.from(seasonsMap.values()).sort((a, b) => a.seasonNumber - b.seasonNumber);
      const totalEpisodes = mergedSeasons.reduce((sum, s) => sum + s.episodes.length, 0);

      return {
        ...existing,
        seasons: mergedSeasons,
        totalSeasons: mergedSeasons.length,
        totalEpisodes,
        genres: Array.from(new Set([...existing.genres, ...incoming.genres])),
        moods: Array.from(new Set([...existing.moods, ...incoming.moods])),
        artwork: existing.artwork.source !== 'none' ? existing.artwork : incoming.artwork,
        verificationState:
          existing.verificationState === 'VERIFIED' || incoming.verificationState === 'VERIFIED'
            ? 'VERIFIED'
            : incoming.verificationState,
        updatedAt: now,
      };
    }

    return incoming;
  }
}
