// Real file downloads: saved to app storage (for offline playback) and copied to the
// device's public media storage in a "Cinator" album so they appear in the file manager / gallery.
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';
import { fetch as nativeFetch } from 'expo/fetch';
import { ProviderHttp } from '../providers/request';
import { downloadResources, planOfflineHls } from '../providers/offline';

const DIR = `${FileSystem.documentDirectory ?? ''}downloads/`;
const ALBUM = 'Cinator';

interface DownloadOperation {
  controller: AbortController;
  tasks: Set<FileSystem.DownloadResumable>;
}
const active = new Map<string, DownloadOperation>();

export function downloadKey(titleId: string, episodeId?: string): string {
  return episodeId ?? titleId;
}

export interface DownloadResult {
  localUri: string;
  sizeMB: number;
  savedToDevice: boolean;
}

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

async function copyToDeviceStorage(localUri: string): Promise<boolean> {
  try {
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) return false;
    const asset = await MediaLibrary.createAssetAsync(localUri);
    const album = await MediaLibrary.getAlbumAsync(ALBUM);
    if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    else await MediaLibrary.createAlbumAsync(ALBUM, asset, false);
    return true;
  } catch {
    return false;
  }
}

export async function downloadVideo(key: string, url: string, onProgress: (ratio: number) => void, headers?: Record<string, string>): Promise<DownloadResult> {
  if (active.has(key)) throw new Error('This download is already running');
  const isHls = new URL(url).pathname.toLowerCase().endsWith('.m3u8');
  if (!isHls && !new URL(url).pathname.toLowerCase().endsWith('.mp4')) throw new Error('This video cannot be downloaded');
  const operation: DownloadOperation = { controller: new AbortController(), tasks: new Set() };
  active.set(key, operation);
  const stem = `${DIR}${key.replace(/[^a-z0-9-]/gi, '_')}`;
  const target = isHls ? `${stem}-hls/` : `${stem}.mp4`;
  const transfer = async (source: string, destination: string, progress?: (ratio: number) => void) => {
    if (operation.controller.signal.aborted) throw new Error('Download canceled');
    const task = FileSystem.createDownloadResumable(source, destination, { headers }, p => {
      if (p.totalBytesExpectedToWrite > 0) progress?.(Math.min(0.99, p.totalBytesWritten / p.totalBytesExpectedToWrite));
    });
    operation.tasks.add(task);
    try {
      const result = await task.downloadAsync();
      if (operation.controller.signal.aborted) throw new Error('Download canceled');
      if (!result || result.status !== 200) throw new Error('Download failed');
      const type = Object.entries(result.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1]?.split(';')[0].trim().toLowerCase();
      if (type === 'text/html' || type === 'application/json') throw new Error('The server did not return video');
      const info = await FileSystem.getInfoAsync(result.uri);
      if (!info.exists || info.size < 1) throw new Error('The downloaded video is empty');
      return { uri: result.uri, bytes: info.size, type };
    } finally { operation.tasks.delete(task); }
  };
  try {
    await ensureDir();
    if (isHls) {
      const plan = await planOfflineHls(url, new ProviderHttp(nativeFetch), headers, operation.controller.signal);
      await FileSystem.deleteAsync(target, { idempotent: true });
      await FileSystem.makeDirectoryAsync(target, { intermediates: true });
      let bytes = 0;
      await downloadResources(plan.resources, async resource => {
        const result = await transfer(resource.url, target + resource.path);
        if (resource.encryptionKey && result.bytes !== 16) throw new Error('Invalid video encryption key');
        bytes += result.bytes;
      }, operation.controller.signal, (done, total) => onProgress(Math.min(0.99, done / total)));
      for (const playlist of plan.playlists) {
        if (operation.controller.signal.aborted) throw new Error('Download canceled');
        await FileSystem.writeAsStringAsync(target + playlist.path, playlist.contents);
        bytes += playlist.contents.length;
      }
      if (operation.controller.signal.aborted) throw new Error('Download canceled');
      return { localUri: target + plan.entry, sizeMB: bytes / 1e6, savedToDevice: false };
    }
    const result = await transfer(url, target, onProgress);
    if (result.type && !['video/mp4', 'application/octet-stream'].includes(result.type)) throw new Error('The server did not return video');
    const header = await FileSystem.readAsStringAsync(result.uri, { encoding: 'base64', position: 0, length: 16 });
    if (result.bytes < 16 || atob(header).slice(4, 8) !== 'ftyp') throw new Error('The downloaded file is not MP4 video');
    const savedToDevice = await copyToDeviceStorage(result.uri);
    return { localUri: result.uri, sizeMB: result.bytes / 1e6, savedToDevice };
  } catch (error) {
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
    throw error;
  } finally {
    if (active.get(key) === operation) active.delete(key);
  }
}

export async function cancelDownload(key: string): Promise<void> {
  const operation = active.get(key);
  if (!operation) return;
  operation.controller.abort();
  await Promise.all([...operation.tasks].map(task => task.cancelAsync().catch(() => undefined)));
}

export async function deleteLocalFile(uri?: string): Promise<void> {
  if (uri) {
    const target = uri.startsWith(DIR) && uri.endsWith('-hls/index.m3u8') ? uri.slice(0, -'index.m3u8'.length) : uri;
    await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => undefined);
  }
}

export function isActive(key: string): boolean {
  return active.has(key);
}
