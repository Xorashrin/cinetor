import { EngineError } from './model';

export interface EngineStatusSnapshot {
  state: 'initializing' | 'loading' | 'ready' | 'offline' | 'error';
  lastError?: string;
  updatedAt?: number;
}
export class EngineStatusStore {
  private value: EngineStatusSnapshot = { state: 'initializing' };
  private listeners = new Set<() => void>();
  getSnapshot = (): EngineStatusSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(patch: EngineStatusSnapshot): void { this.value = patch; for (const listener of this.listeners) listener(); }
  fail(error: unknown, hasCache: boolean): void {
    this.set({ state: hasCache ? 'ready' : error instanceof EngineError && ['offline', 'network', 'timeout'].includes(error.code) ? 'offline' : 'error',
      lastError: error instanceof EngineError ? error.code : 'network', updatedAt: Date.now() });
  }
}
