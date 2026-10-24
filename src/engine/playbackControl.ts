import type { PlaybackSourceRef } from '../data/mock';
import { PlaybackSession } from './coordinator';

export function playbackSourceKey(source: PlaybackSourceRef): string {
  return JSON.stringify([source.engine, source.providerId, source.providerHash, source.contentKey, source.sourceId, source.representationId, source.networkContext, source.accessContext, source.url]);
}

export class PlaybackControl {
  readonly budget: PlaybackSession;
  private current?: PlaybackSourceRef;
  private failed = new Set<string>();
  private listeners = new Set<(sources: PlaybackSourceRef[]) => void>();
  private sources: PlaybackSourceRef[] = [];
  private closed = false;
  private firstFrame = false;
  constructor(private release: (sources: PlaybackSourceRef[]) => void, budget?: PlaybackSession, private onStop?: () => void) {
    this.budget = budget ?? new PlaybackSession();
  }
  get signal(): AbortSignal { return this.budget.signal; }
  get stopped(): boolean { return this.closed || this.budget.stopped; }
  get selected(): PlaybackSourceRef | undefined { return this.current; }
  get candidates(): PlaybackSourceRef[] { return this.sources.filter(source => !this.failed.has(playbackSourceKey(source))); }
  subscribe(listener: (sources: PlaybackSourceRef[]) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  update(sources: PlaybackSourceRef[]): void {
    if (this.stopped) { this.release(sources); return; }
    const unique = new Map(this.sources.map(source => [playbackSourceKey(source), source]));
    for (const source of sources) unique.set(playbackSourceKey(source), source);
    const merged = [...unique.values()];
    this.sources = merged.slice(0, 12);
    this.release(merged.slice(12));
    for (const listener of this.listeners) listener(this.candidates);
  }
  select(source: PlaybackSourceRef, automatic = false): { preservePosition: boolean } | undefined {
    if (this.stopped || this.failed.has(playbackSourceKey(source)) || !this.sources.some(row => playbackSourceKey(row) === playbackSourceKey(source))) return undefined;
    if (automatic && !this.budget.canSwitch()) return undefined;
    const previous = this.current;
    this.current = source;
    this.firstFrame = false;
    const preservePosition = !!previous && !!source.timelineId && source.timelineId === previous.timelineId && source.contentKey === previous.contentKey;
    return { preservePosition };
  }
  renderedFrame(source: PlaybackSourceRef): boolean {
    if (this.stopped || !this.current || playbackSourceKey(this.current) !== playbackSourceKey(source) || this.firstFrame) return false;
    this.firstFrame = true;
    this.budget.complete();
    return true;
  }
  fail(source: PlaybackSourceRef): void {
    this.failed.add(playbackSourceKey(source));
    for (const listener of this.listeners) listener(this.candidates);
  }
  refresh(source: PlaybackSourceRef): boolean { return this.budget.canRefresh(`${source.engine}:${source.providerId}:${source.providerHash}:${source.contentKey}:${source.sourceId}`); }
  stop(): void {
    if (this.closed) return;
    this.closed = true;
    this.budget.stop();
    this.release(this.sources);
    this.sources = [];
    this.listeners.clear();
    this.onStop?.();
  }
}
