import type { PlaybackSourceRef } from '../data/mock';
import { EngineError } from '../engine/model';
import { publicUrl } from './request';

export interface NativeMediaProbeResult {
  statusCode: number;
  url: string;
  headers: Record<string, string>;
  bodyBase64: string;
  bodyText: string;
  byteLength: number;
  kind: 'prefix' | 'manifest';
  representationId?: string;
}
function prefix(base64: string): Uint8Array {
  if (typeof base64 !== 'string' || !/^[a-zA-Z0-9+/]*={0,2}$/.test(base64) || base64.length > 6000 || base64.length % 4 !== 0) throw new EngineError('malformed');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let value = 0, bits = 0;
  for (const char of base64) {
    if (char === '=') break;
    value = (value << 6) | alphabet.indexOf(char); bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
  }
  return Uint8Array.from(bytes);
}
/** Validate native transport evidence without loading Expo or trusting provider-supplied proof. */
export function validateNativeProbe(source: PlaybackSourceRef, result?: NativeMediaProbeResult): PlaybackSourceRef {
  if (!result || !Number.isInteger(result.byteLength) || result.byteLength < 1 || result.byteLength > 1048576 || ![200, 206].includes(result.statusCode) ||
      typeof result.representationId !== 'string' || !/^[a-f0-9]{64}$/.test(result.representationId)) throw new EngineError('malformed');
  const url = publicUrl(result.url);
  const headerOrigin = source.headerOrigin ?? new URL(source.url).origin;
  const representationId = result.representationId;
  if (!result.headers || typeof result.headers !== 'object' || Array.isArray(result.headers) ||
      Object.values(result.headers).some(value => typeof value !== 'string')) throw new EngineError('malformed');
  const headers = Object.fromEntries(Object.entries(result.headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (source.container === 'mp4' || source.container === 'mkv' || source.container === 'webm') {
    if (result.kind !== 'prefix' || result.byteLength > 4096) throw new EngineError('size');
    const bytes = prefix(result.bodyBase64);
    if (bytes.length !== result.byteLength) throw new EngineError('malformed');
    const magic = String.fromCharCode(...bytes.slice(4, 8));
    if (source.container === 'mp4' ? bytes.length < 16 || magic !== 'ftyp' : bytes.length < 4 || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) throw new EngineError('unsupported');
    const range = /^bytes 0-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '');
    if (result.statusCode === 206 && (!range || Number(range[1]) + 1 !== bytes.length || !Number.isSafeInteger(Number(range[2])) || Number(range[2]) <= Number(range[1]))) throw new EngineError('malformed');
    const size = range ? Number(range[2]) : Number(headers['content-length']);
    return { ...source, url, headerOrigin, representationId, downloadable: source.downloadable === true && source.container === 'mp4', fileSizeBytes: Number.isSafeInteger(size) && size > 0 ? size : undefined, verificationState: 'transport-verified' };
  }
  if (result.kind !== 'manifest' || typeof result.bodyText !== 'string' || result.bodyText.length > 1048576) throw new EngineError('malformed');
  const text = result.bodyText;
  if (source.container === 'hls') {
    const lines = text.trimStart().split(/\r?\n/).map(line => line.trim());
    if (lines[0] !== '#EXTM3U') throw new EngineError('unsupported');
    for (const line of lines.filter(value => /^#EXT-X-(?:SESSION-KEY|KEY):/.test(value))) {
      const fields = line.slice(line.indexOf(':') + 1);
      const matches = [...fields.matchAll(/(?:^|,)([A-Z0-9-]+)=("[^"\r\n]*"|[^,\s"]+)/g)];
      if (matches.length > 32 || matches.reduce((length, match) => length + match[0].length, 0) !== fields.length || new Set(matches.map(match => match[1])).size !== matches.length) throw new EngineError('unsupported');
      const attributes = Object.fromEntries(matches.map(match => [match[1], match[2].replace(/^"|"$/g, '')]));
      if (!['NONE', 'AES-128'].includes(attributes.METHOD) || (attributes.KEYFORMAT !== undefined && attributes.KEYFORMAT !== 'identity') ||
          (attributes.METHOD === 'AES-128' && !attributes.URI) ||
          (attributes.METHOD === 'NONE' && (matches.length !== 1 || line.startsWith('#EXT-X-SESSION-KEY:')))) throw new EngineError('unsupported');
    }
    const master = lines.some(line => line.startsWith('#EXT-X-STREAM-INF:'));
    const unsupportedOffline = lines.some(line => /^#EXT-X-(?:PART|PRELOAD-HINT|CONTENT-STEERING):/.test(line));
    // The native download planner still validates finite child playlists before accepting a master.
    return { ...source, url, headerOrigin, representationId, verificationState: 'manifest-verified', downloadable: source.downloadable === true && !unsupportedOffline && (master || lines.includes('#EXT-X-ENDLIST')) };
  }
  if (source.container === 'dash') {
    if (!/<(?:\w+:)?MPD\b/.test(text) || /<(?:\w+:)?ContentProtection\b/i.test(text)) throw new EngineError('unsupported');
    const finite = !/\btype\s*=\s*["']dynamic["']/i.test(text) && (/\btype\s*=\s*["']static["']/i.test(text) || /\bmediaPresentationDuration\s*=/.test(text));
    return { ...source, url, headerOrigin, representationId, verificationState: 'manifest-verified', downloadable: source.downloadable === true && finite };
  }
  throw new EngineError('unsupported');
}
