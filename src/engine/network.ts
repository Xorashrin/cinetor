import { EngineError, type Source } from "./model";
import { authorizedUrl } from "./security";
export interface TransportResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<unknown>;
    };
  } | null;
}
export type Transport = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: "manual";
    credentials: "omit";
  },
) => Promise<TransportResponse>;
export interface NetworkResult {
  status: number;
  headers: TransportResponse["headers"];
  bytes: Uint8Array;
  url: string;
}
export const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new EngineError("cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new EngineError("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
export class Network {
  private next = new Map<string, number>();
  constructor(
    private transport: Transport,
    private connected: () => Promise<boolean>,
    private credentials: (ref: string) => Promise<Record<string, string>>,
    private random = Math.random,
    private sleep = pause,
    private now = Date.now,
  ) {}
  async request(
    source: Source,
    input: string,
    signal: AbortSignal,
    options: {
      limit?: number;
      prefix?: boolean;
      headers?: Record<string, string>;
      expectedTypes?: string[];
    } = {},
  ): Promise<NetworkResult> {
    if (!(await this.connected())) throw new EngineError("offline");
    let last: unknown;
    for (let attempt = 0; attempt <= source.retries; attempt++) {
      if (signal.aborted) throw new EngineError("cancelled");
      try {
        await this.sleep(
          Math.max(0, (this.next.get(source.id) ?? 0) - this.now()),
          signal,
        );
        this.next.set(source.id, this.now() + source.minRequestIntervalMs);
        return await this.attempt(source, input, signal, options);
      } catch (e) {
        last = e;
        if (
          !(e instanceof EngineError) ||
          !["network", "timeout", "http"].includes(e.code) ||
          attempt === source.retries
        )
          throw e;
        await this.sleep(
          Math.min(8000, 400 * 2 ** attempt) * (0.75 + this.random() * 0.5),
          signal,
        );
      }
    }
    throw last;
  }
  private async attempt(
    source: Source,
    input: string,
    outer: AbortSignal,
    options: {
      limit?: number;
      prefix?: boolean;
      headers?: Record<string, string>;
      expectedTypes?: string[];
    },
  ): Promise<NetworkResult> {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    outer.addEventListener("abort", abort, { once: true });
    if (outer.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, source.timeoutMs);
    const cancelled = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => reject(new EngineError(timedOut ? "timeout" : "cancelled")),
        { once: true },
      );
    });
    cancelled.catch(() => undefined);
    const bounded = <T>(work: Promise<T>): Promise<T> =>
      Promise.race([work, cancelled]);
    let reader:
      | ReturnType<NonNullable<TransportResponse["body"]>["getReader"]>
      | undefined;
    try {
      let url = authorizedUrl(input, source);
      const auth =
        source.authRef &&
        new URL(url).origin === new URL(source.endpoint).origin
          ? await bounded(this.credentials(source.authRef))
          : {};
      if (controller.signal.aborted)
        throw new EngineError(timedOut ? "timeout" : "cancelled");
      for (let redirects = 0; redirects <= 3; redirects++) {
        const headers = {
          ...auth,
          ...options.headers,
          "Accept-Encoding": "identity",
        };
        const response = await bounded(
          this.transport(url, {
            method: "GET",
            headers,
            signal: controller.signal,
            redirect: "manual",
            credentials: "omit",
          }),
        );
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          response.body
            ?.getReader()
            .cancel()
            .catch(() => undefined);
          const location = response.headers.get("location");
          if (!location || redirects === 3) throw new EngineError("scope");
          const next = authorizedUrl(location, source, url);
          // Never forward credentials across origins, even to an allowed CDN.
          if (
            (source.authRef && new URL(next).origin !== new URL(url).origin) ||
            (new URL(url).protocol === "https:" &&
              new URL(next).protocol === "http:")
          )
            throw new EngineError("scope");
          url = next;
          continue;
        }
        if (response.body) reader = response.body.getReader();
        if (response.status === 304)
          return {
            status: 304,
            headers: response.headers,
            bytes: new Uint8Array(),
            url,
          };
        if (response.status === 401) throw new EngineError("authentication");
        if (response.status === 403) throw new EngineError("permission");
        if (response.status === 429) throw new EngineError("rate-limit");
        if (response.status < 200 || response.status >= 300)
          throw new EngineError(
            response.status >= 500 ? "http" : "unsupported",
          );
        const types = options.expectedTypes ?? source.expectedContentTypes;
        const type = (response.headers.get("content-type") ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        if (!types.some((t) => t === type)) throw new EngineError("malformed");
        if (!reader) throw new EngineError("unsupported"); // No unbounded RN arrayBuffer fallback.
        const limit = options.limit ?? source.maxResponseBytes;
        const size = Number(response.headers.get("content-length"));
        if (!options.prefix && size > limit) throw new EngineError("size");
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const part = await bounded(reader.read());
          if (part.done) break;
          if (!part.value) continue;
          if (!options.prefix && total + part.value.length > limit)
            throw new EngineError("size");
          const chunk = part.value.slice(0, limit - total);
          chunks.push(chunk);
          total += chunk.length;
          if (options.prefix && total >= limit) break;
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return {
          status: response.status,
          headers: response.headers,
          bytes,
          url,
        };
      }
      throw new EngineError("scope");
    } catch (e) {
      if (timedOut) throw new EngineError("timeout");
      if (outer.aborted) throw new EngineError("cancelled");
      if (e instanceof EngineError) throw e;
      throw new EngineError("network");
    } finally {
      clearTimeout(timer);
      outer.removeEventListener("abort", abort);
      reader?.cancel().catch(() => undefined);
      controller.abort();
    }
  }
}
