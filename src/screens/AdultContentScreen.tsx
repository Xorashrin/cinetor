import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { colors } from '../theme/tokens';

export default function AdultContentScreen() {
  return <View style={styles.root}><ScreenHeader title="Restricted Content" back /><View style={styles.content}>
    <View style={styles.icon}><Ionicons name="lock-closed-outline" size={38} color={colors.textMuted} /></View>
    <Txt weight="bold" size={24} align="center" style={{ marginTop: 22 }}>Not enabled</Txt>
    <Txt size={14} color={colors.textMuted} align="center" style={styles.description}>No authorized restricted-content provider or age-verification policy is configured. This section stays empty and never appears in regular catalogs, search, history, exports, or notifications.</Txt>
    <Txt size={12} color={colors.textMuted} align="center" style={{ marginTop: 20 }}>A local PIN or self-attestation is not a substitute for lawful age verification.</Txt>
  </View></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 28, maxWidth: 600, alignSelf: 'center', alignItems: 'center', marginTop: 50 }, icon: { width: 88, height: 88, borderRadius: 28, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }, description: { lineHeight: 22, marginTop: 14 } });
