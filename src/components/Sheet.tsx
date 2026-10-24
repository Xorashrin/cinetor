import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '../state/AppState';
import { colors, motion } from '../theme/tokens';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** Bottom sheet with drag handle, scrim and slide-up motion. */
export function Sheet({ visible, onClose, children }: SheetProps) {
  const insets = useSafeAreaInsets();
  const { state } = useApp();
  const reduced = state.settings.reducedMotion;
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = visible ? reduced ? 1 : withTiming(1, { duration: motion.slow, easing: motion.decelerate }) : 0;
  }, [visible, progress, reduced]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * 420 }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }, sheetStyle]}>
        <View style={styles.handle} />
        {children}
      </Animated.View>
    </Modal>
  );
}

/** Full-screen dark picker (Categories, Season, etc.). */
export function PickerOverlay({ visible, onClose, children }: SheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.picker}>{children}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface2,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingTop: 8,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  picker: { flex: 1, backgroundColor: colors.overlay },
});
