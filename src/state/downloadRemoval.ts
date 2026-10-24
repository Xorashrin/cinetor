import type { NativeDownloads } from '../../modules/cinetor-media/src/download-client';

/** Native records own their files. Only legacy files without a record use path-based deletion. */
export async function removeOwnedDownload(
  key: string,
  localUri: string | undefined,
  native: Pick<NativeDownloads, 'query' | 'delete' | 'deleteLocalFile'>,
): Promise<void> {
  const record = await native.query(key);
  if (record) await native.delete(key);
  else if (localUri?.startsWith('file:')) await native.deleteLocalFile(localUri);
}
