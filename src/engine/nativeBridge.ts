import { requireOptionalNativeModule } from 'expo-modules-core';
import { EngineError } from './model';
import type { NativeMediaProbeResult } from '../providers/nativeProbeValidation';
import type { RepositoryDocument } from '../providers/repositories';

export type NativeResultStatus = 'ok' | 'empty' | 'unsupported' | 'auth' | 'timeout' | 'cancelled' | 'error';
export interface NativeEngineResult {
  requestId: string;
  contentKey?: string;
  status: NativeResultStatus;
  sources?: unknown[];
  items?: unknown[];
  item?: unknown;
  error?: { code?: string; message?: string };
  probe?: NativeMediaProbeResult;
  document?: RepositoryDocument;
}
export interface NativePluginInfo {
  id: string;
  pluginId?: string;
  name: string;
  engine: 'nuvio' | 'cloudstream';
  version: string | number;
  hash?: string;
  sha256?: string;
  enabled: boolean;
  reviewed: boolean;
  status?: string;
  disabledReason?: string;
  installed?: boolean;
  settingsAvailable?: boolean;
}
export interface NativeProviderInfo {
  id?: string;
  providerId: string;
  pluginId: string;
  name: string;
  status?: string;
}
export interface NativeEngineInventory { plugins: NativePluginInfo[]; providers: NativeProviderInfo[] }
interface CinetorEngineModule {
  capabilities(): Promise<Record<string, unknown>>;
  inventory(): Promise<NativeEngineInventory>;
  installNuvio(input: { pluginId: string }): Promise<unknown>;
  installCloudstream(input: { pluginId: string }): Promise<unknown>;
  resolveNuvio(input: Record<string, unknown>): Promise<NativeEngineResult>;
  searchCloudstream(input: Record<string, unknown>): Promise<NativeEngineResult>;
  loadCloudstream(input: Record<string, unknown>): Promise<NativeEngineResult>;
  resolveCloudstream(input: Record<string, unknown>): Promise<NativeEngineResult>;
  probeMedia(input: Record<string, unknown>): Promise<NativeEngineResult>;
  inspectRepository(input: Record<string, unknown>): Promise<NativeEngineResult>;
  cancel(input: { requestId: string }): Promise<unknown>;
  readSettings(input: { pluginId: string; profileId: string }): Promise<unknown>;
  writeSettings(input: { pluginId: string; profileId: string; settings: Record<string, unknown> }): Promise<unknown>;
  nuvioSettings?(input: Record<string, unknown>): Promise<NativeEngineResult>;
  openCloudstreamSettings?(input: { pluginId: string }): Promise<unknown>;
}
let loaded: CinetorEngineModule | null | undefined;
function native(): CinetorEngineModule {
  if (loaded === undefined) loaded = requireOptionalNativeModule<CinetorEngineModule>('CinetorEngines');
  if (!loaded) throw new EngineError('unsupported');
  return loaded;
}
const statuses = new Set<NativeResultStatus>(['ok', 'empty', 'unsupported', 'auth', 'timeout', 'cancelled', 'error']);
export function nativeResult(input: unknown, requestId: string): NativeEngineResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EngineError('malformed');
  const result = input as NativeEngineResult;
  if (result.requestId !== requestId || !statuses.has(result.status)) throw new EngineError('malformed');
  if (result.status === 'auth') throw new EngineError('authentication');
  if (result.status === 'unsupported') throw new EngineError('unsupported');
  if (result.status === 'timeout') throw new EngineError('timeout');
  if (result.status === 'cancelled') throw new EngineError('cancelled');
  if (result.status === 'error') throw new EngineError('malformed');
  return result;
}
function checkedOperation(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new EngineError('malformed');
  const row = input as Record<string, unknown>;
  const requestId = typeof row.requestId === 'string' ? row.requestId : 'operation';
  nativeResult({ ...row, requestId }, requestId);
  if (row.status !== 'ok') throw new EngineError('unsupported');
  return row;
}
export const engineNative = {
  available(): boolean {
    try { native(); return true; } catch { return false; }
  },
  capabilities: () => native().capabilities(),
  inventory: () => native().inventory(),
  install: async (engine: 'nuvio' | 'cloudstream', pluginId: string) => checkedOperation(await (engine === 'nuvio' ? native().installNuvio({ pluginId }) : native().installCloudstream({ pluginId }))),
  readSettings: async (pluginId: string, profileId: string): Promise<Record<string, unknown>> => {
    const row = checkedOperation(await native().readSettings({ pluginId, profileId }));
    if (row.pluginId !== pluginId || row.profileId !== profileId || !row.settings || typeof row.settings !== 'object' || Array.isArray(row.settings)) throw new EngineError('malformed');
    return row.settings as Record<string, unknown>;
  },
  writeSettings: async (pluginId: string, profileId: string, settings: Record<string, unknown>) => checkedOperation(await native().writeSettings({ pluginId, profileId, settings })),
  openCloudstreamSettings: async (pluginId: string) => {
    const method = native().openCloudstreamSettings;
    if (!method) throw new EngineError('unsupported');
    return checkedOperation(await method({ pluginId }));
  },
  async invoke(method: 'resolveNuvio' | 'searchCloudstream' | 'loadCloudstream' | 'resolveCloudstream' | 'probeMedia' | 'inspectRepository', payload: Record<string, unknown>, signal?: AbortSignal): Promise<NativeEngineResult> {
    if (signal?.aborted) throw new EngineError('cancelled');
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const duration = Math.max(1, Math.min(45000, typeof payload.deadlineMs === 'number' ? payload.deadlineMs : 20000));
    let timeout = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => {
      onAbort = () => { void native().cancel({ requestId }).catch(() => undefined); reject(new EngineError(timeout ? 'timeout' : 'cancelled')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { timeout = true; onAbort(); }, duration);
    });
    try {
      const value = await Promise.race([native()[method]({ ...payload, requestId, deadlineMs: duration }), stopped]);
      if (signal?.aborted) throw new EngineError('cancelled');
      return nativeResult(value, requestId);
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
