import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, layout, radius } from '../theme/tokens';
import { Txt } from './Txt';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface ButtonProps {
  label: string;
  onPress?: () => void;
  icon?: IoniconName;
  variant?: 'primary' | 'secondary' | 'white' | 'gray' | 'red' | 'glass' | 'outline';
  height?: number;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  children?: React.ReactNode;
}

const PRIMARY = { bg: colors.accent, pressed: colors.accentPressed, fg: colors.onAccent, border: colors.accent };
const SECONDARY = { bg: colors.surface2, pressed: colors.surface3, fg: colors.text, border: colors.border };
const VARIANTS = {
  primary: PRIMARY,
  secondary: SECONDARY,
  white: { bg: colors.text, pressed: colors.text80, fg: colors.bg, border: colors.text },
  gray: SECONDARY,
  red: PRIMARY,
  glass: { bg: colors.glassButton, pressed: colors.surface3, fg: colors.text, border: colors.border },
  outline: { bg: 'transparent', pressed: colors.surface2, fg: colors.text, border: colors.border },
} as const;

export function Button({ label, onPress, icon, variant = 'primary', height = 48, style, disabled, loading, accessibilityLabel, accessibilityHint, children }: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed ? v.pressed : v.bg, borderColor: focused ? colors.text : v.border, opacity: disabled ? 0.5 : 1 },
        style,
        { minWidth: layout.minTouchTarget, minHeight: Math.max(layout.minTouchTarget, height) },
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Ionicons name={icon} size={22} color={v.fg} accessible={false} /> : null}
      {children}
      <Txt weight="semibold" size={14} color={v.fg} align="center" style={styles.label}>{label}</Txt>
    </Pressable>
  );
}

interface ActionProps {
  label: string;
  icon: MciName;
  onPress?: () => void;
  active?: boolean;
  width?: number;
}

export function IconAction({ label, icon, onPress, active, width = 76 }: ActionProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.action, { width: Math.max(width, layout.minTouchTarget), backgroundColor: pressed ? colors.surface2 : 'transparent' }]}
    >
      <MaterialCommunityIcons name={icon} size={26} color={active ? colors.accent : colors.text} accessible={false} />
      <Txt size={12} color={active ? colors.accent : colors.textMuted} align="center" style={styles.actionLabel}>{label}</Txt>
    </Pressable>
  );
}

interface IconButtonProps {
  icon: IoniconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  disabled?: boolean;
}

export function IconButton({ icon, onPress, size = 24, color = colors.text, style, accessibilityLabel, accessibilityHint, disabled }: IconButtonProps) {
  const [focused, setFocused] = useState(false);
  const defaultLabel = icon === 'arrow-back' ? 'Go back' : icon.replace(/-outline$/, '').replace(/-/g, ' ');
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? defaultLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: pressed ? colors.surface3 : 'transparent', borderColor: focused ? colors.accent : 'transparent', opacity: disabled ? 0.5 : 1 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color} accessible={false} />
    </Pressable>
  );
}

export function CircleIconButton({ icon, onPress, size = 48, accessibilityLabel }: { icon: IoniconName; onPress?: () => void; size?: number; accessibilityLabel?: string }) {
  const target = Math.max(size, layout.minTouchTarget);
  return <IconButton icon={icon} onPress={onPress} size={Math.min(28, target * 0.5)} accessibilityLabel={accessibilityLabel} style={{ width: target, height: target, borderRadius: target / 2, backgroundColor: colors.surface2 }} />;
}

export function ProgressBar({ value, height = 3, track = colors.surface6, style }: { value: number; height?: number; track?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ height, backgroundColor: track, borderRadius: height }, style]}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height, backgroundColor: colors.red, borderRadius: height }} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  label: { flexShrink: 1 },
  action: { minHeight: 72, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: radius.md },
  actionLabel: { marginTop: 6 },
  iconButton: { minWidth: layout.minTouchTarget, minHeight: layout.minTouchTarget, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.md },
});
