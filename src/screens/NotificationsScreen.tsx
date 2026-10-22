import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import React from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { img } from '../data/images';
import { NOTIFICATIONS, getTitle } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Notifications'>;

export default function NotificationsScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <ScreenHeader title="Notifications" back />
      <FlatList
        data={NOTIFICATIONS}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: 30, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Txt weight="bold" size={18} align="center">
              No notifications yet
            </Txt>
            <Txt size={13} color={colors.textDim} align="center" style={{ marginTop: 6 }}>
              We'll let you know when new titles and updates arrive.
            </Txt>
          </View>
        }
        renderItem={({ item, index }) => {
          const title = getTitle(item.titleId);
          return (
            <Pressable
              onPress={() => navigation.navigate('Title', { id: title.id })}
              style={({ pressed }) => [styles.row, pressed ? { backgroundColor: colors.surface1 } : null]}
            >
              <View style={[styles.dot, index > 1 ? { backgroundColor: 'transparent' } : null]} />
              <View style={styles.thumb}>
                <Image source={img.backdrop(title.seed)} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Txt size={13} color={colors.textMuted}>
                  {item.kicker}
                </Txt>
                <Txt weight="semibold" size={15} numberOfLines={2} style={{ marginTop: 2 }}>
                  {item.text}
                </Txt>
                <Txt size={12} color={colors.textDim} style={{ marginTop: 4 }}>
                  {item.date}
                </Txt>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red, marginRight: 8 },
  thumb: { width: 112, height: 63, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
});
