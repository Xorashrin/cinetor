import { z } from 'zod';
import { EngineError } from '../engine/model';
import { engineNative, type NativeEngineInventory, type NativePluginInfo, type NativeProviderInfo } from '../engine/nativeBridge';
import { EngineConfigurationStore } from './engineConfiguration';

const Plugin = z.object({
  id: z.string().max(180).optional(), pluginId: z.string().max(180).optional(),
  name: z.string().max(200), engine: z.enum(['nuvio', 'cloudstream']),
  version: z.union([z.string().max(100), z.number().int()]),
  hash: z.string().optional(), sha256: z.string().optional(),
  enabled: z.boolean().optional(), reviewed: z.boolean().optional(), installed: z.boolean().optional(),
  status: z.string().optional(), disabledReason: z.string().max(1000).optional(), settingsAvailable: z.boolean().optional(),
}).passthrough();
const Provider = z.object({ id: z.string().optional(), providerId: z.string().optional(), pluginId: z.string(), name: z.string().max(200), status: z.string().optional() }).passthrough();
const Inventory = z.object({ plugins: z.array(Plugin).max(1000), providers: z.array(Provider).max(2000) });
export interface RegistrySnapshot { state: 'loading' | 'ready' | 'unavailable' | 'error'; plugins: NativePluginInfo[]; providers: NativeProviderInfo[]; lastError?: string }

/** The app admits native artifacts by built-in reviewed ID, never pasted code or arbitrary URLs. */
export class ProviderRegistry {
  private value: RegistrySnapshot = { state: 'loading', plugins: [], providers: [] };
  private listeners = new Set<() => void>();
  private refreshing?: Promise<void>;
  constructor(private config: EngineConfigurationStore) {}
  getSnapshot = (): RegistrySnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: RegistrySnapshot): void { this.value = value; for (const listener of this.listeners) listener(); }
  plugin(id: string): NativePluginInfo | undefined { return this.value.plugins.find(row => row.id === id); }
  enabled(engine: 'nuvio' | 'cloudstream'): NativePluginInfo[] {
    return this.value.plugins.filter(row => row.engine === engine && row.enabled && row.reviewed && !!row.hash);
  }
  async refresh(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new EngineError('cancelled');
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!engineNative.available()) { this.publish({ state: 'unavailable', plugins: [], providers: [], lastError: 'Native engine modules are not installed in this app build.' }); return; }
      try {
        const raw = Inventory.safeParse(await engineNative.inventory());
        if (!raw.success) throw new EngineError('malformed');
        if (signal?.aborted) throw new EngineError('cancelled');
        const enabled = this.config.getSnapshot().enabledPluginIds;
        const plugins: NativePluginInfo[] = raw.data.plugins.flatMap(row => {
          const id = row.id ?? row.pluginId;
          if (!id) return [];
          const hash = row.hash ?? row.sha256;
          const integrity = !!hash && /^[a-f0-9]{64}$/i.test(hash);
          return [{ ...row, id, hash: integrity ? hash?.toLowerCase() : undefined,
            enabled: enabled.includes(id) && row.enabled !== false && integrity && row.reviewed === true,
            reviewed: row.reviewed === true, disabledReason: !integrity ? 'Artifact hash is not available in this build.' : row.disabledReason } as NativePluginInfo];
        });
        const providers: NativeProviderInfo[] = raw.data.providers.flatMap(row => {
          const providerId = row.providerId ?? row.id;
          return providerId ? [{ ...row, providerId }] : [];
        });
        this.publish({ state: 'ready', plugins, providers });
      } catch (error) {
        if (signal?.aborted) throw new EngineError('cancelled');
        this.publish({ ...this.value, state: 'error', lastError: error instanceof EngineError ? error.code : 'Native provider inventory could not be read.' });
        throw error;
      }
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const plugin = this.plugin(id);
    if (!plugin || !plugin.reviewed || !plugin.hash) throw new EngineError('configuration');
    if (enabled) await engineNative.install(plugin.engine, id);
    await this.config.setPlugin(id, enabled);
    await this.refresh();
  }
  inventory(): NativeEngineInventory { return { plugins: this.value.plugins, providers: this.value.providers }; }
}

export const historicalInventory = [
  { engine: 'nuvio' as const, summary: '162 website entries / 11 packs and 279 manifest entries / 9 manifests', status: 'NOT RUN', detail: 'Overlapping historical snapshots, not 441 working providers. Original manifests, identifiers, and review receipts were not supplied. Two historical manifest failures remain unverified.' },
  { engine: 'cloudstream' as const, summary: '47 historical URLs / 558 reported index entries', status: 'NOT RUN', detail: 'Original 32 descriptors, 31 indexes, aliases, and plugin review receipts were not supplied. Historical 404/403 and publisher flags are not current playback evidence.' },
];
