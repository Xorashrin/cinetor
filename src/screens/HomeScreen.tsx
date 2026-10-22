import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Billboard } from '../components/Billboard';
import { Chip } from '../components/Chip';
import { SheetItem } from '../components/ListItems';
import { MLogo, Wordmark } from '../components/Logo';
import { AdultChannelRow, ChannelRow, PosterRow, Top10Row, type ContinueItem } from '../components/Rows';
import { HeaderActions } from '../components/ScreenHeader';
import { Sheet } from '../components/Sheet';
import { Txt } from '../components/Txt';
import { ADULT_CHANNELS } from '../data/adultChannels';
import { CHANNELS } from '../data/channels';
import { AVAILABLE, TOP10_MOVIES, TOP10_TV, getTitle, type Title } from '../data/mock';
import { useRootNav, type TabParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, layout, radius } from '../theme/tokens';

type Props = BottomTabScreenProps<TabParamList, 'Home'>;
type HomeFilter = 'all' | 'tv' | 'movies';

export default function HomeScreen({ route, navigation }: Props) {
  const nav = useRootNav();
  const insets = useSafeAreaInsets();
  const { activeProfile, profileData, toggleMyList, rate, removeProgress, showToast, catalogVersion } = useApp();
  const [filter, setFilter] = useState<HomeFilter>('all');
  const [menuItem, setMenuItem] = useState<ContinueItem | null>(null);
  const genre = route.params?.genre;
  const name = activeProfile?.name ?? 'User';

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

  const openTitle = useCallback((t: Title) => nav.navigate('Title', { id: t.id }), [nav]);

  const pool = useMemo(
    () =>
      AVAILABLE.filter(
        (t) => (filter === 'all' || (filter === 'tv' ? t.kind === 'series' : t.kind === 'movie')) && (!genre || t.genres.includes(genre)),
      ),
    [filter, genre, catalogVersion],
  );

  const hero = pool[0];
  const inMyList = hero ? profileData.myList.includes(hero.id) : false;

  const showChannels = CHANNELS.length > 0 && (filter === 'all' || filter === 'tv' || genre === 'Live TV');
  const showAdultChannels = ADULT_CHANNELS.length > 0 && genre === 'Adult (18+)';

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
            {TOP10_TV.length > 0 && !genre ? <Top10Row title="Top 10 Today" items={TOP10_TV} onPressTitle={openTitle} /> : null}
            {pool.length > 1 ? <PosterRow title={genre ? `${genre} Content` : 'Trending Now'} items={pool.slice(1)} onPressTitle={openTitle} /> : null}
            {showChannels ? (
              <ChannelRow
                title="Live TV Channels"
                items={CHANNELS.slice(0, 15)}
                onPressChannel={(c) => nav.navigate('Live', { channelId: c.id })}
                onSeeAll={() => nav.navigate('LiveTv')}
              />
            ) : null}
            {showAdultChannels ? (
              <AdultChannelRow
                title="Adult Streams (18+)"
                items={ADULT_CHANNELS}
                onPressChannel={(c) => nav.navigate('Live', { channelId: c.id })}
                onSeeAll={() => nav.navigate('LiveTv')}
              />
            ) : null}
          </>
        ) : (
          <View style={styles.emptyContainer}>
            {showChannels ? (
              <View style={{ width: '100%', marginBottom: 20 }}>
                <ChannelRow
                  title="Live TV Channels"
                  items={CHANNELS.slice(0, 15)}
                  onPressChannel={(c) => nav.navigate('Live', { channelId: c.id })}
                  onSeeAll={() => nav.navigate('LiveTv')}
                />
              </View>
            ) : null}

            {showAdultChannels ? (
              <View style={{ width: '100%', marginBottom: 20 }}>
                <AdultChannelRow
                  title="Adult Streams (18+)"
                  items={ADULT_CHANNELS}
                  onPressChannel={(c) => nav.navigate('Live', { channelId: c.id })}
                  onSeeAll={() => nav.navigate('LiveTv')}
                />
              </View>
            ) : null}

            {!showChannels && !showAdultChannels ? (
              <>
                <View style={styles.logoWrap}>
                  <MLogo size={54} />
                  <View style={{ marginTop: 12 }}>
                    <Wordmark size={30} />
                  </View>
                </View>
                <Txt weight="bold" size={20} align="center" style={{ marginTop: 18 }}>
                  Welcome, {name}
                </Txt>
                <Txt size={13} color={colors.textDim} align="center" style={styles.emptySubtitle}>
                  Clean and blank stream template ready. No mock data or external APIs are connected.
                </Txt>
              </>
            ) : null}

            <View style={styles.actionGrid}>
              <Pressable
                onPress={() => nav.navigate('LiveTv')}
                style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="tv-outline" size={22} color={colors.red} />
                <Txt weight="bold" size={14} style={{ marginTop: 8 }}>
                  Live TV
                </Txt>
                <Txt size={11} color={colors.textDim} align="center" style={{ marginTop: 2 }}>
                  Channels & Streams
                </Txt>
              </Pressable>

              <Pressable
                onPress={() => nav.navigate('Search')}
                style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="search" size={22} color={colors.red} />
                <Txt weight="bold" size={14} style={{ marginTop: 8 }}>
                  Search Catalog
                </Txt>
                <Txt size={11} color={colors.textDim} align="center" style={{ marginTop: 2 }}>
                  Find titles & channels
                </Txt>
              </Pressable>

              <Pressable
                onPress={() => nav.navigate('AppSettings')}
                style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="settings-outline" size={22} color={colors.blue} />
                <Txt weight="bold" size={14} style={{ marginTop: 8 }}>
                  Settings
                </Txt>
                <Txt size={11} color={colors.textDim} align="center" style={{ marginTop: 2 }}>
                  Storage & sources
                </Txt>
              </Pressable>
            </View>
          </View>
        )}
      </Animated.ScrollView>

      {/* Persistent floating header */}
      <View style={[styles.header, { height: headerTop + layout.chipRowHeight }]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, headerBgStyle]} />
        <View style={[styles.headerRow, { marginTop: insets.top }]}>
          <Wordmark size={24} />
          <HeaderActions actions={['search', 'notifications']} />
        </View>
        <View style={styles.chips}>
          <Chip label="All" selected={filter === 'all' && !genre} onPress={() => { setFilter('all'); navigation.setParams({ genre: undefined }); }} />
          <Chip label="TV Shows" selected={filter === 'tv'} onPress={() => setFilter('tv')} />
          <Chip label="Movies" selected={filter === 'movies'} onPress={() => setFilter('movies')} />
          <Chip label="Categories" caret selected={!!genre} onPress={() => nav.navigate('Categories', { current: genre, targetTab: 'Home' })} />
        </View>
      </View>

      <Sheet visible={menuItem !== null} onClose={() => setMenuItem(null)}>
        {menuItem ? (
          <>
            <Txt weight="bold" size={16} style={styles.sheetTitle} numberOfLines={1}>
              {menuItem.title.name}
            </Txt>
            <SheetItem label="Episodes & Info" icon="information-circle-outline" onPress={() => { setMenuItem(null); openTitle(menuItem.title); }} />
            <SheetItem label="Remove From Row" icon="close-circle-outline" destructive onPress={() => { removeProgress(menuItem.title.id); setMenuItem(null); showToast('Removed'); }} />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  headerRow: { height: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: layout.gutter + 4 },
  chips: { height: layout.chipRowHeight, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: layout.gutter + 4 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingTop: 40 },
  logoWrap: { alignItems: 'center', justifyContent: 'center' },
  emptySubtitle: { marginTop: 8, maxWidth: 320, lineHeight: 18 },
  actionGrid: { flexDirection: 'row', gap: 12, marginTop: 28, width: '100%', maxWidth: 360 },
  actionCard: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sheetTitle: { paddingHorizontal: 20, paddingVertical: 10 },
});
