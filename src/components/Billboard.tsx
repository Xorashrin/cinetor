import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { memo } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { img } from '../data/images';
import type { Title } from '../data/mock';
import { colors, radius } from '../theme/tokens';
import { Button } from './Buttons';
import { MLogo } from './Logo';
import { Txt } from './Txt';

interface BillboardProps {
  title: Title;
  inMyList: boolean;
  onPlay: () => void;
  onToggleList: () => void;
  onOpen: () => void;
}

export const Billboard = memo(function Billboard({ title, inMyList, onPlay, onToggleList, onOpen }: BillboardProps) {
  const { width: screen } = useWindowDimensions();
  const width = screen - 32;
  const height = Math.round(width * 1.42);
  return (
    <Pressable onPress={onOpen} style={[styles.card, { width, height }]}>
      <Image source={title.backdropUrl ? { uri: title.backdropUrl } : title.posterUrl ? { uri: title.posterUrl } : img.hero(title.seed)} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} cachePolicy="memory-disk" />
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.92)']} locations={[0.4, 0.62, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.content}>
        {title.original ? (
          <View style={styles.kicker}>
            <MLogo size={16} />
            <Txt weight="bold" size={11} spacing={3} color={colors.textSoft} style={{ marginLeft: 6 }}>
              {title.kind === 'series' ? 'SERIES' : 'FILM'}
            </Txt>
          </View>
        ) : null}
        <Txt weight="display" size={58} lineHeight={56} align="center" numberOfLines={2} spacing={1}>
          {title.name.toUpperCase()}
        </Txt>
        <Txt weight="medium" size={13} color={colors.text90} align="center" style={styles.moods} numberOfLines={1}>
          {title.moods.join('  •  ')}
        </Txt>
        <View style={styles.buttons}>
          <Button label="Play" icon="play" variant="white" onPress={onPlay} style={styles.button} />
          <Button label="My List" icon={inMyList ? 'checkmark' : 'add'} variant="glass" onPress={onToggleList} style={styles.button} />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    alignSelf: 'center',
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  content: { position: 'absolute', left: 16, right: 16, bottom: 16, alignItems: 'center' },
  kicker: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  moods: { marginTop: 6, marginBottom: 14 },
  buttons: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  button: { flex: 1 },
});
