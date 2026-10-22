import type { CatalogQuery, CatalogRepository, CatalogStats } from '../interfaces/catalog-repository';
import { isMovie, isSeries, type ContentItem, type Movie, type Series } from '../models/content';

/**
 * In-memory implementation of CatalogRepository for decoupled testing and fast in-memory indexing.
 */
export class InMemoryCatalogRepository implements CatalogRepository {
  private readonly items = new Map<string, ContentItem>();

  public async saveItem(item: ContentItem): Promise<void> {
    this.items.set(item.id, { ...item });
  }

  public async saveItems(items: ContentItem[]): Promise<void> {
    for (const item of items) {
      this.items.set(item.id, { ...item });
    }
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

  public async find(query?: CatalogQuery): Promise<ContentItem[]> {
    let result = Array.from(this.items.values());

    if (query) {
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
        result = result.filter((i) =>
          query.genres!.every((g) => i.genres.includes(g)),
        );
      }

      // Sorting
      const sortBy = query.sortBy ?? 'name';
      const order = query.sortOrder === 'desc' ? -1 : 1;
      result.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'name') {
          cmp = a.name.localeCompare(b.name);
        } else if (sortBy === 'year') {
          cmp = (a.year ?? 0) - (b.year ?? 0);
        } else if (sortBy === 'discoveredAt') {
          cmp = a.discoveredAt - b.discoveredAt;
        } else if (sortBy === 'updatedAt') {
          cmp = a.updatedAt - b.updatedAt;
        }
        return cmp * order;
      });

      // Pagination
      if (query.offset !== undefined && query.offset > 0) {
        result = result.slice(query.offset);
      }
      if (query.limit !== undefined && query.limit > 0) {
        result = result.slice(0, query.limit);
      }
    }

    return result.map((i) => ({ ...i }));
  }

  public async search(text: string, limit: number = 30): Promise<ContentItem[]> {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);

    const matches = Array.from(this.items.values()).filter((item) => {
      const haystack = `${item.name}|${item.originalName ?? ''}|${item.genres.join(' ')}|${item.synopsis ?? ''}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });

    // Score: exact title prefix match gets highest priority
    matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) ? 1 : 0;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 1 : 0;
      return bStarts - aStarts;
    });

    return matches.slice(0, limit).map((i) => ({ ...i }));
  }

  public async remove(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  public async removeBySource(sourceId: string): Promise<number> {
    let count = 0;
    for (const [id, item] of this.items.entries()) {
      if (item.sourceId === sourceId) {
        this.items.delete(id);
        count++;
      }
    }
    return count;
  }

  public async clear(): Promise<void> {
    this.items.clear();
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
        return item.videoUrl;
      }
      item.verificationState = 'REJECTED';
      item.videoUrl = '';
      item.updatedAt = Date.now();
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
      return targetEpFound ? nextUrl : null;
    }

    return null;
  }

  public async markSourceOffline(sourceId: string): Promise<number> {
    let affected = 0;
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
          affected++;
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
          affected++;
        }
      }
    }
    return affected;
  }

  public async getStats(): Promise<CatalogStats> {
    let moviesCount = 0;
    let seriesCount = 0;
    let episodesCount = 0;
    const sources = new Set<string>();
    let lastUpdatedAt = 0;

    for (const item of this.items.values()) {
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
      totalItems: this.items.size,
      moviesCount,
      seriesCount,
      episodesCount,
      sourcesCount: sources.size,
      lastUpdatedAt,
    };
  }
}
