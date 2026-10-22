import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { SectionLabel, SettingRow } from '../components/ListItems';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, radius } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'AppSettings'>;

export default function AppSettingsScreen({ navigation }: Props) {
  const {
    state,
    toggleSetting,
    showToast,
    profileData,
    deleteDownload,
    signOut,
    refreshCatalog,
    engineDiagnostics,
  } = useApp();

  const [isScanning, setIsScanning] = useState(false);

  const s = state.settings;
  const notYet = () => showToast('This setting is visual-only in this build');

  const statusColor =
    engineDiagnostics.status === 'completed'
      ? '#10B981'
      : engineDiagnostics.status === 'running'
      ? '#F59E0B'
      : engineDiagnostics.status === 'failed'
      ? '#EF4444'
      : engineDiagnostics.status === 'initializing'
      ? '#3B82F6'
      : '#888888';

  const handleManualScan = async () => {
    if (isScanning || engineDiagnostics.status === 'running') return;
    setIsScanning(true);
    showToast('Starting background catalog synchronization...');
    try {
      await refreshCatalog();
      showToast('Catalog synchronization completed');
    } catch {
      showToast('Sync encountered errors');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="App Settings" back />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <SectionLabel>Live Streaming & Channels</SectionLabel>
        <SettingRow
          icon="tv-outline"
          label="Live TV & Streams"
          value="General & 18+ Adult"
          onPress={() => navigation.navigate('LiveTv')}
        />

        <SectionLabel>Video Playback</SectionLabel>
        <SettingRow icon="cellular-outline" label="Cellular Data Usage" value="Automatic" onPress={notYet} />
        <SettingRow icon="play-forward-outline" label="Autoplay Next Episode" toggle={s.autoplayNext} onToggle={() => toggleSetting('autoplayNext')} />
        <SettingRow icon="film-outline" label="Autoplay Previews" toggle={s.autoplayPreviews} onToggle={() => toggleSetting('autoplayPreviews')} />

        <SectionLabel>Notifications</SectionLabel>
        <SettingRow icon="notifications-outline" label="Allow Notifications" toggle={s.notifications} onToggle={() => toggleSetting('notifications')} />

        <SectionLabel>Downloads</SectionLabel>
        <SettingRow icon="wifi-outline" label="Wi-Fi Only" toggle={s.wifiOnly} onToggle={() => toggleSetting('wifiOnly')} />
        <SettingRow
          icon="sparkles-outline"
          label="Smart Downloads"
          description="Completed episodes will be deleted and replaced with the next episodes, only on Wi-Fi."
          toggle={s.smartDownloads}
          onToggle={() => toggleSetting('smartDownloads')}
        />
        <SettingRow icon="videocam-outline" label="Download Video Quality" value="Standard" onPress={notYet} />
        <SettingRow icon="folder-outline" label="Download Location" value="Internal Storage" onPress={notYet} />
        <SettingRow
          icon="trash-outline"
          label="Delete All Downloads"
          onPress={() =>
            Alert.alert('Delete All Downloads', 'Are you sure you want to delete all of your downloads?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  new Set(profileData.downloads.map((d) => d.titleId)).forEach((id) => deleteDownload(id));
                  showToast('All downloads deleted');
                },
              },
            ])
          }
        />

        {/* Content Synchronization & Engine Status Section */}
        <SectionLabel>Content Synchronization</SectionLabel>
        <View style={styles.diagCard}>
          <View style={styles.diagHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="sync-circle-outline" size={22} color={colors.red} />
              <Txt weight="bold" size={15}>
                Catalog Sync State
              </Txt>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Txt weight="bold" size={11} color="#FFFFFF">
                {engineDiagnostics.status.toUpperCase()}
              </Txt>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Txt size={11} color={colors.textDim}>
                Verified Playable Titles
              </Txt>
              <Txt weight="bold" size={16} color={colors.red} style={{ marginTop: 2 }}>
                {engineDiagnostics.itemsVerified}
              </Txt>
            </View>
            <View style={styles.statBox}>
              <Txt size={11} color={colors.textDim}>
                Media Discovered
              </Txt>
              <Txt weight="bold" size={16} style={{ marginTop: 2 }}>
                {engineDiagnostics.itemsDiscovered}
              </Txt>
            </View>
          </View>

          <View style={{ marginTop: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#262626' }}>
            <Txt size={12} color={colors.textDim}>
              Last Synchronized:{' '}
              <Txt size={12} weight="semibold" color={colors.text}>
                {engineDiagnostics.lastRunTime
                  ? new Date(engineDiagnostics.lastRunTime).toLocaleTimeString()
                  : 'Pending background scan'}
              </Txt>
            </Txt>
          </View>

          {engineDiagnostics.lastError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color="#EF4444" style={{ marginTop: 1 }} />
              <Txt size={11} color="#EF4444" style={{ flex: 1 }}>
                {engineDiagnostics.lastError}
              </Txt>
            </View>
          ) : null}

          {/* Action Button */}
          <View style={{ marginTop: 14 }}>
            <Pressable
              onPress={handleManualScan}
              disabled={isScanning || engineDiagnostics.status === 'running'}
              style={({ pressed }) => [
                styles.primaryBtn,
                (isScanning || engineDiagnostics.status === 'running') && { opacity: 0.6 },
                pressed && { opacity: 0.8 },
              ]}
            >
              {isScanning || engineDiagnostics.status === 'running' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
              )}
              <Txt weight="bold" size={13} color="#FFFFFF">
                {isScanning || engineDiagnostics.status === 'running' ? 'Synchronizing...' : 'Sync Catalog Now'}
              </Txt>
            </Pressable>
          </View>
        </View>

        <SectionLabel>About</SectionLabel>
        <SettingRow icon="phone-portrait-outline" label="Version" value="Cinator 1.0.0 (Release)" />
        <SettingRow icon="document-text-outline" label="Open Source Licenses" onPress={notYet} />
        <SettingRow icon="shield-checkmark-outline" label="Privacy" onPress={notYet} />
        <SettingRow
          icon="refresh-outline"
          label="Reset Data"
          onPress={() => {
            signOut().then(() => showToast('Data reset to defaults'));
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  diagCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: '#161616',
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: '#262626',
  },
  diagHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  statBox: {
    width: '48%',
    backgroundColor: '#202020',
    padding: 10,
    borderRadius: radius.sm,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    padding: 8,
    borderRadius: radius.sm,
    marginTop: 8,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.red,
    paddingVertical: 12,
    borderRadius: radius.sm,
  },
});
