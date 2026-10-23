import { EngineError } from '../engine/model';
import { ProviderHttp, publicUrl } from './request';

export interface OfflineResource { url: string; path: string; encryptionKey: boolean }
export interface OfflinePlan {
  entry: string;
  playlists: { path: string; contents: string }[];
  resources: OfflineResource[];
}

function attributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g))
    result[match[1]] = match[2].replace(/^"|"$/g, '');
  return result;
}

/** Package finite HLS video and its default audio without executing provider pages. */
export async function planOfflineHls(
  url: string, http: ProviderHttp, headers: Record<string, string> = {}, signal?: AbortSignal,
): Promise<OfflinePlan> {
  const plan: OfflinePlan = { entry: 'index.m3u8', playlists: [], resources: [] };
  const resources = new Map<string, OfflineResource>();
  const resource = (value: string, base: string, encryptionKey = false): string => {
    const url = publicUrl(value, base);
    const previous = resources.get(url);
    if (previous) {
      if (previous.encryptionKey !== encryptionKey) throw new EngineError('malformed');
      return previous.path;
    }
    if (resources.size >= 10000) throw new EngineError('size');
    const suffix = encryptionKey ? '.key' : new URL(url).pathname.match(/\.(ts|m4s|mp4|aac)$/i)?.[0] ?? '.bin';
    const row = { url, path: `media-${resources.size}${suffix}`, encryptionKey };
    resources.set(url, row);
    return row.path;
  };
  const visit = async (input: string, path: string, depth: number): Promise<void> => {
    if (depth > 2) throw new EngineError('unsupported');
    const response = await http.request(publicUrl(input), { signal, headers, maxBytes: 1048576 });
    const lines = response.text.trim().split(/\r?\n/).map(line => line.trim());
    if (lines[0] !== '#EXTM3U' || lines.some(line => /^#EXT-X-(?:SESSION-KEY|BYTERANGE|PART|PRELOAD-HINT|DEFINE):/.test(line)))
      throw new EngineError('unsupported');
    const variants = lines.flatMap((line, index) => {
      if (!line.startsWith('#EXT-X-STREAM-INF:')) return [];
      const uri = lines.slice(index + 1).find(next => next && !next.startsWith('#'));
      if (!uri) throw new EngineError('malformed');
      const attrs = attributes(line);
      return [{ line, attrs, uri, bandwidth: Number(attrs.BANDWIDTH) || 0 }];
    }).sort((a, b) => b.bandwidth - a.bandwidth);
    if (variants.length) {
      const variant = variants[0];
      const audio = lines.filter(line => line.startsWith('#EXT-X-MEDIA:')).map(line => ({ line, attrs: attributes(line) }))
        .filter(row => row.attrs.TYPE === 'AUDIO' && row.attrs['GROUP-ID'] === variant.attrs.AUDIO && row.attrs.URI)
        .sort((a, b) => Number(b.attrs.DEFAULT === 'YES') - Number(a.attrs.DEFAULT === 'YES'))[0];
      const videoPath = `video-${depth}.m3u8`, audioPath = `audio-${depth}.m3u8`;
      await visit(publicUrl(variant.uri, response.url), videoPath, depth + 1);
      if (audio) await visit(publicUrl(audio.attrs.URI, response.url), audioPath, depth + 1);
      const audioLine = audio?.line.replace(/URI="[^"]*"/, `URI="${audioPath}"`);
      let streamLine = variant.line.replace(/,(?:SUBTITLES|VIDEO)="[^"]*"/g, '');
      if (!audio) streamLine = streamLine.replace(/,AUDIO="[^"]*"/, '');
      plan.playlists.push({ path, contents: ['#EXTM3U', ...(audioLine ? [audioLine] : []), streamLine, videoPath, ''].join('\n') });
      return;
    }
    if (!lines.includes('#EXT-X-ENDLIST') || !lines.some(line => line.startsWith('#EXTINF:')))
      throw new EngineError('unsupported');
    let segments = 0;
    const local = lines.map(line => {
      if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = attributes(line);
        if (attrs.METHOD === 'NONE') return line;
        if (attrs.METHOD !== 'AES-128' || (attrs.KEYFORMAT && attrs.KEYFORMAT !== 'identity') || !attrs.URI)
          throw new EngineError('unsupported');
        return line.replace(/URI="[^"]*"/, `URI="${resource(attrs.URI, response.url, true)}"`);
      }
      if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = attributes(line);
        if (!attrs.URI || attrs.BYTERANGE) throw new EngineError('unsupported');
        return line.replace(/URI="[^"]*"/, `URI="${resource(attrs.URI, response.url)}"`);
      }
      if (line.startsWith('#')) {
        if (line.includes('URI=')) throw new EngineError('unsupported');
        return line;
      }
      if (!line) return line;
      segments++;
      return resource(line, response.url);
    });
    if (!segments) throw new EngineError('malformed');
    plan.playlists.push({ path, contents: local.join('\n') + '\n' });
  };
  await visit(url, plan.entry, 0);
  if (signal?.aborted) throw new EngineError('cancelled');
  plan.resources = [...resources.values()];
  return plan;
}

/** Stop scheduling immediately on failure and await all workers before cleanup. */
export async function downloadResources(
  resources: OfflineResource[], download: (resource: OfflineResource) => Promise<void>, signal: AbortSignal,
  onComplete: (completed: number, total: number) => void,
): Promise<void> {
  let cursor = 0, completed = 0;
  let failure: unknown;
  let failed = false;
  const worker = async () => {
    while (!failed && !signal.aborted) {
      const index = cursor++;
      if (index >= resources.length) return;
      try {
        await download(resources[index]);
        if (signal.aborted) return;
        onComplete(++completed, resources.length);
      } catch (error) { if (!failed) failure = error; failed = true; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, resources.length) }, worker));
  if (signal.aborted) throw new EngineError('cancelled');
  if (failed) throw failure;
}
