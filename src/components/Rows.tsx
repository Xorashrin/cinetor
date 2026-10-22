import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { memo, useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View, type ListRenderItem } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';

import type { AdultChannel } from '../data/adultChannels';
import type { Channel } from '../data/channels';
import { img } from '../data/images';
import type { Title } from '../data/mock';
import type { ProgressEntry } from '../state/AppState';
import { colors, font, layout, radius } from '../theme/tokens';
import { ProgressBar } from './Buttons';
import { ChannelLogo } from './ChannelLogo';
import { POSTER, Poster } from './Poster';
import { Txt } from './Txt';

const GAP = 8;

const listProps = {
  horizontal: true,
  showsHorizontalScrollIndicator: false,
  initialNumToRender: 5,
  maxToRenderPerBatch: 5,
  windowSize: 5,
  removeClippedSubviews: true,
  contentContainerStyle: { paddingHorizontal: layout.gutter },
  ItemSeparatorComponent: () => <View style={{ width: GAP }} />,
} as const;

export function RowHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <View style={styles.header}>
      <Txt weight="bold" size={17} numberOfLines={1} style={styles.headerTitle}>
        {title}
      </Txt>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={8} style={styles.seeAll}>
          <Txt weight="medium" size={13} color={colors.textMuted}>
            See All
          </Txt>
          <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

interface PosterRowProps {
  title: string;
  items: Title[];
  onPressTitle: (t: Title) => void;
  width?: number;
  height?: number;
  onSeeAll?: () => void;
}

export const PosterRow = memo(function PosterRow({ title, items, onPressTitle, width = POSTER.width, height = POSTER.height, onSeeAll }: PosterRowProps) {
  const renderItem = useCallback<ListRenderItem<Title>>(
    ({ item }) => <Poster title={item} width={width} height={height} onPress={onPressTitle} />,
    [width, height, onPressTitle],
  );
  return (
    <View style={styles.row}>
      <RowHeader title={title} onSeeAll={onSeeAll} />
      <FlatList
        {...listProps}
        data={items}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: width + GAP, offset: (width + GAP) * index, index })}
      />
    </View>
  );
});

function RankNumber({ rank, height }: { rank: number; height: number }) {
  const w = rank === 10 ? 104 : 64;
  return (
    <Svg width={w} height={height}>
      <SvgText
        x={w - 2}
        y={height - 2}
        fontSize={height * 0.98}
        fontFamily={font.display}
        textAnchor="end"
        fill={colors.bg}
        stroke="#8C8C8C"
        strokeWidth={3}
      >
        {String(rank)}
      </SvgText>
    </Svg>
  );
}

const TOP10_OVERLAP = 14;
const top10Width = (rank: number) => (rank === 10 ? 104 : 64) - TOP10_OVERLAP + POSTER.width;

export const Top10Row = memo(function Top10Row({ title, items, onPressTitle }: { title: string; items: Title[]; onPressTitle: (t: Title) => void }) {
  const renderItem = useCallback<ListRenderItem<Title>>(
    ({ item, index }) => (
      <View style={styles.top10Item}>
        <RankNumber rank={index + 1} height={POSTER.height} />
        <View style={{ marginLeft: -TOP10_OVERLAP }}>
          <Poster title={item} onPress={onPressTitle} showBadges={false} />
        </View>
      </View>
    ),
    [onPressTitle],
  );
  return (
    <View style={styles.row}>
      <RowHeader title={title} />
      <FlatList
        {...listProps}
        data={items.slice(0, 10)}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        getItemLayout={(_, index) => {
          let offset = 0;
          for (let i = 0; i < index; i++) offset += top10Width(i + 1) + GAP;
          return { length: top10Width(index + 1) + GAP, offset, index };
        }}
      />
    </View>
  );
});

export interface ContinueItem {
  title: Title;
  entry: ProgressEntry;
  label?: string;
}

interface ContinueRowProps {
  title: string;
  items: ContinueItem[];
  onPlay: (item: ContinueItem) => void;
  onInfo: (t: Title) => void;
  onMore: (item: ContinueItem) => void;
}

const CONTINUE_IMAGE_HEIGHT = 150;

export const ContinueRow = memo(function ContinueRow({ title, items, onPlay, onInfo, onMore }: ContinueRowProps) {
  const renderItem = useCallback<ListRenderItem<ContinueItem>>(
    ({ item }) => (
      <View style={styles.continueCard}>
        <Pressable onPress={() => onPlay(item)} style={styles.continueImage}>
          <Image source={img.poster(item.title.seed)} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={item.title.id} />
          <View style={styles.playCircle}>
            <Ionicons name="play" size={22} color={colors.text} style={{ marginLeft: 3 }} />
          </View>
          {item.label ? (
            <View style={styles.continueLabel}>
              <Txt weight="semibold" size={11} numberOfLines={1}>
                {item.label}
              </Txt>
            </View>
          ) : null}
        </Pressable>
        <ProgressBar value={item.entry.position / Math.max(1, item.entry.duration)} height={2} track={colors.surface5} style={{ borderRadius: 0 }} />
        <View style={styles.continueBar}>
          <Pressable onPress={() => onInfo(item.title)} hitSlop={8}>
            <Ionicons name="information-circle-outline" size={22} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => onMore(item)} hitSlop={8}>
            <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>
    ),
    [onPlay, onInfo, onMore],
  );
  return (
    <View style={styles.row}>
      <RowHeader title={title} />
      <FlatList
        {...listProps}
        data={items}
        keyExtractor={(i) => i.title.id}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: POSTER.width + GAP, offset: (POSTER.width + GAP) * index, index })}
      />
    </View>
  );
});

export interface ChannelRowProps {
  title: string;
  items: Channel[];
  onPressChannel: (channel: Channel) => void;
  onSeeAll?: () => void;
}

export const ChannelRow = memo(function ChannelRow({
  title,
  items,
  onPressChannel,
  onSeeAll,
}: ChannelRowProps) {
  const renderItem = useCallback<ListRenderItem<Channel>>(
    ({ item }) => (
      <Pressable
        onPress={() => onPressChannel(item)}
        style={({ pressed }) => [{ width: 130, opacity: pressed ? 0.7 : 1 }]}
      >
        <ChannelLogo channel={item} size={130} />
        <Txt weight="semibold" size={12} numberOfLines={1} style={{ marginTop: 6 }}>
          {item.name}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red }} />
          <Txt size={10} color={colors.textDim} numberOfLines={1}>
            {item.category}
          </Txt>
        </View>
      </Pressable>
    ),
    [onPressChannel],
  );

  return (
    <View style={styles.row}>
      <RowHeader title={title} onSeeAll={onSeeAll} />
      <FlatList
        {...listProps}
        data={items}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: 130 + GAP, offset: (130 + GAP) * index, index })}
      />
    </View>
  );
});

export interface AdultChannelRowProps {
  title: string;
  items: AdultChannel[];
  onPressChannel: (channel: AdultChannel) => void;
  onSeeAll?: () => void;
}

export const AdultChannelRow = memo(function AdultChannelRow({
  title,
  items,
  onPressChannel,
  onSeeAll,
}: AdultChannelRowProps) {
  const renderItem = useCallback<ListRenderItem<AdultChannel>>(
    ({ item }) => (
      <Pressable
        onPress={() => onPressChannel(item)}
        style={({ pressed }) => [styles.adultCard, pressed && { opacity: 0.8 }]}
      >
        <View style={styles.adultBadge}>
          <Txt weight="black" size={10} color={colors.text}>
            18+
          </Txt>
        </View>
        <Ionicons name="flame" size={28} color={colors.red} style={{ marginBottom: 4 }} />
        <Txt weight="bold" size={12} numberOfLines={1} align="center">
          {item.name}
        </Txt>
        <Txt size={10} color={colors.textDim} numberOfLines={1} align="center" style={{ marginTop: 2 }}>
          {item.category}
        </Txt>
      </Pressable>
    ),
    [onPressChannel],
  );

  return (
    <View style={styles.row}>
      <RowHeader title={title} onSeeAll={onSeeAll} />
      <FlatList
        {...listProps}
        data={items}
        keyExtractor={(c) => c.id}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: 140 + GAP, offset: (140 + GAP) * index, index })}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  row: { marginTop: 22 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
    marginBottom: 10,
  },
  headerTitle: { flex: 1 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  top10Item: { flexDirection: 'row', alignItems: 'flex-end' },
  continueCard: { width: POSTER.width, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface1 },
  continueImage: { height: CONTINUE_IMAGE_HEIGHT, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  playCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.text,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueLabel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  continueBar: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  adultCard: {
    width: 140,
    height: 100,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(229,9,20,0.35)',
  },
  adultBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: colors.red,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
});
