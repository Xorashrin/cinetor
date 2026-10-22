import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { img } from '../data/images';
import { top10Rank, type Title } from '../data/mock';
import { colors, radius } from '../theme/tokens';
import { MLogo } from './Logo';
import { Txt } from './Txt';

export const POSTER = { width: 110, height: 160 } as const;
export const TALL_POSTER = { width: 146, height: 256 } as const;

const BADGE_LABEL = {
  'new-episode': 'New Episode',
  'new-season': 'New Season',
  'recently-added': 'Recently Added',
  'leaving-soon': 'Leaving Soon',
} as const;

interface PosterProps {
  title: Title;
  width?: number;
  height?: number;
  onPress?: (title: Title) => void;
  showBadges?: boolean;
}

export const Poster = memo(function Poster({ title, width = POSTER.width, height = POSTER.height, onPress, showBadges = true }: PosterProps) {
  const rank = showBadges ? top10Rank(title.id) : null;
  const titleSize = Math.max(14, Math.round(width / 5.2));
  return (
    <Pressable
      onPress={onPress ? () => onPress(title) : undefined}
      style={({ pressed }) => [styles.frame, { width, height, opacity: pressed ? 0.85 : 1 }]}
    >
      <Image source={title.posterUrl ? { uri: title.posterUrl } : img.poster(title.seed)} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" recyclingKey={title.id} />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.9)']} locations={[0.35, 0.6, 1]} style={StyleSheet.absoluteFill} />
      {title.original ? (
        <View style={styles.logo}>
          <MLogo size={Math.max(14, width / 7)} />
        </View>
      ) : null}
      {rank && rank.rank <= 10 ? (
        <View style={styles.top10}>
          <Txt weight="black" size={7} lineHeight={8} align="center">
            TOP
          </Txt>
          <Txt weight="black" size={11} lineHeight={12} align="center">
            10
          </Txt>
        </View>
      ) : null}
      <View style={[styles.titleWrap, { bottom: showBadges && title.badge ? 24 : 8 }]}>
        <Txt weight="display" size={titleSize} lineHeight={titleSize * 0.95} align="center" numberOfLines={2} spacing={0.5}>
          {title.name.toUpperCase()}
        </Txt>
      </View>
      {showBadges && title.badge ? (
        <View style={styles.badge}>
          <Txt weight="bold" size={10} align="center" numberOfLines={1}>
            {BADGE_LABEL[title.badge]}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  frame: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface2 },
  logo: { position: 'absolute', top: 6, left: 6 },
  top10: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 22,
    height: 28,
    backgroundColor: colors.red,
    justifyContent: 'center',
    borderBottomLeftRadius: 2,
  },
  titleWrap: { position: 'absolute', left: 6, right: 6 },
  badge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    backgroundColor: colors.red,
  },
});
