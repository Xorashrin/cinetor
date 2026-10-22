import { CancellationError, TimeoutError } from '../models/errors';

/**
 * Async Semaphore to enforce bounded concurrency on network requests.
 */
export class Semaphore {
  private currentCount: number;
  private readonly maxCount: number;
  private readonly waiting: Array<() => void> = [];

  constructor(maxCount: number) {
    if (maxCount < 1) throw new Error('Semaphore capacity must be at least 1');
    this.maxCount = maxCount;
    this.currentCount = maxCount;
  }

  public async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw signal.reason || new CancellationError();
    }

    if (this.currentCount > 0) {
      this.currentCount--;
      return this.createReleaser();
    }

    return new Promise<() => void>((resolve, reject) => {
      let aborted = false;
      let onAbort: (() => void) | undefined;

      const attempt = () => {
        if (aborted) return;
        if (onAbort && signal) {
          signal.removeEventListener('abort', onAbort);
        }
        resolve(this.createReleaser());
      };

      if (signal) {
        onAbort = () => {
          aborted = true;
          const index = this.waiting.indexOf(attempt);
          if (index >= 0) {
            this.waiting.splice(index, 1);
          }
          reject(signal.reason || new CancellationError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.waiting.push(attempt);
    });
  }

  public async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private createReleaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.waiting.length > 0) {
        const next = this.waiting.shift();
        if (next) next();
      } else {
        this.currentCount = Math.min(this.maxCount, this.currentCount + 1);
      }
    };
  }
}

/**
 * Options for executing an operation with exponential backoff retry.
 */
export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Executes an async task with exponential backoff and jitter.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 3000;
  const backoffFactor = options.backoffFactor ?? 2;

  let attempt = 1;
  let delay = initialDelayMs;

  while (true) {
    if (signal?.aborted) {
      throw signal.reason || new CancellationError();
    }

    try {
      return await task(attempt);
    } catch (err: unknown) {
      if (signal?.aborted || attempt >= maxAttempts) {
        throw err;
      }

      if (options.shouldRetry && !options.shouldRetry(err)) {
        throw err;
      }

      // Compute jittered delay
      const jitter = Math.random() * 0.3 * delay;
      const sleepTime = Math.min(maxDelayMs, delay + jitter);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, sleepTime);
        if (signal) {
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(signal.reason || new CancellationError());
            },
            { once: true },
          );
        }
      });

      delay *= backoffFactor;
      attempt++;
    }
  }
}

/**
 * Wraps a promise with a hard timeout.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = `Operation timed out after ${timeoutMs}ms`,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(errorMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
