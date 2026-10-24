import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, IconButton } from '../components/Buttons';
import { CatalogArtwork, titleMetadata } from '../components/CatalogRow';
import { Chip } from '../components/Chip';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { getTitle } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'MyList'>;
type Filter = 'All' | 'Movies' | 'Series' | 'Started' | 'Not started';
type Sort = 'Date added' | 'A–Z' | 'Release year';
export default function MyListScreen({ navigation }: Props) {
  const { profileData, activeProfile, catalogVersion, toggleMyList } = useApp();
  const [filter, setFilter] = useState<Filter>('All');
  const [sort, setSort] = useState<Sort>('Date added');
  const items = useMemo(() => {
    const result = profileData.myList.map(id => ({ id, title: getTitle(id), started: profileData.progress.some(row => row.titleId === id && row.position > 0) })).filter(row => filter === 'All' || filter === 'Movies' && row.id.startsWith('tmdb:movie:') || filter === 'Series' && row.id.startsWith('tmdb:tv:') || filter === 'Started' && row.started || filter === 'Not started' && !row.started);
    if (sort === 'A–Z') result.sort((a, b) => (a.title.id === 'empty' ? a.id : a.title.name).localeCompare(b.title.id === 'empty' ? b.id : b.title.name));
    if (sort === 'Release year') result.sort((a, b) => b.title.year - a.title.year);
    return result;
  }, [profileData, filter, sort, catalogVersion]);
  return <View style={styles.root}><ScreenHeader title="My List" back /><FlatList data={items} keyExtractor={row => row.id} initialNumToRender={10} windowSize={7} contentContainerStyle={styles.content}
    ListHeaderComponent={<><Txt weight="bold" size={24}>Saved by {activeProfile.name}</Txt><Txt color={colors.textMuted} size={13} style={styles.space}>Your saved metadata. Source availability is checked separately.</Txt><ScrollView horizontal contentContainerStyle={styles.filters} showsHorizontalScrollIndicator={false}>{(['All', 'Movies', 'Series', 'Started', 'Not started'] as Filter[]).map(value => <Chip key={value} label={value} selected={filter === value} onPress={() => setFilter(value)} />)}</ScrollView><ScrollView horizontal contentContainerStyle={styles.filters} showsHorizontalScrollIndicator={false}>{(['Date added', 'A–Z', 'Release year'] as Sort[]).map(value => <Chip key={value} label={value} selected={sort === value} onPress={() => setSort(value)} />)}</ScrollView></>}
    renderItem={({ item }) => <View style={styles.row}><Pressable accessibilityRole="button" accessibilityLabel={item.title.id === 'empty' ? `Load metadata for ${item.id}` : `Open ${item.title.name}`} style={styles.open} onPress={() => navigation.navigate('Title', { id: item.id })}><CatalogArtwork uri={item.title.posterUrl} identity={item.id} style={styles.poster} /><View style={{ flex: 1 }}><Txt weight="semibold" size={16}>{item.title.id === 'empty' ? item.id : item.title.name}</Txt><Txt color={colors.textMuted} size={12} style={styles.space}>{item.title.id === 'empty' ? 'Metadata not cached · tap to load' : titleMetadata(item.title)}</Txt>{item.started ? <Txt color={colors.textDim} size={12} style={styles.space}>Watch progress saved</Txt> : null}</View></Pressable><IconButton icon="close" accessibilityLabel={`Remove ${item.title.id === 'empty' ? item.id : item.title.name} from My List`} onPress={() => toggleMyList(item.id)} /></View>}
    ListEmptyComponent={<View style={styles.empty}><Txt weight="bold" size={19}>{profileData.myList.length ? 'No matches for this filter' : 'Your list is empty'}</Txt><Txt color={colors.textMuted} size={14} style={styles.space}>Save titles from their details page to find them here.</Txt><Button label="Browse Home" variant="secondary" style={styles.space} onPress={() => navigation.navigate('Main', { screen: 'Home' })} /></View>} /></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 16, paddingBottom: 40, maxWidth: 840, width: '100%', alignSelf: 'center' }, space: { marginTop: 10 }, filters: { gap: 8, paddingVertical: 8 }, row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface1, borderRadius: 16, marginTop: 12, paddingRight: 8 }, open: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 14, minHeight: 118 }, poster: { width: 60, height: 90 }, empty: { marginTop: 24, padding: 24, backgroundColor: colors.surface1, borderRadius: 16 } });
