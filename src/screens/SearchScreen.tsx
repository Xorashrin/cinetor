import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, TextInput, View, useWindowDimensions, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChannelLogo } from '../components/ChannelLogo';
import { Poster } from '../components/Poster';
import { Txt } from '../components/Txt';
import { img } from '../data/images';
import { searchChannels } from '../data/channels';
import { AVAILABLE, type Title } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, font, radius } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;

export default function SearchScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { showToast, catalogVersion } = useApp();
  const [query, setQuery] = useState('');
  // Typing stays responsive; result rendering runs at a lower priority.
  const deferred = useDeferredValue(query);

  const index = useMemo(
    () =>
      AVAILABLE.filter((t) => t.maturity !== '18+' && !t.genres.includes('Adult (18+)')).map((t) => ({
        title: t,
        haystack: [t.name, ...t.genres, ...t.cast, ...t.moods, ...t.creators].join('|').toLowerCase(),
      })),
    [catalogVersion],
  );

  const results = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    return index
      .filter((e) => terms.every((term) => e.haystack.includes(term)))
      .sort((a, b) => Number(b.title.name.toLowerCase().startsWith(q)) - Number(a.title.name.toLowerCase().startsWith(q)))
      .map((e) => e.title);
  }, [deferred, index]);

  const channels = useMemo(() => searchChannels(deferred, 12), [deferred]);
  const hasQuery = deferred.trim().length > 0;
  const cell = Math.floor((width - 24 - 16) / 3);

  const open = useCallback(
    (t: Title) => {
      Keyboard.dismiss();
      navigation.navigate('Title', { id: t.id });
    },
    [navigation],
  );

  const renderRecommended = useCallback<ListRenderItem<Title>>(
    ({ item }) => (
      <Pressable onPress={() => open(item)} style={({ pressed }) => [styles.recRow, pressed ? { backgroundColor: colors.surface2 } : null]}>
        <View style={styles.recThumb}>
          <Image source={item.backdropUrl ? { uri: item.backdropUrl } : item.posterUrl ? { uri: item.posterUrl } : img.backdrop(item.seed)} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.id} />
        </View>
        <Txt weight="medium" size={14} numberOfLines={2} style={styles.recTitle}>
          {item.name}
        </Txt>
        <Pressable hitSlop={10} onPress={() => navigation.navigate('Player', { id: item.id })}>
          <Ionicons name="play-circle-outline" size={34} color={colors.text} />
        </Pressable>
      </Pressable>
    ),
    [open, navigation],
  );

  const renderResult = useCallback<ListRenderItem<Title>>(
    ({ item }) => <Poster title={item} width={cell} height={Math.round(cell * 1.45)} onPress={open} />,
    [cell, open],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.top}>
        <Pressable hitSlop={10} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.textDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          placeholder="Search shows, movies, genres, people…"
          placeholderTextColor={colors.textDim}
          selectionColor={colors.text}
          style={styles.input}
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
        />
        {query.length > 0 ? (
          <Pressable hitSlop={8} onPress={() => setQuery('')}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Pressable hitSlop={8} onPress={() => showToast('Voice search is not part of this demo')}>
            <Ionicons name="mic" size={20} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      {!hasQuery ? (
        <FlatList
          key="recommended"
          data={AVAILABLE}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={10}
          windowSize={7}
          ListHeaderComponent={
            AVAILABLE.length > 0 ? (
              <Txt weight="bold" size={18} style={styles.section}>
                Recommended TV Shows & Movies
              </Txt>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Txt size={14} color={colors.textDim} align="center">
                Type in the search box to find shows, movies, and channels.
              </Txt>
            </View>
          }
          renderItem={renderRecommended}
        />
      ) : results.length === 0 && channels.length === 0 ? (
        <View key="empty" style={styles.empty}>
          <Txt weight="bold" size={20} align="center">
            Oh darn. We don't have that.
          </Txt>
          <Txt size={14} color={colors.textMuted} align="center" style={{ marginTop: 10 }}>
            Try searching for another movie, show, actor, director, or genre.
          </Txt>
        </View>
      ) : (
        <FlatList
          key="results-grid"
          data={results}
          keyExtractor={(t) => t.id}
          numColumns={3}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          initialNumToRender={12}
          ListHeaderComponent={
            <View>
              {channels.length > 0 ? (
                <>
                  <Txt weight="bold" size={18} style={styles.section}>
                    Live TV
                  </Txt>
                  <FlatList
                    horizontal
                    data={channels}
                    keyExtractor={(c) => c.id}
                    keyboardShouldPersistTaps="handled"
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.channelRow}
                    renderItem={({ item }) => (
                      <Pressable onPress={() => { Keyboard.dismiss(); navigation.navigate('Live', { channelId: item.id }); }} style={{ width: cell }}>
                        <ChannelLogo channel={item} size={cell} />
                        <Txt weight="medium" size={12} numberOfLines={1} style={{ marginTop: 6 }}>
                          {item.name}
                        </Txt>
                      </Pressable>
                    )}
                  />
                </>
              ) : null}
              {results.length > 0 ? (
                <Txt weight="bold" size={18} style={styles.section}>
                  Movies & TV
                </Txt>
              ) : null}
            </View>
          }
          renderItem={renderResult}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { height: 48, justifyContent: 'center', paddingHorizontal: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface5,
  },
  input: { flex: 1, color: colors.text, fontFamily: font.regular, fontSize: 15, marginHorizontal: 10, paddingVertical: 0 },
  section: { paddingHorizontal: 12, marginTop: 20, marginBottom: 10 },
  recRow: { height: 76, marginBottom: 8, flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  recThumb: { width: 140, height: 76, backgroundColor: colors.surface2, borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm, overflow: 'hidden' },
  recTitle: { flex: 1, marginHorizontal: 12 },
  empty: { paddingHorizontal: 32, paddingTop: 80 },
  grid: { gap: 8, paddingBottom: 30 },
  gridRow: { gap: 8, paddingHorizontal: 12 },
  channelRow: { gap: 8, paddingHorizontal: 12 },
});
