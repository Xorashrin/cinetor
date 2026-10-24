import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { useApp } from '../state/AppState';
import { colors, font } from '../theme/tokens';

export default function ImportExportScreen() {
  const { exportData, importData, showToast } = useApp();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await importData(raw); setRaw(''); showToast('Profile data imported. Download files were not imported.'); }
    catch (error) { showToast(error instanceof Error && error.message === 'size' ? 'The export exceeds the 2 MB limit.' : 'Import failed. Existing profiles were not replaced. Active playback or transfers may have stopped.'); }
    finally { setBusy(false); }
  };
  return <View style={styles.root}><ScreenHeader title="Import & Export" back /><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Txt weight="bold" size={26}>Your data. Your device.</Txt><Txt size={14} color={colors.textMuted} style={styles.body}>Export local profiles, watchlists, settings, and watch progress as JSON. Exports exclude credentials, provider settings, local file paths, and playback capabilities. Media files are not copied.</Txt>
    <Pressable accessibilityRole="button" onPress={() => { try { void Share.share({ title: 'Cinetor profile export', message: exportData() }).catch(() => showToast('Export sharing was canceled.')); } catch { showToast('Profile data could not be exported.'); } }} style={styles.primary}><Txt weight="bold" size={15} color={colors.bg}>Export Profile Data</Txt></Pressable>
    <Txt weight="bold" size={20} style={{ marginTop: 30 }}>Restore an export</Txt><Txt size={13} color={colors.textMuted} style={styles.body}>Paste a Cinetor v2 JSON export below. Up to eight unique profiles and 2 MB are accepted. Imported downloads require a fresh transfer; local paths from other devices are never opened.</Txt>
    <TextInput accessibilityLabel="Cinetor JSON export" value={raw} onChangeText={setRaw} maxLength={2 * 1024 * 1024 + 1} multiline textAlignVertical="top" autoCorrect={false} autoCapitalize="none" placeholder={'{ "schemaVersion": 2, ... }'} placeholderTextColor={colors.textMuted} style={styles.input} />
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !raw.trim() }} disabled={busy || !raw.trim()} onPress={() => Alert.alert('Replace Local Profiles?', 'A valid import replaces the current local profile records and stops active playback and transfers. Export your current data first. Existing media files are not deleted.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Import', onPress: () => void save() }])} style={[styles.primary, (!raw.trim() || busy) && { opacity: 0.45 }]}><Txt weight="bold" size={15} color={colors.bg}>{busy ? 'Validating…' : 'Validate & Import'}</Txt></Pressable>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 20, paddingBottom: 48, maxWidth: 840, alignSelf: 'center', width: '100%' }, body: { lineHeight: 21, marginTop: 10, marginBottom: 20 }, primary: { minHeight: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.red, borderRadius: 14, padding: 14 }, input: { minHeight: 220, color: colors.text, backgroundColor: colors.surface1, borderRadius: 14, borderWidth: 1, borderColor: colors.surface4, padding: 16, fontFamily: font.regular, fontSize: 13, marginBottom: 16 } });
