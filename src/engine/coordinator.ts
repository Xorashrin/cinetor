import { EngineError } from './model';

interface Waiter {
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (error: EngineError) => void;
  abort: () => void;
}

export class WorkPool {
  private active = 0;
  private queue: Waiter[] = [];
  constructor(readonly limit: number, private readonly maxQueue = 32) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(maxQueue) || maxQueue < 1) throw new EngineError('configuration');
  }
  get running(): number { return this.active; }
  get waiting(): number { return this.queue.length; }
  private permit(): () => void {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }
  private drain(): void {
    while (this.active < this.limit && this.queue.length) {
      const next = this.queue.shift()!;
      next.signal?.removeEventListener('abort', next.abort);
      if (next.signal?.aborted) next.reject(new EngineError('cancelled'));
      else next.resolve(this.permit());
    }
  }
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new EngineError('cancelled'));
    if (this.active < this.limit && !this.queue.length) return Promise.resolve(this.permit());
    if (this.queue.length >= this.maxQueue) return Promise.reject(new EngineError('rate-limit'));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { signal, resolve, reject, abort: () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        signal?.removeEventListener('abort', waiter.abort);
        reject(new EngineError('cancelled'));
      } };
      this.queue.push(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      if (signal?.aborted) waiter.abort();
    });
  }
  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      if (signal?.aborted) throw new EngineError('cancelled');
      return await work();
    } finally { release(); }
  }
}

export const resolverPool = new WorkPool(2);
export const probePool = new WorkPool(2);
export const transferPool = new WorkPool(2);

export class PlaybackSession {
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  private switches = 0;
  private refreshed = new Set<string>();
  private succeeded = false;
  readonly deadline: number;
  constructor(private now: () => number = Date.now, budgetMs = 45000) {
    this.deadline = now() + budgetMs;
    this.timer = setTimeout(() => this.controller.abort(), budgetMs);
  }
  get signal(): AbortSignal { return this.controller.signal; }
  get stopped(): boolean { return this.signal.aborted || (!this.succeeded && this.now() >= this.deadline); }
  get remainingMs(): number { return Math.max(0, this.deadline - this.now()); }
  complete(): void { this.succeeded = true; clearTimeout(this.timer); }
  canSwitch(): boolean {
    if (this.stopped || this.remainingMs <= 0 || this.switches >= 3) return false;
    this.switches++;
    return true;
  }
  canRefresh(provider: string): boolean {
    if (this.stopped || this.remainingMs <= 0 || this.refreshed.has(provider)) return false;
    this.refreshed.add(provider);
    return true;
  }
  stop(): void { clearTimeout(this.timer); this.controller.abort(); }
}
