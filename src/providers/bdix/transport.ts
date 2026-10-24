import { BDIX_LIMITS, BdixError, type BdixEndpoint, checkAbort } from './paths';
import type { BdixListingEntry } from './listing';

export interface BdixNetworkContext { id: string; epoch: number; transport: 'wifi' }
export interface BdixNetwork { id: string; label: string; selected: boolean }
export interface BdixProbe {
  sizeBytes: number;
  mimeType: string;
  container: 'mp4' | 'mkv' | 'webm';
  networkContext: BdixNetworkContext;
  /** REST comparison is evidence about offset behavior, not a representation validator. */
  restart: 'verified' | 'unsupported' | 'unverified' | 'not-applicable';
  validator?: string;
  providerVersion?: string;
  /** SHA-256 of compiled build inputs; omitted by fixtures/unknown adapters, never synthesized. */
  providerHash?: string;
}
export interface BdixPrepared extends BdixProbe {
  uri: string;
  token: string;
  expiresAt: number;
  representationId: string;
  representationValidator: string;
}
export interface BdixListResponse {
  url: string;
  networkContext: BdixNetworkContext;
  bytes: number;
  observedItems?: number;
  contentType?: string;
  text?: string;
  entries?: BdixListingEntry[];
}
export interface BdixSnapshot { uri: string; sizeBytes: number; sha256: string; mimeType: string }
export interface BdixTransferStatus {
  state: 'transferring' | 'complete' | 'failed';
  bytes: number;
  sizeBytes: number;
  reason?: string;
  representationId?: string;
  sha256?: string;
}

/** The injected transport is a trust boundary: it must enforce native consent and routing too. */
export interface BdixTransport {
  configure(endpoints: ReadonlyArray<BdixEndpoint>): Promise<void>;
  context(signal?: AbortSignal): Promise<BdixNetworkContext>;
  list(endpoint: BdixEndpoint, url: string, limits: { maxBytes: number; maxItems: number }, signal: AbortSignal): Promise<BdixListResponse>;
  probe(endpoint: BdixEndpoint, path: string, signal: AbortSignal): Promise<BdixProbe>;
  preparePlayback(endpoint: BdixEndpoint, path: string, signal: AbortSignal): Promise<BdixPrepared>;
  release(token: string): Promise<void>;
  subscribe?(listener: () => void): () => void;
  copySnapshot?(token: string, signal?: AbortSignal): Promise<BdixSnapshot>;
  transferStatus?(token: string): Promise<BdixTransferStatus>;
}

/** Expo's map/JSON boundary contains no credentials or remotely supplied executable code. */
export interface CinetorBdixNative {
  readonly sourceVersion: string;
  readonly sourceSha256: string;
  configure(endpointsJson: string): Promise<void>;
  getNetworks(): Promise<BdixNetwork[]>;
  selectNetwork(id: string): Promise<BdixNetworkContext>;
  getNetworkContext(): Promise<BdixNetworkContext | null>;
  list(requestId: string, endpointId: string, url: string, maxBytes: number, maxItems: number): Promise<BdixListResponse>;
  probe(requestId: string, endpointId: string, path: string): Promise<BdixProbe>;
  preparePlayback(requestId: string, endpointId: string, path: string, maxBytes: number): Promise<BdixPrepared>;
  transferStatus(token: string): Promise<BdixTransferStatus>;
  copySnapshot(requestId: string, token: string): Promise<BdixSnapshot>;
  release(token: string): Promise<void>;
  cancel(requestId: string): void;
  addListener(event: 'onNetworkContext', listener: () => void): { remove(): void };
}

let requestSequence = 0;
const errorCodes = new Set(['configuration', 'offline', 'timeout', 'cancelled', 'network', 'authentication', 'permission', 'http', 'rate-limit', 'size', 'malformed', 'unsupported', 'scope', 'storage']);
function nativeError(error: unknown): BdixError {
  if (error instanceof BdixError) return error;
  const value = error as { code?: string; message?: string } | null;
  const code = String(value?.code ?? '').replace(/^ERR_BDIX_/, '').toLowerCase();
  if (errorCodes.has(code)) return new BdixError(code as ConstructorParameters<typeof BdixError>[0], String(value?.message ?? code));
  return new BdixError('network', 'native-operation-failed');
}

/** No JS fetch fallback: React Native fetch cannot guarantee selected-Network binding. */
export class NativeBdixTransport implements BdixTransport {
  constructor(readonly native: CinetorBdixNative | null) {}
  private bridge(): CinetorBdixNative {
    if (!this.native) throw new BdixError('unsupported', 'android-native-build-required');
    return this.native;
  }
  private async invoke<T>(signal: AbortSignal | undefined, operation: (bridge: CinetorBdixNative, id: string) => Promise<T>, cleanup?: (value: T) => Promise<void>): Promise<T> {
    checkAbort(signal);
    const native = this.bridge();
    const id = `bdix-${Date.now().toString(36)}-${++requestSequence}`;
    let completed = false;
    const abort = () => { if (!completed) native.cancel(id); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      checkAbort(signal);
      const value = await operation(native, id);
      if (signal?.aborted) { await cleanup?.(value); throw new BdixError('cancelled'); }
      return value;
    } catch (error) {
      if (signal?.aborted) throw new BdixError('cancelled');
      throw nativeError(error);
    } finally { completed = true; signal?.removeEventListener('abort', abort); }
  }
  async configure(endpoints: ReadonlyArray<BdixEndpoint>): Promise<void> {
    try { await this.bridge().configure(JSON.stringify(endpoints)); } catch (error) { throw nativeError(error); }
  }
  async context(signal?: AbortSignal): Promise<BdixNetworkContext> {
    checkAbort(signal);
    try {
      const context = await this.bridge().getNetworkContext();
      checkAbort(signal);
      if (!context) throw new BdixError('offline', 'select-wifi-network');
      return context;
    } catch (error) { throw nativeError(error); }
  }
  list(endpoint: BdixEndpoint, url: string, limits: { maxBytes: number; maxItems: number }, signal: AbortSignal): Promise<BdixListResponse> {
    return this.invoke(signal, (native, id) => native.list(id, endpoint.id, url, limits.maxBytes, limits.maxItems));
  }
  probe(endpoint: BdixEndpoint, path: string, signal: AbortSignal): Promise<BdixProbe> {
    return this.invoke(signal, (native, id) => native.probe(id, endpoint.id, path));
  }
  preparePlayback(endpoint: BdixEndpoint, path: string, signal: AbortSignal): Promise<BdixPrepared> {
    return this.invoke(signal, (native, id) => native.preparePlayback(id, endpoint.id, path, BDIX_LIMITS.fileBytes), value => this.release(value.token));
  }
  async release(token: string): Promise<void> { try { await this.bridge().release(token); } catch (error) { throw nativeError(error); } }
  copySnapshot(token: string, signal?: AbortSignal): Promise<BdixSnapshot> { return this.invoke(signal, (native, id) => native.copySnapshot(id, token)); }
  async transferStatus(token: string): Promise<BdixTransferStatus> {
    try { return await this.bridge().transferStatus(token); } catch (error) { throw nativeError(error); }
  }
  subscribe(listener: () => void): () => void {
    const subscription = this.native?.addListener('onNetworkContext', listener);
    return () => subscription?.remove();
  }
}

export function contextKey(context: BdixNetworkContext): string {
  if (!context || typeof context.id !== 'string' || !/^\d{1,20}$/.test(context.id) || context.transport !== 'wifi' || !Number.isSafeInteger(context.epoch) || context.epoch < 0)
    throw new BdixError('scope', 'invalid-network-context');
  return `wifi:${context.id}:${context.epoch}`;
}
