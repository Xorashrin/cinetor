import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { memo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import type { Title } from '../data/mock';
import { colors, radius } from '../theme/tokens';
import { Txt } from './Txt';

export function titleMetadata(title: Title): string {
  const fields = [title.kind === 'series' ? 'Series' : 'Movie'];
  if (typeof title.year === 'number' && Number.isFinite(title.year) && title.year > 0) fields.push(String(title.year));
  if (title.kind === 'movie' && typeof title.runtime === 'number' && Number.isFinite(title.runtime) && title.runtime > 0) {
    fields.push(`${Math.round(title.runtime)} min`);
  }
  return fields.join(' · ');
}

interface ArtworkProps {
  uri?: string | null;
  identity: string;
  style?: StyleProp<ViewStyle>;
}

/** Missing or failed artwork stays an app-owned, neutral image frame. */
export function CatalogArtwork({ uri, identity, style }: ArtworkProps) {
  const [failedUri, setFailedUri] = useState<string>();
  const sourceUri = typeof uri === 'string' && /^https:\/\//i.test(uri) ? uri : undefined;
  return (
    <View style={[styles.artwork, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Ionicons name="image-outline" size={26} color={colors.textDim} />
      {sourceUri && failedUri !== sourceUri ? (
        <Image
          source={{ uri: sourceUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${identity}:${sourceUri}`}
          transition={0}
          onError={() => setFailedUri(sourceUri)}
          accessible={false}
        />
      ) : null}
    </View>
  );
}

interface CatalogRowProps {
  title: Title;
  onPress: (title: Title) => void;
}

export const CatalogRow = memo(function CatalogRow({ title, onPress }: CatalogRowProps) {
  const { width, fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const compact = width < 380 || fontScale > 1.3;
  const metadata = titleMetadata(title);
  const genres = title.genres.filter(genre => genre.trim()).slice(0, 2).join(' · ');
  return (
    <Pressable
      onPress={() => onPress(title)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`${title.name}. ${metadata}${genres ? `. ${genres}` : ''}. Metadata only. Playback is not verified.`}
      accessibilityHint="Opens title details and source availability options"
      style={({ pressed }) => [styles.row, pressed && styles.pressed, focused && styles.focused]}
    >
      <CatalogArtwork uri={title.posterUrl} identity={title.id} style={compact ? styles.posterCompact : styles.poster} />
      <View style={styles.content}>
        <Txt weight="semibold" size={17}>{title.name}</Txt>
        <Txt size={12} color={colors.textMuted} style={styles.metadata}>{metadata}</Txt>
        {genres ? <Txt size={12} color={colors.textDim} style={styles.metadata}>{genres}</Txt> : null}
        {title.synopsis?.trim() && !compact ? <Txt size={13} color={colors.textMuted} numberOfLines={2} style={styles.synopsis}>{title.synopsis}</Txt> : null}
        <View style={styles.footer}>
          <Txt size={12} color={colors.textDim} style={styles.status}>Metadata · sources unverified</Txt>
          <Ionicons name="arrow-forward" size={18} color={colors.accent} accessible={false} />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { minHeight: 120, flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface0 },
  pressed: { backgroundColor: colors.surface2, borderColor: colors.border },
  focused: { borderColor: colors.accent },
  artwork: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderRadius: radius.md },
  poster: { width: 88, height: 132 },
  posterCompact: { width: 62, height: 93 },
  content: { flex: 1, minWidth: 0 },
  metadata: { marginTop: 4 },
  synopsis: { marginTop: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 },
  status: { flex: 1 },
});
