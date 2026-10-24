import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { createDownloadClient, type NativeDownloads } from '../../modules/cinetor-media/src/download-client';

export { downloadKey, isOfflineMediaUri } from '../../modules/cinetor-media/src/download-client';
export type {
  DownloadContainer, DownloadResult, DownloadStatus, NativeDownload, QueueDownload, StorageInfo,
} from '../../modules/cinetor-media/src/download-client';

let native: NativeDownloads | undefined;
function getNative(): NativeDownloads {
  if (Platform.OS !== 'android') throw new Error('Persistent offline downloads require the Android app');
  if (!native) {
    try { native = requireNativeModule<NativeDownloads>('CinetorMedia'); }
    catch { throw new Error('Offline media requires an Android development or release build, not Expo Go'); }
  }
  return native;
}

// Native owns the persistent queue, exact representation, retries, and foreground lifecycle.
// A JS waiter may disappear without losing the download. Reconcile getDownloads() at app startup.
export const {
  downloadVideo, getDownloads, queryDownload, subscribeDownloadUpdates, pauseDownload,
  restartDownload, cancelDownload, deleteDownload, deleteLocalFile, getStorageInfo,
  getDownloadCapabilities, setDownloadPolicy, isActive,
} = createDownloadClient(getNative);
