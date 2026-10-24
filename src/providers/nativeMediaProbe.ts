import type { PlaybackSourceRef } from '../data/mock';
import { EngineError } from '../engine/model';
import { engineNative } from '../engine/nativeBridge';
import { validateNativeProbe } from './nativeProbeValidation';

/** All remote probe bytes come through the DNS-bound native broker, never JS fetch. */
export async function probeNativeMedia(source: PlaybackSourceRef, signal?: AbortSignal, remainingMs = 10000): Promise<PlaybackSourceRef> {
  if (remainingMs <= 0) throw new EngineError('timeout');
  const result = await engineNative.invoke('probeMedia', { url: source.url, headers: source.headers, headerOrigin: source.headerOrigin, container: source.container, deadlineMs: Math.min(10000, remainingMs) }, signal);
  return validateNativeProbe(source, result.probe);
}
