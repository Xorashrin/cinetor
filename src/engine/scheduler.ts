import { z } from "zod";
import {
  CandidateSchema,
  EngineError,
  type Candidate,
  type Source,
  type SourceState,
  type Storage,
} from "./model";
import { errorCode, authorizedUrl } from "./security";
import type { SourceRegistry } from "./sources";
import type { Network } from "./network";
import type { ParserRegistry } from "./parsers";
import { extractMetadata } from "./metadata";
import { classify } from "./classifier";
import type { PlayableVerifier } from "./verifier";
import type { CatalogRepository } from "./catalog";
import type { Diagnostics } from "./diagnostics";
import { pause } from "./network";
export const SCAN_KEY = "cinetor:engine:schedule:v1";
const StateSchema = z.object({
  status: z.enum(["idle", "running", "completed", "failed"]),
  lastSuccess: z.number().optional(),
  lastError: z
    .enum([
      "configuration",
      "offline",
      "timeout",
      "cancelled",
      "network",
      "authentication",
      "permission",
      "http",
      "rate-limit",
      "size",
      "malformed",
      "unsupported",
      "scope",
      "storage",
    ])
    .optional(),
  nextEligible: z.number(),
  failures: z.number(),
  etag: z.string().optional(),
  modified: z.string().optional(),
  queue: z
    .array(z.object({ url: z.string(), depth: z.number() }))
    .max(40)
    .optional(),
  pages: z.number().optional(),
  pending: z.array(CandidateSchema).max(500).optional(),
});
type Checkpoint = SourceState & { pending?: Candidate[] };
const ScheduleSchema = z.object({
  schemaVersion: z.literal(1),
  leaseUntil: z.number(),
  sources: z.record(z.string(), StateSchema),
});
export class DiscoveryScheduler {
  private states: Record<string, Checkpoint> = {};
  private active: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private leaseUntil = 0;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  adultAccess = false;
  constructor(
    private storage: Storage,
    private registry: SourceRegistry,
    private network: Network,
    private parsers: ParserRegistry,
    private verifier: PlayableVerifier,
    private catalog: CatalogRepository,
    private diagnostics: Diagnostics,
    private now = Date.now,
    private yieldWork = (signal: AbortSignal) => pause(0, signal),
  ) {}
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const raw = await this.storage.getItem(SCAN_KEY);
      if (raw) {
        try {
          const s = ScheduleSchema.parse(JSON.parse(raw));
          this.states = s.sources;
          this.leaseUntil = s.leaseUntil;
        } catch {
          this.diagnostics.update({ lastError: "storage" });
        }
      }
      this.loaded = true;
      this.diagnostics.update({ sources: this.states });
    })().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }
  private save(): Promise<void> {
    return this.storage.setItem(
      SCAN_KEY,
      JSON.stringify({
        schemaVersion: 1,
        leaseUntil: this.leaseUntil,
        sources: this.states,
      }),
    );
  }
  cancel(): void {
    this.controller?.abort();
  }
  nextEligible(): number {
    return Math.min(
      ...this.registry
        .all()
        .filter((s) => s.enabled && (!s.restricted || this.adultAccess))
        .map((s) => this.states[s.id]?.nextEligible ?? 0),
      this.now() + 15 * 60 * 1000,
    );
  }
  run(mode: "foreground" | "background"): Promise<void> {
    if (this.active) return this.active;
    this.active = this.execute(mode).finally(() => {
      this.active = null;
      this.controller = null;
    });
    return this.active;
  }
  private async execute(mode: "foreground" | "background"): Promise<void> {
    await this.load();
    const now = this.now();
    if (this.leaseUntil > now) return;
    const eligible = this.registry
      .all()
      .filter(
        (s) =>
          s.enabled &&
          (!s.restricted || (mode === "foreground" && this.adultAccess)) &&
          (this.states[s.id]?.nextEligible ?? 0) <= now,
      );
    if (!eligible.length) {
      this.diagnostics.update({
        state: "idle",
        configured: this.registry.all().length,
      });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const budget = mode === "background" ? 20000 : 90000;
    const timer = setTimeout(() => controller.abort(), budget);
    this.leaseUntil = now + budget + 15000;
    this.diagnostics.update({
      state: "running",
      mode,
      startedAt: now,
      completedAt: undefined,
      configured: this.registry.all().length,
      attempted: 0,
      successful: 0,
      failed: 0,
      discovered: 0,
      parsed: 0,
      classified: 0,
      metadataIncomplete: 0,
      rejected: 0,
      verified: 0,
      published: 0,
      unverified: 0,
      unreachable: 0,
      lastError: undefined,
    });
    try {
      await this.save();
      let index = 0;
      const worker = async () => {
        while (index < eligible.length && !controller.signal.aborted) {
          const source = eligible[index++];
          await this.scan(source, controller.signal, mode);
        }
      };
      // At most two independent source workers, each with one in-flight request.
      await Promise.all([worker(), worker()]);
      this.diagnostics.update({
        state:
          this.diagnostics.value.failed > 0 &&
          this.diagnostics.value.successful === 0
            ? "failed"
            : "completed",
        completedAt: this.now(),
        sources: this.states,
      });
    } catch (e) {
      this.diagnostics.update({
        state: "failed",
        lastError: errorCode(e),
        completedAt: this.now(),
      });
    } finally {
      clearTimeout(timer);
      this.leaseUntil = 0;
      try {
        await this.save();
      } catch {
        this.diagnostics.update({ state: "failed", lastError: "storage" });
      }
    }
  }
  private increment(
    key:
      | "attempted"
      | "successful"
      | "failed"
      | "discovered"
      | "parsed"
      | "classified"
      | "metadataIncomplete"
      | "rejected"
      | "verified"
      | "published"
      | "unverified"
      | "unreachable",
    amount = 1,
  ): void {
    this.diagnostics.update({ [key]: this.diagnostics.value[key] + amount });
  }
  private async scan(
    source: Source,
    signal: AbortSignal,
    mode: "foreground" | "background",
  ): Promise<void> {
    const previous = this.states[source.id];
    const state: Checkpoint = previous ?? {
      status: "idle",
      nextEligible: 0,
      failures: 0,
    };
    this.states[source.id] = state;
    state.status = "running";
    this.increment("attempted");
    if (!state.queue) {
      state.queue = [{ url: source.endpoint, depth: 0 }];
      state.pages = 0;
    }
    try {
      let processed = 0;
      const max = mode === "background" ? 8 : 80;
      while (state.queue.length && !signal.aborted && processed < max) {
        const job = state.queue[0];
        authorizedUrl(job.url, source);
        if (job.depth > source.maxDepth || (state.pages ?? 0) > source.maxPages)
          throw new EngineError("size");
        if (!state.pending) {
          let body = "";
          let base = job.url;
          let etag: string | undefined;
          let modified: string | undefined;
          if (source.adapter !== "direct") {
            const headers: Record<string, string> = {};
            if (job.depth === 0 && source.adapter !== "html-directory") {
              if (state.etag) headers["If-None-Match"] = state.etag;
              if (state.modified) headers["If-Modified-Since"] = state.modified;
            }
            const response = await this.network.request(
              source,
              job.url,
              signal,
              { headers },
            );
            if (response.status === 304) {
              state.queue.shift();
              continue;
            }
            body = new TextDecoder("utf-8", { fatal: true }).decode(
              response.bytes,
            );
            base = response.url;
            if (job.depth === 0 && source.adapter !== "html-directory") {
              etag = response.headers.get("etag") ?? undefined;
              modified = response.headers.get("last-modified") ?? undefined;
            }
          }
          const page = this.parsers.parse(source.adapter, body, source, base);
          if (job.depth === 0 && source.adapter !== "html-directory") {
            state.etag = etag;
            state.modified = modified;
          }
          state.pending = page.candidates;
          state.pages = (state.pages ?? 0) + 1;
          this.increment("discovered", page.candidates.length + page.rejected);
          this.increment("parsed", page.candidates.length);
          this.increment("rejected", page.rejected);
          if (job.depth < source.maxDepth)
            for (const url of page.directories)
              if (
                (state.pages ?? 0) + state.queue.length < source.maxPages &&
                !state.queue.some((p) => p.url === url)
              )
                state.queue.push({ url, depth: job.depth + 1 });
          await this.save();
        }
        while (state.pending.length && !signal.aborted && processed < max) {
          const raw = state.pending[0];
          authorizedUrl(raw.url, source);
          const candidate = extractMetadata(raw, source);
          const classification = classify(candidate, source);
          processed++;
          if (!classification) this.increment("rejected");
          else {
            this.increment("classified");
            if (classification.metadata === "incomplete")
              this.increment("metadataIncomplete");
            try {
              const playback = await this.verifier.verify(
                candidate,
                source,
                signal,
              );
              this.increment("verified");
              await this.catalog.upsert(
                candidate,
                source,
                playback,
                classification,
                raw.title,
              );
              this.increment("published");
            } catch (e) {
              if (
                errorCode(e) === "cancelled" ||
                errorCode(e) === "offline" ||
                errorCode(e) === "storage"
              )
                throw e;
              this.increment("unverified");
              this.increment("rejected");
              if (
                [
                  "network",
                  "timeout",
                  "http",
                  "authentication",
                  "permission",
                  "rate-limit",
                ].includes(errorCode(e))
              ) {
                this.increment("unreachable");
                throw e;
              }
            }
          }
          state.pending.shift();
          await this.save();
          await this.yieldWork(signal);
        }
        if (!state.pending.length) {
          state.pending = undefined;
          state.queue.shift();
          await this.save();
        }
      }
      if (signal.aborted) throw new EngineError("cancelled");
      if (!state.queue.length) {
        state.queue = undefined;
        state.pages = 0;
        state.status = "completed";
        state.lastSuccess = this.now();
        state.lastError = undefined;
        state.failures = 0;
        state.nextEligible = this.now() + source.refreshMs;
        this.increment("successful");
      } else {
        state.status = "idle";
        state.nextEligible = this.now() + 60000;
      }
      await this.save();
    } catch (e) {
      const code = errorCode(e);
      state.lastError = code;
      state.status = code === "cancelled" ? "idle" : "failed";
      if (code !== "cancelled" && code !== "offline") state.failures++;
      state.nextEligible =
        this.now() +
        (code === "cancelled" || code === "offline"
          ? 60000
          : Math.min(
              24 * 60 * 60 * 1000,
              Math.max(
                code === "authentication" || code === "permission"
                  ? source.refreshMs
                  : 60000,
                60000 * 2 ** Math.min(state.failures, 10),
              ),
            ));
      this.increment("failed");
      this.diagnostics.update({ lastError: code, sources: this.states });
      await this.save();
    }
  }
}
