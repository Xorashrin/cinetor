import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRootNav } from '../navigation/types';
import { colors, layout } from '../theme/tokens';
import { Txt } from './Txt';

export type HeaderAction = 'downloads' | 'search' | 'menu' | 'notifications';

interface ScreenHeaderProps {
  title?: string;
  back?: boolean;
  actions?: HeaderAction[];
  onMenu?: () => void;
  left?: React.ReactNode;
  transparent?: boolean;
}

export function HeaderActions({ actions, onMenu }: { actions: HeaderAction[]; onMenu?: () => void }) {
  const nav = useRootNav();
  return (
    <View style={styles.actions}>
      {actions.map((a) => {
        switch (a) {
          case 'downloads':
            return (
              <Pressable key={a} hitSlop={8} onPress={() => nav.navigate('Downloads')}>
                <Ionicons name="download-outline" size={25} color={colors.text} />
              </Pressable>
            );
          case 'search':
            return (
              <Pressable key={a} hitSlop={8} onPress={() => nav.navigate('Search')}>
                <Ionicons name="search" size={24} color={colors.text} />
              </Pressable>
            );
          case 'menu':
            return (
              <Pressable key={a} hitSlop={8} onPress={onMenu}>
                <Ionicons name="menu" size={27} color={colors.text} />
              </Pressable>
            );
          case 'notifications':
            return (
              <Pressable key={a} hitSlop={8} onPress={() => nav.navigate('Notifications')}>
                <Ionicons name="notifications-outline" size={24} color={colors.text} />
              </Pressable>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}

export function ScreenHeader({ title, back, actions = [], onMenu, left, transparent }: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const nav = useRootNav();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top, backgroundColor: transparent ? 'transparent' : colors.bg }]}>
      <View style={styles.bar}>
        {back ? (
          <Pressable hitSlop={10} onPress={() => nav.goBack()} style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
        {left ?? (
          <Txt weight="bold" size={back ? 18 : 22} numberOfLines={1} style={styles.title}>
            {title}
          </Txt>
        )}
        <HeaderActions actions={actions} onMenu={onMenu} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 10 },
  bar: { height: layout.headerHeight, flexDirection: 'row', alignItems: 'center', paddingHorizontal: layout.gutter },
  back: { marginRight: 14 },
  title: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginLeft: 'auto' },
});
