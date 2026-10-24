import type { PlaybackSourceRef, Title } from '../data/mock';
import { contentKey, type ContentRef } from './contracts';
import { engineNative } from './nativeBridge';
import { EngineError } from './model';
import { ProviderRegistry } from '../providers/registry';
import { cloudstreamMapping, normalizePluginSources, type ExactCloudstreamMapping } from '../providers/pluginContracts';
import { publicUrl } from '../providers/request';
import type { CandidateAdapter } from './resolution';

export class NativePluginResolver {
  private mappings = new Map<string, ExactCloudstreamMapping>();
  private rotation = 0;
  constructor(private registry: ProviderRegistry) {}
  shortlist(title: Title, ref: ContentRef, profileId: string, networkContext: string, remaining: () => number): CandidateAdapter[] {
    const contextKey = contentKey(ref);
    const candidates: CandidateAdapter[] = [];
    for (const engine of ['nuvio', 'cloudstream'] as const) {
      const plugins = this.registry.enabled(engine);
      if (!plugins.length) continue;
      const choices = plugins.flatMap(plugin => engine === 'cloudstream'
        ? this.registry.getSnapshot().providers.filter(row => row.pluginId === plugin.id).map(provider => ({ plugin, providerId: provider.providerId }))
        : [{ plugin, providerId: plugin.id }]);
      if (!choices.length) continue;
      const { plugin, providerId } = choices[this.rotation % choices.length];
      const hash = plugin.hash!;
      candidates.push({ id: providerId, local: false, resolve: async signal => {
        if (signal.aborted || remaining() <= 0) throw new EngineError('cancelled');
        let result;
        if (engine === 'nuvio') {
          result = await engineNative.invoke('resolveNuvio', { pluginId: plugin.id, tmdbId: String(ref.externalId), mediaType: ref.mediaType, season: ref.season, episode: ref.episode, contentKey: contextKey, profileId, deadlineMs: remaining() }, signal);
        } else {
          const key = `${providerId}:${hash}:${contextKey}:${profileId}`;
          let mapping = this.mappings.get(key);
          if (!mapping || Date.now() - mapping.checkedAt > 21600000) {
            const search = await engineNative.invoke('searchCloudstream', { providerId, query: title.name, page: 1, profileId, deadlineMs: remaining() }, signal);
            if (!Array.isArray(search.items)) return [];
            for (const item of search.items.slice(0, 3)) {
              if (signal.aborted || remaining() <= 0) throw new EngineError('cancelled');
              const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
              if (!row || typeof row.url !== 'string') continue;
              let url: string;
              try { url = publicUrl(row.url); } catch { continue; }
              const loaded = await engineNative.invoke('loadCloudstream', { providerId, url, profileId, deadlineMs: remaining() }, signal);
              mapping = cloudstreamMapping(loaded.item, ref, { id: plugin.id, providerId, hash });
              if (mapping) break;
            }
            if (!mapping) return [];
            this.mappings.set(key, mapping);
            while (this.mappings.size > 100) this.mappings.delete(this.mappings.keys().next().value!);
          }
          result = await engineNative.invoke('resolveCloudstream', { providerId, data: mapping.data, opaqueData: mapping.data, contentKey: contextKey, profileId, deadlineMs: remaining() }, signal);
        }
        if (result.status === 'empty') return [];
        if (result.contentKey !== contextKey) throw new EngineError('configuration');
        return normalizePluginSources(result.sources, engine, ref, { providerId, providerVersion: String(plugin.version), providerHash: hash, networkContext, profileId });
      } });
    }
    this.rotation++;
    return candidates;
  }
  invalidate(source: PlaybackSourceRef): void {
    for (const [key, mapping] of this.mappings) if (mapping.providerId === source.providerId && mapping.contentKey === source.contentKey) this.mappings.delete(key);
  }
  clear(): void { this.mappings.clear(); }
}
