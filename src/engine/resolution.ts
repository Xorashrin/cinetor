import type { PlaybackSourceRef } from '../data/mock';
import { EngineError } from './model';
import { resolverPool, probePool } from './coordinator';
import { playbackSourceKey } from './playbackControl';

export interface CandidateAdapter {
  id: string;
  local: boolean;
  resolve(signal: AbortSignal): Promise<PlaybackSourceRef[]>;
}
export interface ResolutionOptions {
  signal: AbortSignal;
  local?: CandidateAdapter;
  remote: CandidateAdapter[];
  probe: (source: PlaybackSourceRef, signal: AbortSignal) => Promise<PlaybackSourceRef>;
  onSources?: (sources: PlaybackSourceRef[]) => void;
  discard?: (sources: PlaybackSourceRef[]) => void;
  hedgeMs?: number;
  holdMs?: number;
}
export interface ResolutionRun {
  ready: Promise<PlaybackSourceRef[]>;
  finished: Promise<void>;
  candidates: () => PlaybackSourceRef[];
}

/** Progressive, fair shortlists; known-local priority never triggers network discovery. */
export function coordinateResolution(options: ResolutionOptions): ResolutionRun {
  if (options.remote.length > 2) throw new EngineError('configuration');
  const refs = new Map<string, PlaybackSourceRef>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let outstanding = options.remote.length + (options.local ? 1 : 0);
  let selected = false;
  let localDone = !options.local;
  let holdExpired = !options.local;
  let remoteStarted = false;
  let lastError: unknown = new EngineError('unsupported');
  let resolveReady: (sources: PlaybackSourceRef[]) => void = () => undefined;
  let rejectReady: (error: unknown) => void = () => undefined;
  let resolveFinished: () => void = () => undefined;
  const ordered = () => [...refs.values()].sort((a, b) => Number(b.locality === 'approved-network') - Number(a.locality === 'approved-network')).slice(0, 12);
  const ready = new Promise<PlaybackSourceRef[]>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
  const cleanup = () => { for (const timer of timers) clearTimeout(timer); timers.clear(); options.signal.removeEventListener('abort', abort); };
  const choose = () => {
    if (selected || options.signal.aborted) return;
    const rows = ordered();
    if (rows.length && (rows.some(row => row.locality === 'approved-network') || holdExpired || localDone)) {
      selected = true; resolveReady(rows);
    } else if (outstanding === 0) {
      selected = true; rejectReady(lastError);
    }
    if (outstanding === 0) { cleanup(); resolveFinished(); }
  };
  const abort = () => {
    if (!remoteStarted) { outstanding -= options.remote.length; remoteStarted = true; }
    if (!selected) { selected = true; rejectReady(new EngineError('cancelled')); }
    cleanup();
    // In-flight adapters remain responsible for their native cancellation and cleanup.
    if (outstanding === 0) resolveFinished();
  };
  options.signal.addEventListener('abort', abort, { once: true });
  const publish = (source: PlaybackSourceRef) => {
    if (options.signal.aborted) return;
    refs.set(playbackSourceKey(source), source);
    options.onSources?.(ordered());
    choose();
  };
  const start = (adapter: CandidateAdapter) => {
    void resolverPool.run(() => adapter.resolve(options.signal), options.signal).then(async sources => {
      options.discard?.(sources.slice(3));
      for (let index = 0; index < Math.min(sources.length, 3); index++) {
        const source = sources[index];
        if (options.signal.aborted) { options.discard?.(sources.slice(index, 3)); break; }
        try {
          const checked = await probePool.run(() => options.probe(source, options.signal), options.signal);
          if (options.signal.aborted) options.discard?.([checked]);
          else publish(checked);
        } catch (error) { lastError = error; options.discard?.([source]); }
      }
    }).catch(error => { lastError = error; }).finally(() => {
      if (adapter.local) localDone = true;
      outstanding--;
      choose();
      if (outstanding === 0) { cleanup(); resolveFinished(); }
    });
  };
  const later = (work: () => void, ms: number) => {
    const timer = setTimeout(() => { timers.delete(timer); work(); }, ms);
    timers.add(timer);
  };
  const startRemote = () => {
    if (remoteStarted || options.signal.aborted) return;
    remoteStarted = true;
    for (const adapter of options.remote) start(adapter);
  };
  if (options.signal.aborted) {
    remoteStarted = true; outstanding = 0; abort(); resolveFinished();
  } else if (!outstanding) { choose(); resolveFinished(); }
  else if (options.local) {
    start(options.local);
    // Only a two-provider remote shortlist is admitted by the caller.
    later(startRemote, options.hedgeMs ?? 750);
    later(() => { holdExpired = true; choose(); }, options.holdMs ?? 1500);
  } else { startRemote(); }
  return { ready, finished, candidates: ordered };
}
