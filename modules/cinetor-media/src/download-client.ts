export type DownloadContainer = 'mp4' | 'hls' | 'dash' | 'mkv';
export type DownloadStatus = 'queued' | 'downloading' | 'paused' | 'downloaded' | 'failed';

export interface NativeDownload {
  key: string;
  id: string;
  status: DownloadStatus;
  container: DownloadContainer;
  bytesDownloaded: number;
  totalBytes: number | null;
  progress: number | null;
  progressKind?: 'bytes' | 'segments' | 'indeterminate';
  localUri?: string;
  sizeMB?: number;
  error?: string;
  errorCode?: string;
  removed?: boolean;
  updatedAt: number;
  /** Paused/interrupted downloads always restart from zero, never append old bytes. */
  restartRequired: boolean;
}

export interface DownloadResult {
  localUri: string;
  sizeMB: number;
  savedToDevice: boolean;
}

export interface QueueDownload {
  key: string;
  url: string;
  headers?: Record<string, string>;
  container?: DownloadContainer;
  headerOrigin?: string;
}

export interface StorageInfo {
  freeBytes: number;
  totalBytes: number;
  usedBytes: number;
  reservedBytes: number;
}

export interface NativeDownloads {
  getDownloads(): Promise<NativeDownload[]>;
  query(key: string): Promise<NativeDownload | null>;
  queue(options: QueueDownload): Promise<NativeDownload>;
  restart(options: Partial<QueueDownload> & { key: string }): Promise<NativeDownload>;
  pause(key: string): Promise<NativeDownload | null>;
  cancel(key: string): Promise<void>;
  cancelAttempt(key: string, id: string): Promise<void>;
  delete(key: string): Promise<void>;
  deleteLocalFile(uri: string): Promise<void>;
  getStorageInfo(): Promise<StorageInfo>;
  setDownloadPolicy(policy: { wifiOnly: boolean }): Promise<void>;
  getCapabilities(): Promise<{
    available: boolean;
    platform: string;
    maxParallelDownloads: number;
    perHostLimit: number;
    notificationsAllowed: boolean;
  }>;
  addListener(name: 'onDownloadUpdate', listener: (entry: NativeDownload) => void): { remove(): void };
}

export function downloadKey(titleId: string, episodeId?: string, profileId = 'default'): string {
  // Keep the profile prefix visible for native snapshot reconciliation; never use this as a path.
  return `${profileId}:${episodeId ?? titleId}`;
}

export function isOfflineMediaUri(uri?: string): boolean {
  return /^cinetor-offline:\/\/download\/[a-f0-9-]{36}$/.test(uri ?? '');
}

function canceled(): Error {
  const error = new Error('Download canceled');
  error.name = 'AbortError';
  return error;
}

/** Pure bridge adapter, injected in CI tests; no JS network transfer or background polling. */
export function createDownloadClient(getNative: () => NativeDownloads) {
  const active = new Set<string>();
  const snapshots = new Map<string, NativeDownload>();

  function remember(entry: NativeDownload) {
    const previous = snapshots.get(entry.key);
    // An old attempt's asynchronous removal must not erase its replacement.
    if (entry.removed) {
      if (!previous || previous.id === entry.id) snapshots.delete(entry.key);
    } else if (!previous || previous.updatedAt <= entry.updatedAt) {
      snapshots.set(entry.key, entry);
    }
  }

  function subscribeDownloadUpdates(listener: (entry: NativeDownload) => void): () => void {
    const subscription = getNative().addListener('onDownloadUpdate', entry => {
      remember(entry);
      listener(entry);
    });
    return () => subscription.remove();
  }

  async function getDownloads(): Promise<NativeDownload[]> {
    const entries = await getNative().getDownloads();
    snapshots.clear();
    entries.forEach(remember);
    return entries;
  }

  async function downloadVideo(
    key: string,
    url: string,
    onProgress: (ratio: number) => void,
    headers?: Record<string, string>,
    signal?: AbortSignal,
    container?: DownloadContainer,
    headerOrigin?: string,
  ): Promise<DownloadResult> {
    if (signal?.aborted) throw canceled();
    if (active.has(key)) throw new Error('This download is already running');
    const native = getNative();
    active.add(key);
    let subscription: { remove(): void } | undefined;
    let acceptedId: string | undefined;
    let queued = false;
    let aborted = false;
    let settled = false;
    let resolveResult!: (result: DownloadResult) => void;
    let rejectResult!: (error: Error) => void;
    const events: NativeDownload[] = [];
    const result = new Promise<DownloadResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    // Install the rejection handler immediately, including during an asynchronous queue call.
    const guardedResult = result.then(value => ({ value }), error => ({ error: error as Error }));
    const fail = (error: Error) => {
      if (!settled) { settled = true; rejectResult(error); }
    };
    const consume = (entry: NativeDownload) => {
      if (entry.key !== key || settled) return;
      if (!acceptedId) {
        // Only a bounded tail is needed while native queue acknowledgement crosses the bridge.
        if (events.length === 16) events.shift();
        events.push(entry);
        return;
      }
      if (entry.id !== acceptedId) return;
      remember(entry);
      if (entry.removed || entry.errorCode === 'canceled') { fail(canceled()); return; }
      if (entry.status === 'failed') { fail(new Error(entry.error || 'Download failed')); return; }
      if (entry.status === 'paused') { fail(new Error('Download paused. Restart begins from zero.')); return; }
      if (entry.status === 'downloaded') {
        if (!entry.localUri || !Number.isFinite(entry.sizeMB) || (entry.sizeMB ?? 0) <= 0) {
          fail(new Error('The native download has no verified offline media'));
          return;
        }
        settled = true;
        try { onProgress(1); } catch { /* UI callbacks cannot invalidate a verified download. */ }
        resolveResult({ localUri: entry.localUri, sizeMB: entry.sizeMB!, savedToDevice: false });
      } else if (entry.progress !== null && Number.isFinite(entry.progress)) {
        try { onProgress(Math.min(0.99, Math.max(0, entry.progress))); } catch { /* Keep transfer independent of UI. */ }
      }
    };
    const abort = () => {
      if (settled) return;
      aborted = true;
      fail(canceled());
      // If queue has not acknowledged yet, cancel immediately after it does, not before it exists.
      if (queued && acceptedId) void native.cancelAttempt(key, acceptedId).catch(() => undefined);
    };
    try {
      subscription = native.addListener('onDownloadUpdate', consume);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      if (!aborted) {
        const entry = await native.queue({ key, url, headers, container, headerOrigin });
        queued = true;
        acceptedId = entry.id;
        remember(entry);
        if (aborted) await native.cancelAttempt(key, acceptedId).catch(() => undefined);
        else {
          consume(entry);
          events.forEach(consume);
          // Closes the event/ack race even if completion was faster than the bridge.
          if (!settled) {
            const current = await native.query(key);
            if (current) consume(current);
          }
        }
      }
      const outcome = await guardedResult;
      if ('error' in outcome) throw outcome.error;
      return outcome.value;
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Download failed'));
      throw error;
    } finally {
      subscription?.remove();
      signal?.removeEventListener('abort', abort);
      active.delete(key);
    }
  }

  return {
    downloadVideo,
    getDownloads,
    subscribeDownloadUpdates,
    queryDownload: async (key: string) => {
      const entry = await getNative().query(key);
      if (entry) remember(entry);
      return entry;
    },
    pauseDownload: (key: string) => getNative().pause(key),
    restartDownload: (key: string, url?: string, headers?: Record<string, string>, container?: DownloadContainer, headerOrigin?: string) =>
      getNative().restart({ key, url, headers, container, headerOrigin }),
    cancelDownload: (key: string) => getNative().cancel(key),
    deleteDownload: (key: string) => getNative().delete(key),
    deleteLocalFile: async (uri?: string) => { if (uri) await getNative().deleteLocalFile(uri); },
    getStorageInfo: () => getNative().getStorageInfo(),
    setDownloadPolicy: (policy: { wifiOnly: boolean }) => getNative().setDownloadPolicy(policy),
    getDownloadCapabilities: () => getNative().getCapabilities(),
    isActive: (key: string) => active.has(key) || ['queued', 'downloading'].includes(snapshots.get(key)?.status ?? ''),
  };
}
