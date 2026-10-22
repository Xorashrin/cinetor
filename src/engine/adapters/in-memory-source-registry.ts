import { generateSourceId } from '../id/id-generator';
import type { SourceFilter, SourceRegistry } from '../interfaces/source-registry';
import { EngineError, EngineErrorCode } from '../models/errors';
import type { MediaSource } from '../models/source';

/**
 * In-memory implementation of SourceRegistry for testing and runtime management.
 */
export class InMemorySourceRegistry implements SourceRegistry {
  private readonly sources = new Map<string, MediaSource>();

  public async addSource(source: Omit<MediaSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<MediaSource> {
    if (!source.baseUrl) {
      throw new EngineError('MediaSource baseUrl is required', EngineErrorCode.INVALID_ARGUMENT);
    }
    const id = generateSourceId(source.baseUrl);
    const now = Date.now();
    const created: MediaSource = {
      ...source,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.sources.set(id, created);
    return { ...created };
  }

  public async getSource(id: string): Promise<MediaSource | null> {
    const s = this.sources.get(id);
    return s ? { ...s } : null;
  }

  public async getAllSources(filter?: SourceFilter): Promise<MediaSource[]> {
    let list = Array.from(this.sources.values());
    if (filter) {
      if (filter.enabledOnly) list = list.filter((s) => s.enabled);
      if (filter.protocol) list = list.filter((s) => s.protocol === filter.protocol);
      if (filter.type) list = list.filter((s) => s.type === filter.type);
    }
    return list.map((s) => ({ ...s }));
  }

  public async getActiveSources(): Promise<MediaSource[]> {
    return Array.from(this.sources.values())
      .filter((s) => s.enabled)
      .sort((a, b) => b.priority - a.priority)
      .map((s) => ({ ...s }));
  }

  public async updateSource(
    id: string,
    patch: Partial<Omit<MediaSource, 'id' | 'createdAt'>>,
  ): Promise<MediaSource> {
    const existing = this.sources.get(id);
    if (!existing) {
      throw new EngineError(`MediaSource not found: ${id}`, EngineErrorCode.SOURCE_NOT_FOUND);
    }
    const updated: MediaSource = {
      ...existing,
      ...patch,
      updatedAt: Date.now(),
    };
    this.sources.set(id, updated);
    return { ...updated };
  }

  public async removeSource(id: string): Promise<boolean> {
    return this.sources.delete(id);
  }

  public async clear(): Promise<void> {
    this.sources.clear();
  }
}
