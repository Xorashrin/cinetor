import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { SectionLabel, SettingRow } from '../components/ListItems';
import { ScreenHeader } from '../components/ScreenHeader';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'AppSettings'>;

export default function AppSettingsScreen({ navigation }: Props) {
  const { state, toggleSetting, showToast, profileData, deleteDownload, signOut } = useApp();
  const s = state.settings;
  const notYet = () => showToast('This setting is visual-only in this build');

  return (
    <View style={styles.root}>
      <ScreenHeader title="App Settings" back />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
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

        <SectionLabel>Diagnostics</SectionLabel>
        <SettingRow icon="speedometer-outline" label="Check Network" onPress={() => showToast('Network check successful.')} />
        <SettingRow icon="information-circle-outline" label="Playback Specification" onPress={notYet} />

        <SectionLabel>About</SectionLabel>
        <SettingRow icon="phone-portrait-outline" label="Version" value="Cinator 1.0.0" />
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
});
