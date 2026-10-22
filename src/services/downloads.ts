// Real file downloads: saved to app storage (for offline playback) and copied to the
// device's public media storage in a "MythTube" album so they appear in the file manager / gallery.
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';

const DIR = `${FileSystem.documentDirectory ?? ''}downloads/`;
const ALBUM = 'Cinator';

const active = new Map<string, FileSystem.DownloadResumable>();

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

export async function downloadVideo(key: string, url: string, onProgress: (ratio: number) => void): Promise<DownloadResult> {
  await ensureDir();
  const target = `${DIR}${key.replace(/[^a-z0-9-]/gi, '_')}.mp4`;
  const task = FileSystem.createDownloadResumable(url, target, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  active.set(key, task);
  try {
    const result = await task.downloadAsync();
    if (!result || result.status < 200 || result.status >= 300) throw new Error('Download failed');
    const info = await FileSystem.getInfoAsync(result.uri);
    const sizeMB = info.exists ? info.size / 1e6 : 0;
    const savedToDevice = await copyToDeviceStorage(result.uri);
    return { localUri: result.uri, sizeMB, savedToDevice };
  } finally {
    active.delete(key);
  }
}

export async function cancelDownload(key: string): Promise<void> {
  const task = active.get(key);
  active.delete(key);
  if (task) await task.cancelAsync().catch(() => undefined);
}

export async function deleteLocalFile(uri?: string): Promise<void> {
  if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export function isActive(key: string): boolean {
  return active.has(key);
}
