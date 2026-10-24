import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';

import { Button, IconButton } from '../components/Buttons';
import { CatalogArtwork } from '../components/CatalogRow';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { findEpisode, getTitle } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { getStorageInfo, type StorageInfo } from '../services/downloads';
import { useApp, type DownloadEntry } from '../state/AppState';
import { colors } from '../theme/tokens';
import { formatSize } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Downloads'>;
function statusLabel(entry: DownloadEntry): string {
  if (entry.status === 'downloaded') return `Available offline · ${formatSize(entry.sizeMB)}`;
  if (entry.status === 'paused') return 'Paused · restart uses a new file';
  if (entry.status === 'failed') return 'Failed · check sources to restart';
  if (entry.status === 'queued') return 'Queued · waiting for a transfer slot';
  const bytes = entry.bytesDownloaded === undefined ? '' : `${formatSize(entry.bytesDownloaded / (1024 * 1024))} received`;
  return entry.progressKind === 'indeterminate' ? `Downloading · ${bytes || 'total size unknown'}` : `Downloading · ${Math.round(entry.progress * 100)}%${entry.progressKind === 'segments' ? ' of selected segments' : ''}${bytes ? ` · ${bytes}` : ''}`;
}
export default function DownloadsScreen({ navigation }: Props) {
  const { profileData, activeProfile, state, startDownload, pauseDownload, deleteDownload, showToast } = useApp();
  const [storage, setStorage] = useState<StorageInfo>();
  const [removing, setRemoving] = useState<string>();
  const refreshStorage = useCallback(() => { void getStorageInfo().then(setStorage).catch(() => setStorage(undefined)); }, []);
  useEffect(() => { refreshStorage(); }, [refreshStorage, profileData.downloads.length]);
  const remove = (row: DownloadEntry) => Alert.alert('Delete download?', 'Remove this exact offline file and its download record? Other profiles and episodes are not affected.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
    const key = row.episodeId ?? row.titleId; setRemoving(key);
    void deleteDownload(row.titleId, row.episodeId, activeProfile.id).then(() => { showToast('Download removed.'); refreshStorage(); }).catch(() => showToast('The download could not be removed. Its record was kept so you can try again.')).finally(() => setRemoving(undefined));
  } }]);
  return <View style={styles.root}><ScreenHeader title="Downloads" back /><FlatList data={profileData.downloads} keyExtractor={row => row.episodeId ?? row.titleId} initialNumToRender={10} windowSize={7} contentContainerStyle={styles.content}
    ListHeaderComponent={<><Txt size={24} weight="bold">Offline, for {activeProfile.name}.</Txt><Txt size={13} color={colors.textMuted} style={styles.space}>{state.settings.wifiOnly ? 'Wi-Fi-only transfers are enabled.' : 'Transfers may use cellular data.'} At most two transfers run at once. Paused transfers restart from zero.</Txt><View style={styles.storage}><Txt size={13}>{storage ? `${formatSize(storage.freeBytes / (1024 * 1024))} free on app storage` : 'Device storage information unavailable'}</Txt>{storage ? <Txt size={12} color={colors.textMuted} style={styles.space}>{formatSize(storage.usedBytes / (1024 * 1024))} used by downloads · {formatSize(storage.reservedBytes / (1024 * 1024))} reserved for transfers</Txt> : null}<Button label="Refresh storage" variant="secondary" style={styles.space} onPress={refreshStorage} /></View></>}
    renderItem={({ item }) => {
      const title = getTitle(item.titleId);
      const episode = item.episodeId ? findEpisode(title, item.episodeId) : null;
      const name = title.id === 'empty' ? item.titleId : title.name;
      const active = item.status === 'queued' || item.status === 'downloading';
      return <View style={styles.card}><View style={styles.row}><CatalogArtwork uri={episode?.episode.posterUrl ?? title.posterUrl} identity={item.episodeId ?? item.titleId} style={styles.poster} /><View style={{ flex: 1 }}><Txt weight="semibold" size={17}>{name}</Txt>{item.episodeId ? <Txt color={colors.textMuted} size={12} style={styles.space}>{episode ? `S${episode.season.number} E${episode.episode.number} · ${episode.episode.name}` : item.episodeId}</Txt> : null}<Txt color={item.status === 'failed' ? colors.warning : colors.textMuted} size={13} style={styles.space}>{statusLabel(item)}</Txt></View><IconButton icon="trash-outline" accessibilityLabel={`Delete ${name}${item.episodeId ? ' episode' : ''} download`} disabled={!!removing} onPress={() => remove(item)} /></View><View style={[styles.actions, styles.space]}>
        {item.status === 'downloaded' && item.localUri ? <Button label="Play offline" icon="play" onPress={() => navigation.navigate('Player', { id: item.titleId, episodeId: item.episodeId })} /> : active ? <Button label="Pause" variant="secondary" icon="pause" onPress={() => pauseDownload(item.titleId, item.episodeId)} /> : <Button label="Check sources & restart" variant="secondary" icon="refresh" onPress={() => startDownload(item.titleId, 0, item.episodeId)} />}
      </View></View>;
    }}
    ListEmptyComponent={<View style={styles.empty}><Ionicons name="download-outline" size={42} color={colors.accent} /><Txt weight="bold" size={19} style={styles.space}>No saved downloads</Txt><Txt color={colors.textMuted} size={14} style={styles.space}>Only compatible, finite media can be saved. A catalog listing does not guarantee a downloadable source.</Txt><Button label="Browse titles" variant="secondary" style={styles.space} onPress={() => navigation.navigate('Main', { screen: 'Home' })} /></View>} /></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 16, paddingBottom: 48, maxWidth: 840, width: '100%', alignSelf: 'center' }, space: { marginTop: 10 }, storage: { marginVertical: 20, padding: 16, borderRadius: 16, backgroundColor: colors.surface2 }, card: { backgroundColor: colors.surface1, padding: 16, borderRadius: 16, marginBottom: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, poster: { width: 60, height: 90 }, empty: { padding: 24, backgroundColor: colors.surface1, borderRadius: 16 } });
