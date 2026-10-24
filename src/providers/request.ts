import { EngineError } from '../engine/model';

export type ProviderFetch = typeof fetch;

/** Only provider-returned public HTTPS URLs may enter the native media pipeline. */
export function publicUrl(value: string, base?: string): string {
  let url: URL;
  try { url = new URL(value, base); } catch { throw new EngineError('malformed'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password ||
      !host.includes('.') || host.includes(':') ||
      /\.(local|internal|localhost)$/.test(host) ||
      /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host) ||
      /^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|192\.0\.0|192\.0\.2|198\.(18|19|51\.100)|203\.0\.113)\./.test(host) ||
      /^(22[4-9]|23\d|24\d|25[0-5])\./.test(host))
    throw new EngineError('scope');
  url.hash = '';
  return url.toString();
}

export class ProviderHttp {
  constructor(private fetcher: ProviderFetch = fetch) {}

  async request(input: string, options: {
    signal?: AbortSignal;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    maxBytes?: number;
    prefix?: boolean;
    types?: string[];
    timeoutMs?: number;
    headerOrigin?: string;
  } = {}): Promise<{ text: string; bytes: Uint8Array; type: string; status: number; url: string; headers: Record<string, string> }> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, Math.max(1, Math.min(10000, options.timeoutMs ?? 10000)));
    const stopped = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(new EngineError('cancelled'));
      else controller.signal.addEventListener('abort', () => reject(new EngineError(timedOut ? 'timeout' : 'cancelled')), { once: true });
    });
    stopped.catch(() => undefined);
    const bounded = <T>(promise: Promise<T>) => Promise.race([promise, stopped]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const original = publicUrl(input);
      const headerOrigin = options.headerOrigin ? new URL(publicUrl(options.headerOrigin)).origin : new URL(original).origin;
      const headers = Object.fromEntries(Object.entries(options.headers ?? {}).filter(([key, value]) => {
        if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(key) || typeof value !== 'string' || /[\r\n\0]/.test(value) || /^(host|connection|proxy-authorization|content-length|transfer-encoding)$/i.test(key)) throw new EngineError('scope');
        return new URL(original).origin === headerOrigin || /^(user-agent|accept|range|if-range)$/i.test(key);
      }));
      let url = original;
      let method = options.method ?? 'GET';
      for (let redirects = 0; redirects < 4; redirects++) {
        const outgoing = new URL(url).origin === headerOrigin ? headers : Object.fromEntries(Object.entries(headers).filter(([key]) => /^(user-agent|accept|range|if-range)$/i.test(key)));
        const response = await bounded(this.fetcher(url, {
          method, headers: outgoing,
          signal: controller.signal, redirect: 'manual', credentials: 'omit',
          ...(method === 'POST' ? { body: '' } : {}),
        }));
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          void response.body?.cancel().catch(() => undefined);
          const location = response.headers.get('location');
          if (!location || redirects === 3) throw new EngineError('scope');
          const next = publicUrl(location, url);
          if (Object.keys(headers).some(key => /^(?:x-csrf-token|authorization|cookie|x-api-key)$/i.test(key)) && new URL(next).origin !== headerOrigin)
            throw new EngineError('scope');
          if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) method = 'GET';
          url = next;
          continue;
        }
        reader = response.body?.getReader();
        if (response.status < 200 || response.status >= 300)
          throw new EngineError(response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : response.status === 429 ? 'rate-limit' : 'http');
        const range = Object.entries(headers).find(([key]) => key.toLowerCase() === 'range')?.[1];
        const contentRange = response.headers.get('content-range');
        if (response.status === 206 && range) {
          const requested = /^bytes=(\d+)-(\d*)$/.exec(range);
          const actual = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange ?? '');
          if (!requested || !actual || requested[1] !== actual[1] || Number(actual[2]) < Number(actual[1]) || (requested[2] && Number(actual[2]) > Number(requested[2]))) throw new EngineError('malformed');
        }
        const responseHeaders = Object.fromEntries(['content-length', 'content-range', 'etag', 'last-modified', 'accept-ranges'].flatMap(name => {
          const value = response.headers.get(name);
          return value ? [[name, value]] : [];
        }));
        const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        if (options.types && !options.types.includes(type)) throw new EngineError('malformed');
        if (!reader) throw new EngineError('unsupported');
        const max = options.maxBytes ?? 1048576;
        if (!options.prefix && Number(response.headers.get('content-length')) > max) throw new EngineError('size');
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const chunk = await bounded(reader.read());
          if (chunk.done) break;
          if (!options.prefix && total + chunk.value.byteLength > max) throw new EngineError('size');
          const value = chunk.value.slice(0, max - total);
          chunks.push(value); total += value.byteLength;
          if (options.prefix && total >= max) break;
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return { bytes, text: new TextDecoder().decode(bytes), type, status: response.status, url, headers: responseHeaders };
      }
      throw new EngineError('scope');
    } catch (error) {
      if (timedOut) throw new EngineError('timeout');
      if (options.signal?.aborted) throw new EngineError('cancelled');
      if (error instanceof EngineError) throw error;
      throw new EngineError('network');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      void reader?.cancel().catch(() => undefined);
    }
  }

  async json(url: string, options: Parameters<ProviderHttp['request']>[1] = {}): Promise<unknown> {
    const result = await this.request(url, options);
    try { return JSON.parse(result.text); } catch { throw new EngineError('malformed'); }
  }
}
