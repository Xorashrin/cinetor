import { EngineError } from '../engine/model';

export const TMDB_API_BASE = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
export const CINEHD_METADATA_PROXY = 'https://autoembed.app/aproxy/proxy.php?url=';

export type TmdbCredential = string | null | undefined | {
  apiKey?: string;
  accessToken?: string;
};
export type CredentialGetter = () => Promise<TmdbCredential>;
export interface TmdbResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: {
    getReader(): {
      read(): Promise<{ done?: boolean; value?: Uint8Array }>;
      cancel(): Promise<unknown>;
    };
  } | null;
}
export type FetchLike = (
  url: string,
  init: {
    method: 'GET';
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: 'error';
    credentials: 'omit';
  },
) => Promise<TmdbResponse>;
export interface TmdbClientOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  concurrency?: number;
  now?: () => number;
}
interface Pending {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: number;
  settled: boolean;
}
interface CacheEntry { value: unknown; expiresAt: number }

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
export function object(input: unknown): Record<string, unknown> | undefined {
  return isObject(input) ? input : undefined;
}

function cloneJson(input: unknown): unknown {
  return JSON.parse(JSON.stringify(input));
}

export class TmdbClient {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Pending>();
  private active = 0;
  private waiters = new Set<() => void>();
  private readonly options: Required<TmdbClientOptions>;

  constructor(
    private readonly credentials: CredentialGetter,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
    options: TmdbClientOptions = {},
  ) {
    this.options = {
      timeoutMs: Math.max(100, Math.min(options.timeoutMs ?? 10000, 30000)),
      maxResponseBytes: Math.max(1024, Math.min(options.maxResponseBytes ?? 1048576, 2097152)),
      cacheTtlMs: Math.max(0, options.cacheTtlMs ?? 300000),
      maxCacheEntries: Math.max(1, Math.min(options.maxCacheEntries ?? 150, 500)),
      concurrency: Math.max(1, Math.min(options.concurrency ?? 2, 4)),
      now: options.now ?? Date.now,
    };
  }

  clearCache(): void { this.cache.clear(); }

  async request(
    path: string,
    params: Record<string, string | number | boolean> = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (signal?.aborted) throw new EngineError('cancelled');
    if (!/^\/(?:trending\/(?:movie|tv)\/week|discover\/(?:movie|tv)|search\/multi|movie\/\d+|tv\/\d+(?:\/season\/\d+)?)$/.test(path))
      throw new EngineError('configuration');
    const query = new URLSearchParams({ language: 'en-US' });
    for (const key of Object.keys(params).sort()) {
      if (key === 'api_key' || key === 'access_token') throw new EngineError('configuration');
      query.set(key, String(params[key]));
    }
    const key = path + '?' + query.toString();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.options.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cloneJson(cached.value);
    }
    this.cache.delete(key);
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { controller: new AbortController(), consumers: 0, settled: false, promise: Promise.resolve() };
      const started = entry;
      entry.promise = this.perform(path, query, entry.controller.signal)
        .then(value => {
          if (!started.controller.signal.aborted) {
            this.cache.set(key, { value, expiresAt: this.options.now() + this.options.cacheTtlMs });
            while (this.cache.size > this.options.maxCacheEntries) {
              const oldest = this.cache.keys().next().value;
              if (oldest === undefined) break;
              this.cache.delete(oldest);
            }
          }
          return value;
        })
        .finally(() => {
          started.settled = true;
          if (this.pending.get(key) === started) this.pending.delete(key);
        });
      entry.promise.catch(() => undefined);
      this.pending.set(key, entry);
    }
    const pending = entry;
    pending.consumers++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        pending.consumers--;
        if (!pending.settled && pending.consumers === 0) {
          pending.controller.abort();
          if (this.pending.get(key) === pending) this.pending.delete(key);
        }
        return true;
      };
      const onAbort = () => {
        if (finish()) reject(new EngineError('cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      pending.promise.then(
        value => { if (finish()) resolve(cloneJson(value)); },
        error => { if (finish()) reject(error); },
      );
    });
  }

  private async acquire(signal: AbortSignal): Promise<() => void> {
    while (this.active >= this.options.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(new EngineError('cancelled'));
        };
        const cleanup = () => {
          this.waiters.delete(wake);
          signal.removeEventListener('abort', abort);
        };
        this.waiters.add(wake);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    if (signal.aborted) throw new EngineError('cancelled');
    this.active++;
    return () => {
      this.active--;
      this.waiters.values().next().value?.();
    };
  }

  private async perform(path: string, params: URLSearchParams, outer: AbortSignal): Promise<unknown> {
    const release = await this.acquire(outer);
    const controller = new AbortController();
    let timedOut = false;
    let reader: ReturnType<NonNullable<TmdbResponse['body']>['getReader']> | undefined;
    const abort = () => controller.abort();
    outer.addEventListener('abort', abort, { once: true });
    if (outer.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; abort(); }, this.options.timeoutMs);
    const cancelled = new Promise<never>((_resolve, reject) => {
      const fail = () => reject(new EngineError(timedOut ? 'timeout' : 'cancelled'));
      controller.signal.addEventListener('abort', fail, { once: true });
      if (controller.signal.aborted) fail();
    });
    cancelled.catch(() => undefined);
    const bounded = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, cancelled]);
    try {
      const credential = await bounded(this.credentials());
      const headers: Record<string, string> = { Accept: 'application/json' };
      let apiKey: string | undefined;
      let token: string | undefined;
      if (typeof credential === 'string') {
        if (credential.startsWith('eyJ') && credential.split('.').length === 3) token = credential;
        else apiKey = credential;
      } else if (credential) {
        apiKey = credential.apiKey;
        token = credential.accessToken;
      }
      const valid = (value: string | undefined) => !!value && /^[a-zA-Z0-9._-]{8,4096}$/.test(value);
      let useProxy = false;
      if (token && valid(token)) headers.Authorization = 'Bearer ' + token;
      else if (apiKey && valid(apiKey)) params.set('api_key', apiKey);
      else if (!token && !apiKey) useProxy = true;
      else throw new EngineError('configuration');
      const query = params.toString();
      // PHP decodes the outer url parameter once. Preserve the inner query's escapes and separators.
      const target = TMDB_API_BASE + path + '?' + (useProxy
        ? query.replaceAll('%', '%25').replaceAll('+', '%2B').replaceAll('&', '%26')
        : query);
      const url = useProxy ? CINEHD_METADATA_PROXY + target : target;
      const response = await bounded(this.fetcher(url, {
        method: 'GET', headers, signal: controller.signal, redirect: 'error', credentials: 'omit',
      }));
      reader = response.body?.getReader();
      if (response.status === 401 || response.status === 403) throw new EngineError('authentication');
      if (response.status === 429) throw new EngineError('rate-limit');
      if (response.status === 404) throw new EngineError('unsupported');
      if (response.status < 200 || response.status >= 300) throw new EngineError('http');
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') throw new EngineError('malformed');
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength > this.options.maxResponseBytes) throw new EngineError('size');
      if (!reader) throw new EngineError('unsupported');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await bounded(reader.read());
        if (part.done) break;
        if (!part.value) continue;
        size += part.value.byteLength;
        if (size > this.options.maxResponseBytes) throw new EngineError('size');
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new EngineError('malformed'); }
      if (!object(value)) throw new EngineError('malformed');
      return value;
    } catch (error) {
      if (timedOut) throw new EngineError('timeout');
      if (outer.aborted) throw new EngineError('cancelled');
      if (error instanceof EngineError) throw error;
      throw new EngineError('network');
    } finally {
      clearTimeout(timer);
      outer.removeEventListener('abort', abort);
      reader?.cancel().catch(() => undefined);
      controller.abort();
      release();
    }
  }
}
