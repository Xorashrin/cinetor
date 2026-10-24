import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { SectionLabel, SettingRow } from '../components/ListItems';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { DiagnosticsView } from '../engine/DiagnosticsView';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'AppSettings'>;
export default function AppSettingsScreen({ navigation }: Props) {
  const { state, activeProfile, toggleSetting, showToast, profileData, deleteDownload, resetData } = useApp();
  return <View style={styles.root}><ScreenHeader title="Settings" back /><ScrollView contentContainerStyle={styles.content}>
    <Txt weight="bold" size={22}>Preferences for {activeProfile.name}</Txt><Txt color={colors.textMuted} size={13} style={styles.notice}>Playback and download preferences belong to this profile. Switching profiles stops active playback and transfers.</Txt>
    <SectionLabel>Playback</SectionLabel><SettingRow icon="play-forward-outline" label="Autoplay next episode" description="Continue to the next known episode only after this one ends." toggle={state.settings.autoplayNext} onToggle={() => toggleSetting('autoplayNext')} /><SettingRow icon="accessibility-outline" label="Reduce motion" description="Disable app navigation and sheet animations. The system accessibility preference also applies." toggle={state.settings.reducedMotion} onToggle={() => toggleSetting('reducedMotion')} />
    <SectionLabel>Downloads</SectionLabel><SettingRow icon="wifi-outline" label="Wi-Fi only" description="Pause transfers when Wi-Fi is no longer eligible. A restart uses a fresh file." toggle={state.settings.wifiOnly} onToggle={() => toggleSetting('wifiOnly')} /><SettingRow icon="folder-outline" label="Storage location" value="App-private internal storage" description="Offline playback is cache-only. Files are not automatically copied to shared media storage." /><SettingRow icon="download-outline" label="Manage downloads" onPress={() => navigation.navigate('Downloads')} /><SettingRow icon="trash-outline" label="Delete this profile’s downloads" onPress={() => Alert.alert('Delete all downloads in this profile?', 'This removes the listed offline copies and their records. Other profiles are not affected.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
      void (async () => { for (const row of [...profileData.downloads]) await deleteDownload(row.titleId, row.episodeId, activeProfile.id); showToast('This profile’s downloads were removed.'); })().catch(() => showToast('Some downloads could not be removed. Remaining records are still available in Downloads.'));
    } }])} />
    <SectionLabel>Android permissions</SectionLabel><SettingRow icon="notifications-outline" label="Notification settings" description="Android controls notification permission. Required transfer notifications use generic text, not private titles." onPress={() => void Linking.openSettings().catch(() => showToast('Android settings could not be opened.'))} />
    <SectionLabel>Sources</SectionLabel><SettingRow icon="server-outline" label="Engines & Providers" description="Reviewed native plugins and explicitly approved local endpoints." onPress={() => navigation.navigate('Providers')} /><SettingRow icon="tv-outline" label="Live TV directory" description="Separate from movie and series catalogs." onPress={() => navigation.navigate('LiveTv')} /><SettingRow icon="shield-outline" label="Restricted Content" value="Not enabled" onPress={() => navigation.navigate('AdultContent')} />
    <SectionLabel>Your data</SectionLabel><SettingRow icon="swap-vertical-outline" label="Import & Export" onPress={() => navigation.navigate('ImportExport')} /><SettingRow icon="refresh-outline" label="Clear this profile’s watch history and lists" description="Keeps the profile, preferences, and download records/files. Stops active sessions." onPress={() => Alert.alert('Clear watch history and lists?', 'Remove this profile’s watchlist, ratings, reminders, and progress? Downloads and preferences are kept. Export first if you need a backup.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => { resetData(); showToast('History and lists cleared. Downloads were kept.'); } }])} />
    {__DEV__ ? <DiagnosticsView /> : null}
    <SectionLabel>About</SectionLabel><SettingRow icon="information-circle-outline" label="About Cinetor" value="Version 2.0.0" onPress={() => navigation.navigate('About')} /><SettingRow icon="document-text-outline" label="Credits, licensing, and source" onPress={() => navigation.navigate('About')} />
    <Txt color={colors.textDim} size={12} style={styles.notice}>No cloud account is required. Catalog queries and enabled provider requests still contact their configured services. Local settings are not an encrypted credential vault.</Txt>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48, maxWidth: 840, width: '100%', alignSelf: 'center' }, notice: { marginTop: 12, marginBottom: 8 } });
