import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { colors, layout, radius } from '../theme/tokens';
import { Txt } from './Txt';

interface ChipProps {
  label?: string;
  onPress?: () => void;
  selected?: boolean;
  caret?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  emoji?: string;
  solid?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  expanded?: boolean;
}

export function Chip({ label, onPress, selected, caret, icon, emoji, solid, disabled, accessibilityLabel, accessibilityHint, expanded }: ChipProps) {
  const [focused, setFocused] = useState(false);
  const filled = solid && selected;
  const foreground = filled ? colors.onAccent : selected ? colors.accent : colors.textMuted;
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? (icon === 'close' ? 'Clear filter' : 'Filter')}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: !!selected, disabled: !!disabled, expanded }}
      style={({ pressed }) => [
        styles.chip,
        label ? styles.withLabel : styles.iconOnly,
        filled ? styles.solid : selected ? styles.selected : null,
        focused ? styles.focused : null,
        pressed ? { backgroundColor: filled ? colors.accentPressed : colors.surface3 } : null,
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={foreground} accessible={false} /> : null}
      {emoji ? <Txt size={14}>{emoji}</Txt> : null}
      {label ? <Txt weight="semibold" size={13} color={foreground} style={styles.label}>{label}</Txt> : null}
      {caret ? <Ionicons name="chevron-down" size={16} color={foreground} accessible={false} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 10,
  },
  withLabel: { paddingHorizontal: 14, maxWidth: '100%' },
  iconOnly: { paddingHorizontal: 12 },
  label: { flexShrink: 1 },
  selected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  solid: { backgroundColor: colors.accent, borderColor: colors.accent },
  focused: { borderColor: colors.text },
});
