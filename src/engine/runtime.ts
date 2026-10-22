import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as nativeFetch } from "expo/fetch";
import * as ExpoNetwork from "expo-network";
import * as SecureStore from "expo-secure-store";
import { syncCatalogTitles } from "../data/mock";
import { syncChannels } from "../data/channels";
import { syncAdultChannels } from "../data/adultChannels";
import bundledSources from "./config/sources.json";
import { SourceRegistry } from "./sources";
import { Network, type TransportResponse } from "./network";
import { ParserRegistry } from "./parsers";
import { PlayableVerifier } from "./verifier";
import { CatalogRepository } from "./catalog";
import { SourceResolver } from "./resolver";
import { DiscoveryScheduler } from "./scheduler";
import { Diagnostics } from "./diagnostics";
import { EngineError } from "./model";
import { errorCode } from "./security";
import { feedTitles, toChannel, toTitle } from "./ui";
export const diagnostics = new Diagnostics();
export const sourceRegistry = new SourceRegistry(AsyncStorage, bundledSources);
export async function credentialHeaders(
  ref: string,
): Promise<Record<string, string>> {
  const raw = await SecureStore.getItemAsync(ref);
  if (!raw) throw new EngineError("authentication");
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw new Error();
    const headers: Record<string, string> = {};
    for (const [key, v] of Object.entries(value)) {
      if (
        !["authorization", "x-api-key"].includes(key.toLowerCase()) ||
        typeof v !== "string" ||
        v.length > 4096 ||
        /[\r\n]/.test(v)
      )
        throw new Error();
      headers[key] = v;
    }
    return headers;
  } catch {
    throw new EngineError("authentication");
  }
}
export const network = new Network(
  async (url, init): Promise<TransportResponse> => {
    const r = await nativeFetch(url, init);
    return {
      status: r.status,
      headers: r.headers,
      body: r.body
        ? {
            getReader: () => {
              const reader = r.body!.getReader();
              return {
                read: async () => {
                  const p = await reader.read();
                  return { done: !!p.done, value: p.value };
                },
                cancel: () => reader.cancel(),
              };
            },
          }
        : null,
    };
  },
  async () => {
    const state = await ExpoNetwork.getNetworkStateAsync();
    return state.isConnected !== false;
  },
  credentialHeaders,
);
export const catalog = new CatalogRepository(AsyncStorage, sourceRegistry);
export const resolver = new SourceResolver(catalog, sourceRegistry);
export const scheduler = new DiscoveryScheduler(
  AsyncStorage,
  sourceRegistry,
  network,
  new ParserRegistry(),
  new PlayableVerifier(network),
  catalog,
  diagnostics,
);
let initialization: Promise<void> | null = null;
let initialized = false;
function publish(): void {
  syncCatalogTitles(
    [
      ...feedTitles(catalog, "home"),
      ...feedTitles(catalog, "anime"),
      ...feedTitles(catalog, "kdrama"),
    ],
    catalog
      .query("adult", scheduler.adultAccess)
      .filter((r) => r.kind !== "channel")
      .map(toTitle),
  );
  syncChannels(
    catalog
      .query("live")
      .filter((r) => r.kind === "channel")
      .map(toChannel),
  );
  syncAdultChannels(
    catalog
      .query("adult", scheduler.adultAccess)
      .filter((r) => r.kind === "channel")
      .map((r) => ({ ...toChannel(r), isAdult: true })),
  );
}
catalog.subscribe(publish);
export function initializeEngine(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (initialization) return initialization;
  diagnostics.update({ state: "initializing" });
  initialization = (async () => {
    await sourceRegistry.load();
    await catalog.load();
    await scheduler.load();
    publish();
    initialized = true;
    diagnostics.update({
      state: "idle",
      configured: sourceRegistry.all().length,
      invalidConfiguration: sourceRegistry.invalidCount,
    });
  })()
    .catch((e) => {
      diagnostics.update({ state: "failed", lastError: errorCode(e) });
      throw e;
    })
    .finally(() => {
      initialization = null;
    });
  return initialization;
}
export function closeAdultSession(): void {
  if (scheduler.adultAccess) {
    scheduler.adultAccess = false;
    publish();
  }
}
export function allowAdultSession(): void {
  scheduler.adultAccess = true;
  publish();
  void initializeEngine()
    .then(() => scheduler.run("foreground"))
    .catch(() => undefined);
}
export async function playbackSource(
  url: string,
  sourceId?: string,
): Promise<{ uri: string; headers?: Record<string, string> }> {
  const source = sourceId ? sourceRegistry.get(sourceId) : undefined;
  return {
    uri: url,
    headers:
      source?.authRef && new URL(url).origin === new URL(source.endpoint).origin
        ? await credentialHeaders(source.authRef)
        : undefined,
  };
}
