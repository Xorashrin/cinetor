import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
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
    addCustomSource,
  } = useApp();

  const [isScanning, setIsScanning] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');

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
    showToast('Starting BDIX crawler & verification scan...');
    try {
      await refreshCatalog();
      showToast('BDIX scan completed');
    } catch {
      showToast('Scan encountered errors (see diagnostics below)');
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddSource = async () => {
    const trimmedUrl = customUrl.trim();
    const trimmedName = customName.trim() || 'Custom BDIX Source';
    if (!trimmedUrl) {
      Alert.alert('Invalid URL', 'Please enter a valid HTTP/HTTPS media endpoint URL.');
      return;
    }
    try {
      await addCustomSource(trimmedName, trimmedUrl);
      setShowAddModal(false);
      setCustomName('');
      setCustomUrl('');
      showToast('Custom source added. Tap "Scan Sources Now" to index.');
    } catch (err: unknown) {
      Alert.alert('Error Adding Source', err instanceof Error ? err.message : String(err));
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

        {/* Observable BDIX Scraper & Indexing Diagnostics Section */}
        <SectionLabel>BDIX Scraper & Engine Diagnostics</SectionLabel>
        <View style={styles.diagCard}>
          <View style={styles.diagHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="hardware-chip-outline" size={20} color={colors.red} />
              <Txt weight="bold" size={15}>
                Engine Status
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
                Configured Sources
              </Txt>
              <Txt weight="bold" size={16} style={{ marginTop: 2 }}>
                {engineDiagnostics.configuredSourcesCount}
              </Txt>
            </View>
            <View style={styles.statBox}>
              <Txt size={11} color={colors.textDim}>
                Sources Attempted
              </Txt>
              <Txt weight="bold" size={16} style={{ marginTop: 2 }}>
                {engineDiagnostics.sourcesAttemptedCount}
              </Txt>
            </View>
            <View style={styles.statBox}>
              <Txt size={11} color={colors.textDim}>
                Successful Sources
              </Txt>
              <Txt weight="bold" size={16} color="#10B981" style={{ marginTop: 2 }}>
                {engineDiagnostics.successfulSourcesCount}
              </Txt>
            </View>
            <View style={styles.statBox}>
              <Txt size={11} color={colors.textDim}>
                Failed Sources
              </Txt>
              <Txt weight="bold" size={16} color={engineDiagnostics.failedSourcesCount > 0 ? '#EF4444' : colors.textDim} style={{ marginTop: 2 }}>
                {engineDiagnostics.failedSourcesCount}
              </Txt>
            </View>
            <View style={styles.statBox}>
              <Txt size={11} color={colors.textDim}>
                Items Discovered
              </Txt>
              <Txt weight="bold" size={16} style={{ marginTop: 2 }}>
                {engineDiagnostics.itemsDiscovered}
              </Txt>
            </View>
            <View style={styles.statBox}>
              <Txt size={11} color={colors.textDim}>
                Verified Playable
              </Txt>
              <Txt weight="bold" size={16} color={colors.red} style={{ marginTop: 2 }}>
                {engineDiagnostics.itemsVerified}
              </Txt>
            </View>
          </View>

          <View style={{ marginTop: 12, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#262626' }}>
            <Txt size={12} color={colors.textDim}>
              Last Execution:{' '}
              <Txt size={12} weight="semibold" color={colors.text}>
                {engineDiagnostics.lastRunTime
                  ? new Date(engineDiagnostics.lastRunTime).toLocaleTimeString()
                  : 'Not executed in this session'}
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

          {/* Action Buttons */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
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
                {isScanning || engineDiagnostics.status === 'running' ? 'Scanning...' : 'Scan Sources Now'}
              </Txt>
            </Pressable>

            <Pressable
              onPress={() => setShowAddModal(true)}
              style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="add-outline" size={16} color={colors.text} />
              <Txt weight="semibold" size={13}>
                Add Source
              </Txt>
            </Pressable>
          </View>

          {/* Active Sources List */}
          {engineDiagnostics.activeSources && engineDiagnostics.activeSources.length > 0 ? (
            <View style={{ marginTop: 16 }}>
              <Txt size={12} weight="bold" color={colors.textDim} style={{ marginBottom: 6 }}>
                Active Configured Sources:
              </Txt>
              {engineDiagnostics.activeSources.map((source) => (
                <View key={source.id} style={styles.sourceItem}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="semibold" size={12}>
                      {source.name}
                    </Txt>
                    <Txt size={10} color={colors.textDim}>
                      {source.protocol.toUpperCase()} • {source.baseUrl}
                    </Txt>
                  </View>
                  <View style={[styles.sourceDot, { backgroundColor: source.enabled ? '#10B981' : '#888888' }]} />
                </View>
              ))}
            </View>
          ) : null}
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

      {/* Add Custom Source Modal */}
      <Modal visible={showAddModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Txt weight="bold" size={18}>
              Add Custom BDIX Source
            </Txt>
            <Txt size={12} color={colors.textDim} style={{ marginTop: 4, marginBottom: 14 }}>
              Enter an authorized local BDIX HTTP media directory URL:
            </Txt>

            <TextInput
              placeholder="Source Name (e.g. ISP Media Mirror)"
              placeholderTextColor="#666"
              value={customName}
              onChangeText={setCustomName}
              style={styles.modalInput}
            />

            <TextInput
              placeholder="http://10.x.x.x/movies or http://bdix.local/media"
              placeholderTextColor="#666"
              value={customUrl}
              onChangeText={setCustomUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.modalInput, { marginTop: 8 }]}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => setShowAddModal(false)}
                style={({ pressed }) => [styles.modalBtnCancel, pressed && { opacity: 0.7 }]}
              >
                <Txt size={14} color={colors.textDim}>
                  Cancel
                </Txt>
              </Pressable>
              <Pressable
                onPress={handleAddSource}
                style={({ pressed }) => [styles.modalBtnSave, pressed && { opacity: 0.8 }]}
              >
                <Txt weight="bold" size={14} color="#FFFFFF">
                  Add Source
                </Txt>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.red,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#262626',
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  sourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  sourceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBox: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1C1C1C',
    borderRadius: radius.md,
    padding: 20,
    borderWidth: 1,
    borderColor: '#333333',
  },
  modalInput: {
    backgroundColor: '#121212',
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#333',
    fontSize: 13,
  },
  modalBtnCancel: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  modalBtnSave: {
    backgroundColor: colors.red,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
  },
});
