import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, ProgressBar } from '../components/Buttons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { img } from '../data/images';
import { findEpisode, getTitle } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { useApp, type DownloadEntry } from '../state/AppState';
import { colors, radius } from '../theme/tokens';
import { formatSize } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Downloads'>;

interface Group {
  titleId: string;
  entries: DownloadEntry[];
  sizeMB: number;
}

export default function DownloadsScreen({ navigation }: Props) {
  const { profileData, activeProfile, deleteDownload, startDownload, state, toggleSetting, showToast } = useApp();
  const [editing, setEditing] = useState(false);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const d of profileData.downloads) {
      const g = map.get(d.titleId) ?? { titleId: d.titleId, entries: [], sizeMB: 0 };
      g.entries.push(d);
      g.sizeMB += d.sizeMB * d.progress;
      map.set(d.titleId, g);
    }
    return [...map.values()];
  }, [profileData.downloads]);

  const usedMB = groups.reduce((sum, g) => sum + g.sizeMB, 0);

  return (
    <View style={styles.root}>
      <ScreenHeader
        back
        left={
          <View style={styles.headerLeft}>
            <Txt weight="bold" size={18} style={{ flex: 1 }}>
              Downloads
            </Txt>
            {groups.length > 0 ? (
              <Pressable hitSlop={10} onPress={() => setEditing((e) => !e)}>
                {editing ? (
                  <Txt weight="bold" size={15}>
                    Done
                  </Txt>
                ) : (
                  <Ionicons name="pencil" size={20} color={colors.text} />
                )}
              </Pressable>
            ) : null}
          </View>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Pressable onPress={() => toggleSetting('smartDownloads')} style={styles.smart}>
          <Ionicons name="sparkles-outline" size={18} color={colors.blue} />
          <Txt weight="semibold" size={13} style={{ marginLeft: 8 }}>
            SMART DOWNLOADS
          </Txt>
          <Txt weight="bold" size={13} color={colors.blue} style={{ marginLeft: 6 }}>
            {state.settings.smartDownloads ? 'ON' : 'OFF'}
          </Txt>
        </Pressable>

        {groups.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyCircle}>
              <Ionicons name="download-outline" size={72} color={colors.textDim} />
            </View>
            <Txt weight="bold" size={20} align="center" style={{ marginTop: 26 }}>
              Movies and TV shows that you download appear here.
            </Txt>
            <Button label="See What You Can Download" variant="white" height={44} style={{ marginTop: 28 }} onPress={() => navigation.navigate('Main', { screen: 'Home' })} />
          </View>
        ) : (
          <>
            {activeProfile ? (
              <Txt weight="semibold" size={14} color={colors.textMuted} style={styles.profileLabel}>
                Downloads for {activeProfile.name}
              </Txt>
            ) : null}
            {groups.map((g) => {
              const title = getTitle(g.titleId);
              const downloading = g.entries.find((e) => e.status === 'downloading');
              const failed = g.entries.find((e) => e.status === 'failed');
              const onDevice = g.entries.some((e) => e.savedToDevice);
              const episodes = g.entries.filter((e) => e.episodeId);
              const detail =
                title.kind === 'series'
                  ? `${episodes.length} ${episodes.length === 1 ? 'Episode' : 'Episodes'} | ${formatSize(g.sizeMB)}`
                  : `${title.maturity} | ${formatSize(g.sizeMB)}`;
              return (
                <Pressable
                  key={g.titleId}
                  onPress={() => {
                    if (editing) return;
                    if (failed) {
                      startDownload(failed.titleId, failed.sizeMB || 300, failed.episodeId);
                      return;
                    }
                    const first = episodes[0]?.episodeId;
                    if (title.kind === 'series' && first) navigation.navigate('Player', { id: title.id, episodeId: first });
                    else if (!downloading) navigation.navigate('Player', { id: title.id });
                  }}
                  style={({ pressed }) => [styles.item, pressed ? { backgroundColor: colors.surface1 } : null]}
                >
                  <View style={styles.thumb}>
                    <Image source={img.backdrop(title.seed)} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                    {!downloading && !failed ? (
                      <View style={styles.thumbPlay}>
                        <Ionicons name="play" size={16} color={colors.text} style={{ marginLeft: 2 }} />
                      </View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Txt weight="semibold" size={15} numberOfLines={1}>
                      {title.name}
                    </Txt>
                    {title.kind === 'series' && episodes[0]?.episodeId ? (
                      <Txt size={12} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
                        {findEpisode(title, episodes[0].episodeId)?.episode.name}
                      </Txt>
                    ) : null}
                    <Txt size={12} color={colors.textDim} style={{ marginTop: 4 }}>
                      {downloading
                        ? `Downloading - ${Math.round(downloading.progress * 100)}%`
                        : failed
                          ? 'Download failed • Tap to retry'
                          : `${detail}${onDevice ? ' • Saved to device' : ''}`}
                    </Txt>
                    {downloading ? <ProgressBar value={downloading.progress} height={2} style={{ marginTop: 6 }} /> : null}
                  </View>
                  {editing ? (
                    <Pressable
                      hitSlop={10}
                      onPress={() => {
                        deleteDownload(g.titleId);
                        showToast('Download deleted');
                      }}
                    >
                      <Ionicons name="trash-outline" size={22} color={colors.redLight} />
                    </Pressable>
                  ) : downloading ? (
                    <ActivityIndicator size="small" color={colors.blue} />
                  ) : failed ? (
                    <Ionicons name="refresh-circle-outline" size={24} color={colors.redLight} />
                  ) : (
                    <Ionicons name="checkmark-circle" size={22} color={colors.blue} />
                  )}
                </Pressable>
              );
            })}
            <Button label="Find More to Download" variant="gray" height={44} style={styles.more} onPress={() => navigation.navigate('Main', { screen: 'Home' })} />
          </>
        )}
      </ScrollView>
      <View style={styles.storage}>
        <View style={styles.storageBar}>
          <View style={{ flex: 30, backgroundColor: colors.textDim }} />
          <View style={{ flex: Math.max(1, usedMB / 100), backgroundColor: colors.blue }} />
          <View style={{ flex: 60, backgroundColor: colors.surface6 }} />
        </View>
        <View style={styles.storageLegend}>
          <Txt size={11} color={colors.textMuted}>Used • 38.2 GB</Txt>
          <Txt size={11} color={colors.textMuted}>Cinator • {formatSize(usedMB)}</Txt>
          <Txt size={11} color={colors.textMuted}>Free • 72.4 GB</Txt>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  smart: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyCircle: { width: 170, height: 170, borderRadius: 85, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  profileLabel: { paddingHorizontal: 16, marginTop: 6, marginBottom: 6 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  thumb: { width: 128, height: 72, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  thumbPlay: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.text, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  more: { alignSelf: 'center', marginTop: 24 },
  storage: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.surface1 },
  storageBar: { height: 4, flexDirection: 'row', borderRadius: 2, overflow: 'hidden' },
  storageLegend: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
});
