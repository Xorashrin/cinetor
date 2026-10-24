import type { PlaybackSourceRef } from '../data/mock';
import { EngineError } from '../engine/model';
import { ProviderHttp, publicUrl } from './request';

const magic = (bytes: Uint8Array) => String.fromCharCode(...bytes.slice(4, 8));

/** A bounded format probe is transport evidence only, never decoded-playback evidence. */
export async function probeMedia(source: PlaybackSourceRef, http: ProviderHttp, signal?: AbortSignal, depth = 0): Promise<PlaybackSourceRef> {
  if (signal?.aborted) throw new EngineError('cancelled');
  if (depth > 2) throw new EngineError('unsupported');
  const url = publicUrl(source.url);
  const headerOrigin = source.headerOrigin ?? new URL(url).origin;
  const options = { signal, headers: source.headers, headerOrigin };
  if (source.container === 'mp4' || source.container === 'mkv') {
    const result = await http.request(url, { ...options, headers: { ...source.headers, Range: 'bytes=0-4095' }, maxBytes: 4096, prefix: true });
    const valid = source.container === 'mp4' ? result.bytes.length >= 16 && magic(result.bytes) === 'ftyp' :
      result.bytes.length >= 4 && result.bytes[0] === 0x1a && result.bytes[1] === 0x45 && result.bytes[2] === 0xdf && result.bytes[3] === 0xa3;
    if (!valid) throw new EngineError('unsupported');
    const rangeLength = /\/(\d+)$/.exec(result.headers['content-range'] ?? '')?.[1];
    const size = rangeLength ? Number(rangeLength) : result.status === 200 ? Number(result.headers['content-length']) : 0;
    return { ...source, headerOrigin, url: result.url, verificationState: 'transport-verified', fileSizeBytes: Number.isFinite(size) && size > 0 ? size : source.fileSizeBytes };
  }
  const result = await http.request(url, { ...options, maxBytes: 1048576 });
  if (source.container === 'dash') {
    if (!/<(?:\w+:)?MPD\b/i.test(result.text) || /<\s*(?:\w+:)?ContentProtection\b/i.test(result.text)) throw new EngineError('unsupported');
    const finite = !/\btype\s*=\s*["']dynamic["']/i.test(result.text) && (/\btype\s*=\s*["']static["']/i.test(result.text) || /\bmediaPresentationDuration\s*=/i.test(result.text));
    return { ...source, headerOrigin, url: result.url, verificationState: 'manifest-verified', downloadable: source.downloadable === true && finite };
  }
  if (source.container !== 'hls' || !result.text.trimStart().startsWith('#EXTM3U') ||
      /#EXT-X-(?:SESSION-KEY|KEY):[^\n]*(?:SAMPLE-AES|KEYFORMAT)/i.test(result.text) ||
      /#EXT-X-(?:CUE-OUT|DATERANGE):[^\n]*(?:ad|scte)/i.test(result.text)) throw new EngineError('unsupported');
  const lines = result.text.split(/\r?\n/).map(line => line.trim());
  const variant = lines.findIndex(line => line.startsWith('#EXT-X-STREAM-INF:'));
  let finite: boolean;
  if (variant >= 0) {
    const child = lines.slice(variant + 1).find(line => line && !line.startsWith('#'));
    if (!child) throw new EngineError('malformed');
    const checked = await probeMedia({ ...source, headerOrigin, url: publicUrl(child, result.url) }, http, signal, depth + 1);
    finite = checked.downloadable === true;
  } else {
    const index = lines.findIndex(line => line.startsWith('#EXTINF:'));
    const segment = lines.slice(index + 1).find(line => line && !line.startsWith('#'));
    if (index < 0 || !segment) throw new EngineError('malformed');
    const bytes = await http.request(publicUrl(segment, result.url), { ...options, prefix: true, maxBytes: 4096 });
    if (bytes.bytes[0] !== 0x47 && !['ftyp', 'styp', 'moof'].includes(magic(bytes.bytes))) throw new EngineError('unsupported');
    finite = lines.includes('#EXT-X-ENDLIST');
  }
  return { ...source, headerOrigin, url: result.url, verificationState: 'transport-verified', downloadable: source.downloadable === true && finite };
}
