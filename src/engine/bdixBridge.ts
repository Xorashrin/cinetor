import nativeBdix from '../../modules/cinetor-bdix';
import { BdixEngine, NativeBdixTransport, type BdixEndpoint } from '../providers/bdix';
import type { PlaybackSourceRef } from '../data/mock';
import type { ContentRef } from './contracts';
import { contentKey } from './contracts';
import { EngineError } from './model';
import { probePool } from './coordinator';
import type { ApprovedEndpoint, EngineConfigurationStore } from '../providers/engineConfiguration';

let instance: BdixEngine | undefined;
function engine(): BdixEngine {
  if (!nativeBdix) throw new EngineError('unsupported');
  if (!instance) instance = new BdixEngine(new NativeBdixTransport(nativeBdix));
  return instance;
}
export const bdix = {
  available: () => !!nativeBdix,
  async configure(endpoints: ApprovedEndpoint[]): Promise<void> {
    if (!nativeBdix && !endpoints.length) return;
    await engine().configure(endpoints as BdixEndpoint[]);
  },
  async networks(): Promise<{ id: string; label: string; selected: boolean }[]> {
    if (!nativeBdix) return [];
    return nativeBdix.getNetworks();
  },
  async selectNetwork(id: string): Promise<void> {
    if (!nativeBdix) throw new EngineError('unsupported');
    await nativeBdix.selectNetwork(id);
  },
  async networkContext(): Promise<string | undefined> {
    if (!nativeBdix) return undefined;
    const context = await nativeBdix.getNetworkContext();
    return context ? `wifi:${context.id}:${context.epoch}` : undefined;
  },
  eligible(config: EngineConfigurationStore, ref: ContentRef, networkContext?: string): boolean {
    return !!nativeBdix && !!networkContext && config.getSnapshot().endpoints.some(endpoint => endpoint.enabled && endpoint.mappings.some(mapping => mapping.contentKey === contentKey(ref)));
  },
  async resolve(ref: ContentRef, profileId: string, signal: AbortSignal): Promise<PlaybackSourceRef[]> {
    const refs = await probePool.run(() => engine().resolve(ref, signal), signal);
    return refs.map(source => ({ ...source, networkContext: typeof source.networkContext === 'string' ? source.networkContext : undefined,
      contentKey: contentKey(ref), engine: 'bdix', accessContext: `profile:${profileId}`, locality: 'approved-network',
      verificationState: 'transport-verified' }));
  },
  async index(endpointId: string, signal?: AbortSignal): Promise<{ count: number }> {
    const value = await engine().index(endpointId, signal);
    return { count: value.files.length };
  },
  async release(source: PlaybackSourceRef): Promise<void> {
    if (source.nativeToken && instance) await instance.close(source.nativeToken);
  },
  async dispose(): Promise<void> { if (instance) await instance.dispose(); },
};
