import { z } from 'zod';
import { EngineError, type Storage } from '../engine/model';

export interface ApprovedEndpoint {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  network: 'wifi';
  allowPlainFtp: boolean;
  allowCleartextHttp?: boolean;
  anonymous?: boolean;
  mappings: { contentKey: string; path: string }[];
}
export interface EngineConfiguration {
  schemaVersion: 1;
  enabledPluginIds: string[];
  endpoints: ApprovedEndpoint[];
}
const KEY = 'cinetor:engine-configuration:v1';
const Mapping = z.object({ contentKey: z.string().regex(/^tmdb:(?:movie:[1-9]\d*|tv:[1-9]\d*:s\d+e[1-9]\d*)$/).max(180), path: z.string().min(1).max(4096) }).refine(row => !/[\r\n\0]/.test(row.path));
const Endpoint = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: z.string().trim().min(1).max(80), url: z.string().max(4096), enabled: z.boolean(), network: z.literal('wifi'), allowPlainFtp: z.boolean(), allowCleartextHttp: z.boolean().optional(), anonymous: z.boolean().optional(), mappings: z.array(Mapping).max(1000) }).superRefine((row, ctx) => {
  try {
    const url = new URL(row.url);
    if (!['http:', 'https:', 'ftp:', 'ftps:'].includes(url.protocol) || url.username || url.password || url.hash || !url.hostname ||
        (url.protocol === 'http:' && row.allowCleartextHttp !== true) || (url.protocol === 'ftp:' && !row.allowPlainFtp) || (['ftp:', 'ftps:'].includes(url.protocol) && row.anonymous !== true)) throw new Error();
    if (new Set(row.mappings.map(mapping => mapping.contentKey)).size !== row.mappings.length) throw new Error();
  } catch { ctx.addIssue({ code: 'custom', message: 'Endpoint protocol, credentials, consent, or duplicate mappings are invalid.' }); }
});
const Configuration = z.object({ schemaVersion: z.literal(1), enabledPluginIds: z.array(z.string().regex(/^[a-zA-Z0-9_.:-]{1,180}$/)).max(100), endpoints: z.array(Endpoint).max(16) }).refine(row => new Set(row.endpoints.map(endpoint => endpoint.id)).size === row.endpoints.length && new Set(row.enabledPluginIds).size === row.enabledPluginIds.length);
export function parseEngineConfiguration(raw: string): EngineConfiguration {
  if (raw.length > 1024 * 1024) throw new EngineError('size');
  let input: unknown;
  try { input = JSON.parse(raw); } catch { throw new EngineError('malformed'); }
  const result = Configuration.safeParse(input);
  if (!result.success) throw new EngineError('configuration');
  return result.data;
}
export class EngineConfigurationStore {
  private current: EngineConfiguration = { schemaVersion: 1, enabledPluginIds: [], endpoints: [] };
  private writable = false;
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private storage: Storage) {}
  getSnapshot(): EngineConfiguration { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async load(): Promise<void> {
    const raw = await this.storage.getItem(KEY);
    this.current = raw ? parseEngineConfiguration(raw) : { schemaVersion: 1, enabledPluginIds: [], endpoints: [] };
    this.writable = true;
    for (const listener of this.listeners) listener();
  }
  private mutate(update: (current: EngineConfiguration) => EngineConfiguration): Promise<void> {
    if (!this.writable) return Promise.reject(new EngineError('storage'));
    const operation = this.queue.catch(() => undefined).then(async () => {
      const next = parseEngineConfiguration(JSON.stringify(update(this.current)));
      await this.storage.setItem(KEY, JSON.stringify(next));
      this.current = next;
      for (const listener of this.listeners) listener();
    });
    this.queue = operation;
    return operation;
  }
  save(snapshot: EngineConfiguration): Promise<void> {
    const next = parseEngineConfiguration(JSON.stringify(snapshot));
    return this.mutate(() => next);
  }
  setPlugin(id: string, enabled: boolean): Promise<void> {
    return this.mutate(current => ({ ...current, enabledPluginIds: enabled ? [...new Set([...current.enabledPluginIds, id])] : current.enabledPluginIds.filter(value => value !== id) }));
  }
  setEndpoint(endpoint: ApprovedEndpoint): Promise<void> {
    return this.mutate(current => ({ ...current, endpoints: [...current.endpoints.filter(row => row.id !== endpoint.id), endpoint] }));
  }
  revokeEndpoint(id: string): Promise<void> { return this.mutate(current => ({ ...current, endpoints: current.endpoints.filter(row => row.id !== id) })); }
}
