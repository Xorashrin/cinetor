import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../components/Buttons';
import { ChannelLogo } from '../components/ChannelLogo';
import { Chip } from '../components/Chip';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { CHANNEL_FILTERS, filterChannels } from '../data/channels';
import { initializeEngine, refreshLiveDirectory } from '../engine/runtime';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'LiveTv'>;
export default function LiveTvScreen({ navigation }: Props) {
  const { catalogVersion } = useApp();
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);
  const refresh = () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(undefined);
    void refreshLiveDirectory(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError('The directory could not be refreshed. Saved channel entries remain available.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  };
  useEffect(() => { void initializeEngine(); return () => request.current?.abort(); }, []);
  const channels = useMemo(() => {
    const terms = query.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return filterChannels(filter).filter(channel => terms.every(term => `${channel.name} ${channel.category} ${channel.country}`.normalize('NFKC').toLowerCase().includes(term)));
  }, [query, filter, catalogVersion]);
  return <View style={styles.root}><ScreenHeader title="Live TV" back /><FlatList data={channels} keyExtractor={row => row.id} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7} contentContainerStyle={styles.content} refreshing={loading} onRefresh={refresh}
    ListHeaderComponent={<><Txt weight="bold" size={24}>A separate live directory.</Txt><Txt style={styles.space} color={colors.textMuted} size={14}>Channel listings are unverified candidates, not a promise of access or a live signal. Movie and series searches never include this directory.</Txt><TextInput accessibilityLabel="Search live channels" placeholder="Search channels in this directory" placeholderTextColor={colors.textDim} value={query} onChangeText={setQuery} maxLength={200} autoCorrect={false} style={styles.input} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{CHANNEL_FILTERS.map(value => <Chip key={value} label={value} selected={filter === value} onPress={() => setFilter(value)} />)}</ScrollView><Button label={loading ? 'Refreshing…' : 'Refresh live directory'} variant="secondary" disabled={loading} onPress={refresh} />{error ? <Txt accessibilityRole="alert" color={colors.warning} style={styles.space}>{error}</Txt> : null}<Txt color={colors.textDim} size={12} style={styles.count}>{channels.length} listed channels · sources checked on request</Txt></>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}. Check live source.`} onPress={() => navigation.navigate('Live', { channelId: item.id, filter })} style={({ pressed }) => [styles.channel, pressed && { backgroundColor: colors.surface2 }]}><ChannelLogo channel={item} size={64} /><View style={{ flex: 1 }}><Txt weight="semibold" size={16}>{item.name}</Txt><Txt size={12} color={colors.textMuted} style={{ marginTop: 4 }}>{[item.country, item.category].filter(Boolean).join(' · ')}</Txt><Txt size={12} color={colors.textDim} style={{ marginTop: 4 }}>Source unverified</Txt></View><Ionicons name="arrow-forward" size={20} color={colors.accent} /></Pressable>}
    ListEmptyComponent={<View style={styles.empty}><Txt weight="bold">No matching channel entries</Txt><Txt color={colors.textMuted} size={13} style={styles.space}>Refresh the directory or change your channel filter. No restricted-content feed is enabled.</Txt></View>} /></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 16, paddingBottom: 40, maxWidth: 840, alignSelf: 'center', width: '100%' }, space: { marginTop: 12 }, input: { minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, color: colors.text, paddingHorizontal: 14, fontSize: 15, marginTop: 20 }, filters: { gap: 8, paddingVertical: 14 }, count: { marginTop: 20, marginBottom: 12 }, channel: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 14, minHeight: 100, backgroundColor: colors.surface1, borderRadius: 16, marginBottom: 10 }, empty: { padding: 24, borderRadius: 16, backgroundColor: colors.surface1 } });
