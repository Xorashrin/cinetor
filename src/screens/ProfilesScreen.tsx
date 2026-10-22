import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { MLogo, Wordmark } from '../components/Logo';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { useRootNav } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, layout, radius } from '../theme/tokens';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const PRESET_PROFILES = [
  { id: 'main', name: 'User', color: '#E50914' },
  { id: 'anime', name: 'Anime Fan', color: '#0071EB' },
  { id: 'kdrama', name: 'K-Drama Fan', color: '#9B51E0' },
  { id: 'kids', name: 'Kids', color: '#F2C94C', kids: true },
];

const GITHUB_REPO_URL = 'https://github.com/Xorashrin/cinetor';

function ActionItem({
  icon,
  label,
  badge,
  onPress,
  color,
}: {
  icon: IoniconName;
  label: string;
  badge?: number;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={styles.actionIconWrap}>
        <Ionicons name={icon} size={20} color={color ?? colors.text} />
      </View>
      <Txt weight="semibold" size={15} style={{ flex: 1, marginLeft: 14 }}>
        {label}
      </Txt>
      {badge !== undefined && badge > 0 ? (
        <View style={styles.badge}>
          <Txt weight="bold" size={12} color={colors.text}>
            {badge}
          </Txt>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

export default function ProfilesScreen() {
  const nav = useRootNav();
  const { activeProfile, profileData, setDisplayName, resetData, showToast } = useApp();
  const [editModal, setEditModal] = useState(false);
  const [aboutModal, setAboutModal] = useState(false);
  const [nameInput, setNameInput] = useState(activeProfile?.name ?? 'User');

  const myListCount = profileData.myList.length;
  const downloadCount = profileData.downloads.length;

  const saveName = () => {
    if (nameInput.trim()) {
      setDisplayName(nameInput.trim());
      showToast('Profile name updated');
    }
    setEditModal(false);
  };

  const handleClearData = () => {
    Alert.alert('Reset App Data', 'Are you sure you want to clear your local list and download history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          resetData();
          showToast('App data reset successfully');
        },
      },
    ]);
  };

  const openGitHub = () => {
    Linking.openURL(GITHUB_REPO_URL).catch(() => {
      showToast('Could not open GitHub link');
    });
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Profiles & Account" actions={['search']} />

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        {/* Active Profile Header */}
        <View style={styles.activeProfileSection}>
          <Pressable onPress={() => setEditModal(true)} style={({ pressed }) => [styles.avatarButton, pressed && { opacity: 0.8 }]}>
            <View style={styles.avatarBorder}>
              <Avatar profile={activeProfile ?? PRESET_PROFILES[0]} size={76} radius={8} />
            </View>
            <View style={styles.editBadge}>
              <Ionicons name="pencil" size={14} color={colors.text} />
            </View>
          </Pressable>
          <Txt weight="bold" size={20} style={{ marginTop: 12 }}>
            {activeProfile?.name ?? 'User'}
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
            Tap avatar to edit name
          </Txt>
        </View>

        {/* Profile Switcher Row */}
        <View style={styles.profilesSection}>
          <Txt weight="bold" size={14} color={colors.textMuted} style={{ marginBottom: 12 }}>
            SWITCH PROFILE
          </Txt>
          <View style={styles.profileList}>
            {PRESET_PROFILES.map((p) => {
              const isSelected = activeProfile?.name === p.name;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setDisplayName(p.name);
                    showToast(`Switched to ${p.name}`);
                  }}
                  style={({ pressed }) => [styles.profileItem, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.profileThumbWrap, isSelected && styles.selectedProfileWrap]}>
                    <Avatar profile={p} size={48} radius={6} />
                  </View>
                  <Txt weight={isSelected ? 'bold' : 'medium'} size={12} numberOfLines={1} style={{ marginTop: 6 }}>
                    {p.name}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Quick Menu Options */}
        <View style={styles.menuCard}>
          <ActionItem icon="bookmark-outline" label="My List" badge={myListCount} onPress={() => nav.navigate('MyList')} />
          <View style={styles.divider} />
          <ActionItem icon="download-outline" label="Downloads" badge={downloadCount} onPress={() => nav.navigate('Downloads')} />
          <View style={styles.divider} />
          <ActionItem icon="notifications-outline" label="Notifications" onPress={() => nav.navigate('Notifications')} />
          <View style={styles.divider} />
          <ActionItem icon="tv-outline" label="Live TV & Streams" color={colors.red} onPress={() => nav.navigate('LiveTv')} />
          <View style={styles.divider} />
          <ActionItem icon="settings-outline" label="App Settings" onPress={() => nav.navigate('AppSettings')} />
          <View style={styles.divider} />
          <ActionItem icon="information-circle-outline" label="About Cinator" color={colors.blue} onPress={() => setAboutModal(true)} />
          <View style={styles.divider} />
          <ActionItem icon="trash-outline" label="Reset Local Data" onPress={handleClearData} />
        </View>

        {/* Embedded About Section Card */}
        <View style={styles.aboutCard}>
          <View style={styles.aboutHeader}>
            <MLogo size={32} />
            <View style={{ marginLeft: 12 }}>
              <Wordmark size={20} />
              <Txt size={11} color={colors.textDim}>
                Version 1.0.0 (Release Build)
              </Txt>
            </View>
          </View>

          <Txt size={13} color={colors.textMuted} lineHeight={19} style={{ marginTop: 12 }}>
            Next-generation fast streaming client with isolated feeds for Home, Anime, K-Drama, and Live TV.
          </Txt>

          <View style={styles.creditBox}>
            <View style={styles.creditRow}>
              <Ionicons name="code-slash" size={16} color={colors.red} />
              <Txt weight="bold" size={13} style={{ marginLeft: 8 }}>
                Developed by: <Txt weight="black" color={colors.text}>Asraful Islam</Txt>
              </Txt>
            </View>
            <View style={[styles.creditRow, { marginTop: 6 }]}>
              <Ionicons name="sparkles" size={16} color={colors.blue} />
              <Txt weight="bold" size={13} style={{ marginLeft: 8 }}>
                Helped by: <Txt weight="black" color={colors.text}>Sazzad Hossain</Txt>
              </Txt>
            </View>
          </View>

          <Pressable onPress={openGitHub} style={({ pressed }) => [styles.githubBtn, pressed && { opacity: 0.8 }]}>
            <Ionicons name="logo-github" size={18} color={colors.text} />
            <Txt weight="bold" size={13} style={{ marginLeft: 8 }}>
              github.com/Xorashrin/cinetor
            </Txt>
            <Ionicons name="open-outline" size={14} color={colors.textMuted} style={{ marginLeft: 6 }} />
          </Pressable>
        </View>
      </ScrollView>

      {/* Edit Profile Name Modal */}
      <Modal visible={editModal} transparent animationType="fade" onRequestClose={() => setEditModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditModal(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Txt weight="bold" size={18}>
              Edit Profile Name
            </Txt>
            <TextInput
              style={styles.input}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Enter name"
              placeholderTextColor={colors.textDim}
              autoFocus
            />
            <View style={styles.modalButtons}>
              <Pressable onPress={() => setEditModal(false)} style={styles.modalBtnCancel}>
                <Txt weight="medium" size={14} color={colors.textDim}>
                  Cancel
                </Txt>
              </Pressable>
              <Pressable onPress={saveName} style={styles.modalBtnSave}>
                <Txt weight="bold" size={14} color={colors.text}>
                  Save
                </Txt>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full About Modal */}
      <Modal visible={aboutModal} transparent animationType="fade" onRequestClose={() => setAboutModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAboutModal(false)}>
          <Pressable style={styles.aboutModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={{ alignItems: 'center' }}>
              <MLogo size={52} />
              <View style={{ marginTop: 12 }}>
                <Wordmark size={28} />
              </View>
              <Txt size={12} color={colors.textDim} style={{ marginTop: 4 }}>
                v1.0.0 • Production Release
              </Txt>
            </View>

            <View style={styles.aboutDivider} />

            <View style={{ gap: 10 }}>
              <View style={styles.infoBadge}>
                <Ionicons name="code-working-outline" size={18} color={colors.red} />
                <View style={{ marginLeft: 10 }}>
                  <Txt size={11} color={colors.textDim}>DEVELOPER</Txt>
                  <Txt weight="bold" size={14}>Asraful Islam</Txt>
                </View>
              </View>

              <View style={styles.infoBadge}>
                <Ionicons name="heart-circle-outline" size={18} color={colors.blue} />
                <View style={{ marginLeft: 10 }}>
                  <Txt size={11} color={colors.textDim}>CONTRIBUTOR</Txt>
                  <Txt weight="bold" size={14}>Sazzad Hossain</Txt>
                </View>
              </View>

              <View style={styles.infoBadge}>
                <Ionicons name="layers-outline" size={18} color="#FF9900" />
                <View style={{ marginLeft: 10 }}>
                  <Txt size={11} color={colors.textDim}>ARCHITECTURE</Txt>
                  <Txt weight="bold" size={14}>Isolated Feeds (Home, Anime, K-Drama, Live TV)</Txt>
                </View>
              </View>
            </View>

            <Pressable onPress={openGitHub} style={({ pressed }) => [styles.fullGithubBtn, pressed && { opacity: 0.85 }]}>
              <Ionicons name="logo-github" size={20} color={colors.text} />
              <Txt weight="bold" size={14} style={{ marginLeft: 8 }}>
                View Repository on GitHub
              </Txt>
            </Pressable>

            <Pressable onPress={() => setAboutModal(false)} style={styles.closeBtn}>
              <Txt weight="bold" size={14} color={colors.textMuted} align="center">
                Close
              </Txt>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  activeProfileSection: { alignItems: 'center', marginTop: 20, marginBottom: 24 },
  avatarButton: { position: 'relative' },
  avatarBorder: { padding: 3, borderRadius: 12, borderWidth: 2, borderColor: colors.red },
  editBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: colors.surface4,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  profilesSection: { paddingHorizontal: layout.gutter + 4, marginBottom: 24 },
  profileList: { flexDirection: 'row', gap: 14 },
  profileItem: { alignItems: 'center', width: 68 },
  profileThumbWrap: { padding: 2, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  selectedProfileWrap: { borderColor: colors.red },
  menuCard: {
    marginHorizontal: layout.gutter + 4,
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  aboutCard: {
    marginHorizontal: layout.gutter + 4,
    marginTop: 20,
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  aboutHeader: { flexDirection: 'row', alignItems: 'center' },
  creditBox: {
    marginTop: 14,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  creditRow: { flexDirection: 'row', alignItems: 'center' },
  githubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface3,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginTop: 14,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  actionIconWrap: { width: 32, alignItems: 'center' },
  badge: {
    backgroundColor: colors.red,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.08)', marginLeft: 48 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  aboutModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface2,
    borderRadius: radius.xl,
    padding: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  aboutDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 18 },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface3,
    padding: 10,
    borderRadius: radius.md,
  },
  fullGithubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.red,
    paddingVertical: 12,
    borderRadius: radius.md,
    marginTop: 20,
  },
  closeBtn: { paddingVertical: 12, marginTop: 4 },
  input: {
    backgroundColor: colors.surface3,
    color: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginTop: 16,
    marginBottom: 20,
  },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalBtnCancel: { paddingVertical: 8, paddingHorizontal: 14 },
  modalBtnSave: { backgroundColor: colors.red, paddingVertical: 8, paddingHorizontal: 18, borderRadius: radius.sm },
});
