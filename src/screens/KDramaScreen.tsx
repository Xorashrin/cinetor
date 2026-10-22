import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Billboard } from '../components/Billboard';
import { Chip } from '../components/Chip';
import { PosterRow } from '../components/Rows';
import { HeaderActions } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { AVAILABLE, type Title } from '../data/mock';
import { useRootNav, type TabParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, layout, radius } from '../theme/tokens';

type Props = BottomTabScreenProps<TabParamList, 'KDrama'>;

const KDRAMA_FILTERS = ['All', 'Romance', 'Thriller', 'Mystery', 'Comedy', 'Drama'];

export default function KDramaScreen({ route, navigation }: Props) {
  const nav = useRootNav();
  const insets = useSafeAreaInsets();
  const { profileData, toggleMyList, showToast } = useApp();
  const [selectedFilter, setSelectedFilter] = useState('All');
  const genre = route.params?.genre;

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const headerTop = insets.top + layout.headerHeight;
  const headerBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 80], [0, 0.98], Extrapolation.CLAMP),
  }));

  const kdramaList = useMemo(() => {
    return AVAILABLE.filter((t) => {
      const isKDrama = t.genres.includes('K-Drama');
      if (selectedFilter === 'All') return isKDrama;
      return isKDrama && t.genres.includes(selectedFilter);
    });
  }, [selectedFilter]);

  const openTitle = useCallback((t: Title) => nav.navigate('Title', { id: t.id }), [nav]);

  const hero = kdramaList[0];
  const inMyList = hero ? profileData.myList.includes(hero.id) : false;

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: headerTop + layout.chipRowHeight + 12, paddingBottom: 40 }}
        removeClippedSubviews
      >
        {hero ? (
          <>
            <Billboard
              title={hero}
              inMyList={inMyList}
              onOpen={() => openTitle(hero)}
              onPlay={() => nav.navigate('Player', { id: hero.id })}
              onToggleList={() => {
                toggleMyList(hero.id);
                showToast(inMyList ? 'Removed from My List' : 'Added to My List');
              }}
            />
            {kdramaList.length > 1 ? <PosterRow title="Trending K-Dramas" items={kdramaList.slice(1)} onPressTitle={openTitle} /> : null}
          </>
        ) : (
          <View style={styles.emptyContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="heart" size={32} color={colors.red} />
            </View>
            <Txt weight="bold" size={20} align="center" style={{ marginTop: 16 }}>
              K-Drama Lounge
            </Txt>
            <Txt size={13} color={colors.textDim} align="center" style={styles.emptySubtitle}>
              Clean K-Drama screen ready. Stream Korean romantic comedies, thrillers, and classics.
            </Txt>
            <Pressable
              onPress={() => nav.navigate('Search')}
              style={({ pressed }) => [styles.searchBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="search" size={18} color={colors.text} />
              <Txt weight="bold" size={14} style={{ marginLeft: 8 }}>
                Search K-Dramas
              </Txt>
            </Pressable>
          </View>
        )}
      </Animated.ScrollView>

      <View style={[styles.header, { height: headerTop + layout.chipRowHeight }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, headerBgStyle]} />
        <View style={[styles.headerRow, { marginTop: insets.top }]}>
          <Txt weight="bold" size={22}>
            K-Drama
          </Txt>
          <HeaderActions actions={['search', 'notifications']} />
        </View>
        <View style={styles.chips}>
          {KDRAMA_FILTERS.map((f) => (
            <Chip
              key={f}
              label={f}
              selected={selectedFilter === f && !genre}
              onPress={() => setSelectedFilter(f)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  headerRow: { height: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.gutter + 4 },
  chips: { height: layout.chipRowHeight, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: layout.gutter + 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingTop: 60 },
  iconCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  emptySubtitle: { marginTop: 8, maxWidth: 300, lineHeight: 18 },
  searchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface3,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: 24,
  },
});
