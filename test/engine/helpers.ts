import { SourceRegistry } from "../../src/engine/sources";
import {
  SourceSchema,
  CandidateSchema,
  type Storage,
  type Source,
} from "../../src/engine/model";
import {
  Network,
  type Transport,
  type TransportResponse,
} from "../../src/engine/network";
import { CatalogRepository } from "../../src/engine/catalog";
import { ParserRegistry } from "../../src/engine/parsers";
import { PlayableVerifier } from "../../src/engine/verifier";
import { Diagnostics } from "../../src/engine/diagnostics";
import { DiscoveryScheduler } from "../../src/engine/scheduler";
export class MemoryStorage implements Storage {
  map = new Map<string, string>();
  fail = false;
  async getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    if (this.fail) throw new Error("disk");
    this.map.set(key, value);
  }
}
export const source = (patch: Partial<Source> = {}): Source =>
  SourceSchema.parse({
    id: "authorized",
    enabled: true,
    authorized: true,
    protocol: "https",
    endpoint: "https://media.example/catalog.json",
    adapter: "json",
    scopes: [{ origin: "https://media.example", pathPrefix: "/" }],
    expectedContentTypes: ["application/json"],
    ...patch,
  });
export const candidate = (patch: Record<string, unknown> = {}) =>
  CandidateSchema.parse({
    title: "A Film",
    url: "https://media.example/film.mp4",
    kind: "movie",
    category: "home",
    year: 2025,
    language: "en",
    edition: "theatrical",
    ...patch,
  });
export const mp4 = () => {
  const b = new Uint8Array(32);
  b[3] = 24;
  b.set(new TextEncoder().encode("ftypisom"), 4);
  return b;
};
export const ts = () => {
  const b = new Uint8Array(564);
  b[0] = b[188] = b[376] = 0x47;
  return b;
};
export function response(
  body: string | Uint8Array,
  status = 200,
  type = "application/json",
  headers: Record<string, string> = {},
): TransportResponse {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  let done = false;
  return {
    status,
    headers: {
      get: (name: string) =>
        ({ "content-type": type, ...headers })[name.toLowerCase()] ?? null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          if (done) return { done: true };
          done = true;
          return { done: false, value: bytes };
        },
        cancel: async () => {
          done = true;
        },
      }),
    },
  };
}
export function network(
  transport: Transport,
  connected = async () => true,
  options: {
    random?: () => number;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    credentials?: (ref: string) => Promise<Record<string, string>>;
  } = {},
) {
  return new Network(
    transport,
    connected,
    options.credentials ?? (async () => ({})),
    options.random ?? (() => 0.5),
    options.sleep ?? (async () => undefined),
  );
}
export async function engine(
  transport: Transport,
  sources: Source[] = [source()],
  store = new MemoryStorage(),
  now = Date.now,
) {
  const registry = new SourceRegistry(store);
  await registry.configure(sources);
  const net = network(transport),
    catalog = new CatalogRepository(store, registry, now),
    diagnostics = new Diagnostics();
  const scheduler = new DiscoveryScheduler(
    store,
    registry,
    net,
    new ParserRegistry(),
    new PlayableVerifier(net, now),
    catalog,
    diagnostics,
    now,
    async () => undefined,
  );
  return { store, registry, net, catalog, diagnostics, scheduler };
}
