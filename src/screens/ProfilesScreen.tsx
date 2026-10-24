import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';

import { Avatar } from '../components/Avatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { getTitle } from '../data/mock';
import { useRootNav } from '../navigation/types';
import { useApp, type ProgressEntry } from '../state/AppState';
import { colors, layout, radius } from '../theme/tokens';
import { formatClock } from '../utils/format';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
function MenuItem({ icon, label, detail, onPress }: { icon: IconName; label: string; detail?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.surface2 }]}>
    <View style={styles.icon}><Ionicons name={icon} size={21} color={colors.red} /></View>
    <View style={{ flex: 1 }}><Txt weight="semibold" size={15}>{label}</Txt>{detail ? <Txt size={12} color={colors.textMuted} style={{ marginTop: 3 }}>{detail}</Txt> : null}</View>
    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
  </Pressable>;
}
export default function ProfilesScreen() {
  const nav = useRootNav();
  const { activeProfile, profiles, profileData, removeProgress, state } = useApp();
  const watching = useMemo(() => profileData.progress.filter(row => row.duration > 0 && row.position >= 5 && row.position < row.duration - 10).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20), [profileData.progress]);
  const renderProgress = ({ item }: { item: ProgressEntry }) => {
    const title = getTitle(item.titleId);
    const found = title.seasons.flatMap(season => season.episodes.map(episode => ({ season: season.number, episode }))).find(row => row.episode.id === item.episodeId);
    const label = title.id === 'empty' ? 'Saved title is not in the current catalog' : title.name;
    return <View style={styles.progressRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Resume ${label}${found ? ` season ${found.season} episode ${found.episode.number}` : ''}`} onPress={() => nav.navigate('Player', { id: item.titleId, episodeId: item.episodeId })} style={styles.progressAction}>
        <View style={styles.thumbnail}>{title.posterUrl ? <Image source={{ uri: title.posterUrl }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.titleId} style={StyleSheet.absoluteFill} /> : <Ionicons name="film-outline" size={24} color={colors.textMuted} />}</View>
        <View style={{ flex: 1 }}><Txt weight="semibold" size={14} numberOfLines={2}>{label}</Txt>
          {found ? <Txt size={12} color={colors.textMuted} style={{ marginTop: 4 }}>S{found.season} · E{found.episode.number} · {found.episode.name}</Txt> : null}
          <Txt size={12} color={colors.textMuted} style={{ marginTop: 5 }}>{formatClock(item.position)} of {formatClock(item.duration)}</Txt>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, item.position / item.duration * 100)}%` }]} /></View>
        </View><Ionicons name="play-circle" size={32} color={colors.red} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label} from Continue Watching`} onPress={() => removeProgress(item.titleId, item.episodeId)} style={styles.remove}><Ionicons name="close-outline" size={22} color={colors.textMuted} /></Pressable>
    </View>;
  };
  return <View style={styles.root}><ScreenHeader title="Profiles" />
    <FlatList data={watching} keyExtractor={row => row.episodeId ?? row.titleId} renderItem={renderProgress} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={5} contentContainerStyle={styles.content}
      ListHeaderComponent={<>
        <View style={styles.profileCard}><Avatar profile={activeProfile} size={64} radius={18} /><View style={{ flex: 1, marginLeft: 18 }}><Txt size={12} color={colors.textMuted}>YOUR SPACE</Txt><Txt weight="bold" size={24} style={{ marginTop: 4 }}>{activeProfile.name}</Txt><Txt size={12} color={colors.textMuted} style={{ marginTop: 5 }}>{profiles.length} local {profiles.length === 1 ? 'profile' : 'profiles'} · No account required</Txt></View></View>
        {state.hydrationError ? <View style={styles.notice}><Txt size={13} color={colors.textMuted}>{state.hydrationError}</Txt></View> : null}
        <View style={styles.menu}>
          <MenuItem icon="people-outline" label="Manage Profiles" detail="Separate lists, progress, and downloads" onPress={() => nav.navigate('ManageProfiles')} />
          <MenuItem icon="bookmark-outline" label="My List" detail={`${profileData.myList.length} saved titles`} onPress={() => nav.navigate('MyList')} />
          <MenuItem icon="download-outline" label="Downloads" detail={`${profileData.downloads.filter(row => row.status === 'downloaded').length} completed files`} onPress={() => nav.navigate('Downloads')} />
          <MenuItem icon="extension-puzzle-outline" label="Engines & Providers" detail="BDIX · Nuvio · Cloudstream" onPress={() => nav.navigate('Providers')} />
          <MenuItem icon="tv-outline" label="Live TV" detail="Separate channel directory" onPress={() => nav.navigate('LiveTv')} />
          <MenuItem icon="lock-closed-outline" label="Restricted Content" detail="Disabled until authorized sources are approved" onPress={() => nav.navigate('AdultContent')} />
          <MenuItem icon="swap-horizontal-outline" label="Import & Export" detail="Portable local profile data, without credentials" onPress={() => nav.navigate('ImportExport')} />
          <MenuItem icon="settings-outline" label="Settings" onPress={() => nav.navigate('AppSettings')} />
          <MenuItem icon="information-circle-outline" label="About Cinetor" onPress={() => nav.navigate('About')} />
        </View>
        <View style={styles.section}><Txt weight="bold" size={20}>Continue Watching</Txt><Txt size={13} color={colors.textMuted} style={{ marginTop: 5 }}>Only your unfinished movies and exact episodes.</Txt></View>
      </>}
      ListEmptyComponent={<View style={styles.empty}><Ionicons name="play-circle-outline" size={34} color={colors.textMuted} /><Txt size={14} color={colors.textMuted} style={{ marginTop: 12 }}>Your next watch starts here.</Txt><Txt size={12} color={colors.textMuted} align="center" style={{ marginTop: 5 }}>Playback progress appears after you watch a video. Catalog tabs never show your history.</Txt></View>} />
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, content: { paddingHorizontal: 16, paddingBottom: 40, maxWidth: 840, width: '100%', alignSelf: 'center' },
  profileCard: { flexDirection: 'row', alignItems: 'center', padding: 20, marginTop: 12, marginBottom: 20, borderRadius: 20, backgroundColor: colors.surface2 },
  menu: { borderWidth: 1, borderColor: colors.surface4, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surface1 },
  menuItem: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surface4 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  section: { marginTop: 30, marginBottom: 14 }, progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, backgroundColor: colors.surface1, borderRadius: radius.xl },
  progressAction: { flex: 1, flexDirection: 'row', gap: 12, padding: 12, alignItems: 'center', minHeight: 112 }, thumbnail: { width: 58, height: 86, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center', borderRadius: 8, overflow: 'hidden' },
  progressTrack: { height: 3, backgroundColor: colors.surface4, marginTop: 10, overflow: 'hidden', borderRadius: 2 }, progressFill: { height: 3, backgroundColor: colors.red }, remove: { width: 48, minHeight: 64, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', padding: 24, backgroundColor: colors.surface1, borderRadius: 18 }, notice: { backgroundColor: colors.surface3, padding: 16, borderRadius: 12, marginBottom: 16 },
});
