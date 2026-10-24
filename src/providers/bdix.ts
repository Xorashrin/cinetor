import type { PlaybackSourceRef } from '../data/mock';
import { BDIX_LIMITS, BdixError, type BdixContentRef, type BdixEndpoint, checkAbort, containedUrl, contentKey, mediaContainer, normalizeEndpoints, utf8Length } from './bdix/paths';
import { parseBdixListing, type BdixListingEntry } from './bdix/listing';
import { contextKey, NativeBdixTransport, type BdixNetworkContext, type BdixPrepared, type BdixProbe, type BdixSnapshot, type BdixTransferStatus, type BdixTransport, type CinetorBdixNative } from './bdix/transport';

export { BDIX_LIMITS, BdixError, contentKey, normalizeEndpoints } from './bdix/paths';
export type { BdixContentRef, BdixEndpoint } from './bdix/paths';
export { NativeBdixTransport } from './bdix/transport';
export type { BdixTransport, CinetorBdixNative, BdixNetworkContext, BdixProbe, BdixSnapshot, BdixTransferStatus } from './bdix/transport';

export interface BdixPlaybackSource extends Omit<PlaybackSourceRef, 'networkContext' | 'container'> {
  engine: 'bdix';
  container: 'mp4' | 'mkv' | 'webm';
  mimeType: string;
  providerId: string;
  providerVersion?: string;
  providerHash?: string;
  representationId: string;
  representationValidator: string;
  contentKey: string;
  networkContext: string;
  bdixNetworkContext: BdixNetworkContext;
  nativeToken: string;
  expiresAt: number;
  restart: BdixProbe['restart'];
}
export interface BdixIndex {
  endpointId: string;
  networkContext: BdixNetworkContext;
  files: Array<BdixListingEntry & { contentKey?: string }>;
  pages: number;
  bytes: number;
  rejected: number;
  ambiguous: string[];
  truncated: boolean;
}

/** Opt-in exact-identity engine. Construction/configuration never index, probe, or scan. */
export class BdixEngine {
  private endpoints: ReadonlyArray<BdixEndpoint> = [];
  private generation = 0;
  private controllers = new Set<AbortController>();
  private tokens = new Map<string, BdixPlaybackSource>();
  private stopListening: () => void;
  private configuration: Promise<void> = Promise.resolve();
  private transport: BdixTransport;
  private disposed = false;

  constructor(transport: BdixTransport | CinetorBdixNative) {
    this.transport = 'getNetworkContext' in transport ? new NativeBdixTransport(transport) : transport;
    this.stopListening = this.transport.subscribe?.(() => { void this.invalidate().catch(() => undefined); }) ?? (() => undefined);
  }

  private async invalidate(): Promise<void> {
    this.generation++;
    for (const controller of this.controllers) controller.abort();
    const tokens = [...this.tokens.keys()];
    this.tokens.clear();
    await Promise.allSettled(tokens.map(token => this.transport.release(token)));
  }

  async configure(endpoints: ReadonlyArray<BdixEndpoint>): Promise<void> {
    if (this.disposed) throw new BdixError('configuration', 'engine-disposed');
    const normalized = normalizeEndpoints(endpoints);
    const invalidation = this.invalidate();
    const generation = this.generation;
    this.endpoints = [];
    const operation = this.configuration.catch(() => undefined).then(async () => {
      await invalidation;
      await this.transport.configure(normalized);
      if (this.generation === generation && !this.disposed) this.endpoints = normalized;
    });
    this.configuration = operation;
    return operation;
  }

  private endpoint(id: string): BdixEndpoint {
    const endpoint = this.endpoints.find(value => value.id === id && value.enabled);
    if (!endpoint) throw new BdixError('permission', 'endpoint-not-approved');
    return endpoint;
  }

  private async operation<T>(signal: AbortSignal | undefined, action: (signal: AbortSignal, network: BdixNetworkContext) => Promise<T>): Promise<T> {
    checkAbort(signal);
    if (this.disposed) throw new BdixError('configuration', 'engine-disposed');
    const generation = this.generation;
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    this.controllers.add(controller);
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, BDIX_LIMITS.batchMs);
    try {
      await this.configuration;
      checkAbort(signal);
      checkAbort(controller.signal);
      if (generation !== this.generation) throw new BdixError('cancelled', 'consent-changed');
      const context = await this.transport.context(controller.signal);
      contextKey(context);
      checkAbort(controller.signal);
      const value = await action(controller.signal, context);
      checkAbort(controller.signal);
      if (generation !== this.generation || contextKey(await this.transport.context(controller.signal)) !== contextKey(context))
        throw new BdixError('cancelled', 'network-context-changed');
      checkAbort(controller.signal);
      if (generation !== this.generation) throw new BdixError('cancelled', 'consent-changed');
      return value;
    } catch (error) {
      if (timedOut) throw new BdixError('timeout');
      if (controller.signal.aborted) throw new BdixError('cancelled');
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel); this.controllers.delete(controller);
    }
  }

  /** Explicit user-triggered listing only. resolve() does not call this method. */
  async index(endpointId: string, signal?: AbortSignal): Promise<BdixIndex> {
    return this.operation(signal, async (batchSignal, network) => {
      const endpoint = this.endpoint(endpointId);
      const queue = [{ url: endpoint.url, depth: 0 }], visited = new Set<string>([endpoint.url]);
      const files = new Map<string, BdixListingEntry>(), ambiguous = new Set<string>();
      let pages = 0, bytes = 0, rejected = 0, truncated = false, observed = 0;
      while (queue.length && pages < BDIX_LIMITS.pages && observed < BDIX_LIMITS.items) {
        checkAbort(batchSignal);
        // Reserve bytes before issuing a batch, not after concurrently reading unbounded bodies.
        const capacity = Math.floor((BDIX_LIMITS.totalBytes - bytes) / BDIX_LIMITS.pageBytes);
        if (!capacity) { truncated = true; break; }
        const batch = queue.splice(0, Math.min(BDIX_LIMITS.concurrency, capacity, BDIX_LIMITS.pages - pages, BDIX_LIMITS.items - observed));
        const pageItems = Math.max(1, Math.floor((BDIX_LIMITS.items - observed) / batch.length));
        const batchController = new AbortController();
        const cancel = () => batchController.abort();
        batchSignal.addEventListener('abort', cancel, { once: true });
        if (batchSignal.aborted) cancel();
        const requests = batch.map(async item => {
          try {
            checkAbort(batchController.signal);
            const result = await this.transport.list(endpoint, item.url, { maxBytes: BDIX_LIMITS.pageBytes, maxItems: pageItems }, batchController.signal);
            if (contextKey(result.networkContext) !== contextKey(network)) throw new BdixError('scope', 'network-context-changed');
            if (!Number.isSafeInteger(result.bytes) || result.bytes < 0 || result.bytes > BDIX_LIMITS.pageBytes) throw new BdixError('size', 'listing-byte-limit');
            // Redirects are forbidden by native code; require the same page even for injected transports.
            if (containedUrl(endpoint.url, result.url, endpoint.url, true) !== item.url) throw new BdixError('scope', 'redirect-not-approved');
            if (result.text !== undefined) {
              if (result.entries !== undefined) throw new BdixError('malformed', 'mixed-listing-response');
              if (result.bytes < utf8Length(result.text)) throw new BdixError('malformed', 'listing-byte-count-mismatch');
              return { item, result, listing: parseBdixListing(result.text, { root: endpoint.url, url: item.url, contentType: result.contentType ?? '', maxItems: pageItems, signal: batchController.signal }) };
            }
            if (!Array.isArray(result.entries) || result.entries.length > pageItems) throw new BdixError('malformed', 'invalid-native-listing');
            const observedItems = result.observedItems ?? result.entries.length;
            if (!Number.isSafeInteger(observedItems) || observedItems < result.entries.length || observedItems > pageItems) throw new BdixError('size', 'listing-item-limit');
            return { item, result, listing: { entries: result.entries, next: [] as string[], rejected: observedItems - result.entries.length, observed: observedItems, ambiguous: [] as string[] } };
          } catch (error) { batchController.abort(); throw error; }
        });
        const results = await Promise.allSettled(requests);
        batchSignal.removeEventListener('abort', cancel);
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
        for (const outcome of results) {
          if (outcome.status !== 'fulfilled') continue;
          const { item, result, listing } = outcome.value;
          pages++; bytes += result.bytes; rejected += listing.rejected;
          observed += listing.observed;
          if (observed > BDIX_LIMITS.items) throw new BdixError('size', 'index-item-limit');
          for (const url of listing.ambiguous) { files.delete(url); ambiguous.add(url); }
          const enqueue = (url: string, depth: number) => {
            const path = new URL(url).pathname;
            const actualDepth = path.slice(new URL(endpoint.url).pathname.length).split('/').filter(Boolean).length - (path.endsWith('/') ? 0 : 1);
            if (depth > BDIX_LIMITS.depth || actualDepth > BDIX_LIMITS.depth) { truncated = true; return; }
            if (!visited.has(url)) {
              if (visited.size >= BDIX_LIMITS.items) { truncated = true; return; }
              visited.add(url); queue.push({ url, depth });
            }
          };
          for (const entry of listing.entries) {
            if (!entry || typeof entry.url !== 'string' || typeof entry.name !== 'string' || entry.name.length > 512 || !['file', 'directory'].includes(entry.kind) ||
                (entry.sizeBytes !== undefined && (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0))) { rejected++; continue; }
            let url: string;
            try { url = containedUrl(endpoint.url, entry.url, item.url); } catch { rejected++; continue; }
            if (entry.kind === 'directory') {
              if (!new URL(url).pathname.endsWith('/')) { rejected++; continue; }
              enqueue(url, item.depth + 1);
            } else if (mediaContainer(url) && !ambiguous.has(url)) {
              const actualDepth = new URL(url).pathname.slice(new URL(endpoint.url).pathname.length).split('/').length - 1;
              if (actualDepth > BDIX_LIMITS.depth) { truncated = true; continue; }
              const old = files.get(url);
              if (old && old.sizeBytes !== undefined && entry.sizeBytes !== undefined && old.sizeBytes !== entry.sizeBytes) {
                files.delete(url); ambiguous.add(url); rejected++;
              } else if (!old) files.set(url, { ...entry, url });
            }
          }
          for (const url of listing.next) enqueue(containedUrl(endpoint.url, url, item.url, true), item.depth);
        }
      }
      const mappings = new Map(endpoint.mappings.map(mapping => [mapping.path, mapping.contentKey]));
      return { endpointId, networkContext: network, files: [...files.values()].map(file => ({ ...file, contentKey: mappings.get(file.url) })), pages, bytes,
        rejected, ambiguous: [...ambiguous], truncated: truncated || queue.length > 0 };
    });
  }

  async probe(endpointId: string, ref: BdixContentRef, signal?: AbortSignal): Promise<BdixProbe> {
    const key = contentKey(ref);
    return this.operation(signal, async (requestSignal, network) => {
      const endpoint = this.endpoint(endpointId);
      const path = endpoint.mappings.find(mapping => mapping.contentKey === key)?.path;
      if (!path) throw new BdixError('configuration', 'canonical-mapping-required');
      const result = await this.transport.probe(endpoint, path, requestSignal);
      this.validateProbe(result, network);
      return result;
    });
  }

  private validateProbe(result: BdixProbe, network: BdixNetworkContext): void {
    if (contextKey(result.networkContext) !== contextKey(network)) throw new BdixError('scope', 'network-context-changed');
    if (!Number.isSafeInteger(result.sizeBytes) || result.sizeBytes < 16 || result.sizeBytes > BDIX_LIMITS.fileBytes ||
        !['mp4', 'mkv', 'webm'].includes(result.container) || result.mimeType !== ({ mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm' } as const)[result.container] ||
        !['verified', 'unsupported', 'unverified', 'not-applicable'].includes(result.restart))
      throw new BdixError('unsupported', 'invalid-progressive-media');
  }

  private validatePrepared(result: BdixPrepared, network: BdixNetworkContext): void {
    this.validateProbe(result, network);
    let url: URL;
    try { url = new URL(result.uri); } catch { throw new BdixError('scope', 'invalid-local-capability'); }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash ||
        !/^[a-zA-Z0-9_-]{43}$/.test(result.token) || url.pathname !== `/media/${result.token}/video.${result.container}` ||
        !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() ||
        !/^bdix-spool:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(result.representationId) ||
        result.representationValidator !== `"bdix-${result.representationId.slice('bdix-spool:'.length)}"`)
      throw new BdixError('scope', 'invalid-local-capability');
  }

  /** Exact saved pins only; no directory search, remote filename fallback, or network discovery. */
  async resolve(ref: BdixContentRef, signal?: AbortSignal): Promise<BdixPlaybackSource[]> {
    const key = contentKey(ref);
    const prepared: BdixPrepared[] = [];
    try {
      return await this.operation(signal, async (requestSignal, network) => {
        const sources: BdixPlaybackSource[] = [];
        let failure: unknown;
        // Serial candidates stay below the parent's shared resolver/probe ceilings.
        for (const endpoint of this.endpoints.filter(item => item.enabled)) {
          checkAbort(requestSignal);
          const mapping = endpoint.mappings.find(item => item.contentKey === key);
          if (!mapping) continue;
          let candidate: BdixPrepared | undefined;
          try {
            const result = await this.transport.preparePlayback(endpoint, mapping.path, requestSignal);
            candidate = result;
            prepared.push(result);
            this.validatePrepared(result, network);
            const source: BdixPlaybackSource = {
              url: result.uri, engine: 'bdix', providerId: endpoint.id, sourceId: `bdix:${endpoint.id}`, contentKey: key,
              ...(result.providerVersion && result.providerHash && /^[a-f0-9]{64}$/.test(result.providerHash)
                ? { providerVersion: result.providerVersion, providerHash: result.providerHash } : {}),
              label: endpoint.name, verificationState: 'transport-verified', container: result.container, mimeType: result.mimeType,
              fileSizeBytes: result.sizeBytes, downloadable: result.container === 'mp4', networkContext: contextKey(result.networkContext), bdixNetworkContext: result.networkContext,
              nativeToken: result.token, expiresAt: result.expiresAt, restart: result.restart,
              representationId: result.representationId, representationValidator: result.representationValidator,
            };
            sources.push(source);
            // One native spool at a time; shared coordinator chooses/hedges other engines.
            break;
          } catch (error) {
            if (candidate) {
              await this.transport.release(candidate.token);
              prepared.splice(prepared.indexOf(candidate), 1);
            }
            checkAbort(requestSignal); failure = error;
          }
        }
        if (!sources.length && failure) throw failure;
        for (const source of sources) this.tokens.set(source.nativeToken, source);
        return sources;
      });
    } catch (error) {
      await Promise.allSettled(prepared.map(result => this.close(result.token)));
      throw error;
    } finally {
      await Promise.allSettled(prepared.filter(result => !this.tokens.has(result.token)).map(result => this.transport.release(result.token)));
    }
  }

  async close(token: string): Promise<void> { this.tokens.delete(token); await this.transport.release(token); }
  async transferStatus(token: string): Promise<BdixTransferStatus> {
    if (!this.tokens.has(token) || !this.transport.transferStatus) throw new BdixError('unsupported', 'unknown-transfer');
    return this.transport.transferStatus(token);
  }
  async copySnapshot(token: string, signal?: AbortSignal): Promise<BdixSnapshot> {
    checkAbort(signal);
    if (!this.tokens.has(token) || !this.transport.copySnapshot) throw new BdixError('unsupported', 'snapshot-unsupported');
    return this.transport.copySnapshot(token, signal);
  }
  async dispose(): Promise<void> { this.disposed = true; this.endpoints = []; this.stopListening(); await this.invalidate(); }
}
