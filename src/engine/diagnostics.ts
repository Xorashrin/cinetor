import type { ErrorCode, SourceState } from "./model";
export interface Metrics {
  state: "idle" | "initializing" | "running" | "completed" | "failed";
  mode: "foreground" | "background" | null;
  startedAt?: number;
  completedAt?: number;
  configured: number;
  attempted: number;
  successful: number;
  failed: number;
  discovered: number;
  parsed: number;
  classified: number;
  metadataIncomplete: number;
  rejected: number;
  verified: number;
  published: number;
  unverified: number;
  unreachable: number;
  lastError?: ErrorCode;
  sources: Record<string, SourceState>;
  background: "unregistered" | "registered" | "unavailable" | "failed";
  invalidConfiguration: number;
}
export class Diagnostics {
  value: Metrics = {
    state: "idle",
    mode: null,
    configured: 0,
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
    sources: {},
    background: "unregistered",
    invalidConfiguration: 0,
  };
  private listeners = new Set<() => void>();
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  update(patch: Partial<Metrics>): void {
    this.value = { ...this.value, ...patch };
    for (const fn of this.listeners) fn();
  }
  snapshot(): Metrics {
    // Scheduling checkpoints contain URLs internally. Export only safe timing/outcome fields.
    const sources: Record<string, SourceState> = {};
    for (const [id, s] of Object.entries(this.value.sources))
      sources[id] = {
        status: s.status,
        lastSuccess: s.lastSuccess,
        lastError: s.lastError,
        nextEligible: s.nextEligible,
        failures: s.failures,
      };
    return { ...this.value, sources };
  }
}
