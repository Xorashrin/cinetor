import React, { useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '../components/Avatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { useApp } from '../state/AppState';
import { colors, font } from '../theme/tokens';

const PROFILE_COLORS = ['#F56D50', '#9FA8EF', '#66C7B5', '#E7BB64', '#D798CA', '#78ADDE'];
export default function ManageProfilesScreen() {
  const { activeProfile, profiles, addProfile, editProfile, selectProfile, showToast } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROFILE_COLORS[0]);
  const edit = (id?: string) => {
    const row = profiles.find(profile => profile.id === id);
    setEditingId(row?.id ?? null); setName(row?.name ?? ''); setColor(row?.color ?? PROFILE_COLORS[profiles.length % PROFILE_COLORS.length]); setOpen(true);
  };
  const save = () => {
    if (!name.trim()) { showToast('Enter a profile name.'); return; }
    if (editingId) editProfile(editingId, name, color);
    else addProfile(name, color);
    setOpen(false);
  };
  return <View style={styles.root}><ScreenHeader title="Manage Profiles" back />
    <FlatList data={profiles} keyExtractor={item => item.id} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.intro}><Txt weight="bold" size={26}>Make it yours.</Txt><Txt size={14} color={colors.textMuted} style={{ marginTop: 8 }}>Each profile keeps its own watchlist, episode progress, and downloads on this device. Changing profiles stops active playback and transfers.</Txt></View>}
      renderItem={({ item }) => <View style={styles.card}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${item.name}`} onPress={() => { if (item.id !== activeProfile.id) Alert.alert('Switch Profile', 'Active playback and transfers will stop. Paused downloads can be restarted with a fresh file.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Switch', onPress: () => selectProfile(item.id) }]); }} style={styles.select}>
          <Avatar profile={item} size={52} radius={14} /><View style={{ flex: 1, marginLeft: 14 }}><Txt weight="bold" size={17}>{item.name}</Txt><Txt size={12} color={colors.textMuted} style={{ marginTop: 4 }}>{activeProfile.id === item.id ? 'Active profile' : 'Tap to switch'}</Txt></View>
          {activeProfile.id === item.id ? <Ionicons name="checkmark-circle" size={24} color={colors.red} /> : null}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`} onPress={() => edit(item.id)} style={styles.edit}><Ionicons name="create-outline" size={24} color={colors.textMuted} /></Pressable>
      </View>}
      ListFooterComponent={profiles.length < 8 ? <Pressable accessibilityRole="button" onPress={() => edit()} style={styles.add}><Ionicons name="add" size={22} color={colors.red} /><Txt weight="bold" size={15}>Add Profile</Txt></Pressable> : <Txt size={13} color={colors.textMuted} style={{ marginTop: 18 }}>Eight profiles are supported.</Txt>} />
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={styles.backdrop}><View style={styles.modal}>
      <Txt weight="bold" size={21}>{editingId ? 'Edit Profile' : 'New Profile'}</Txt><TextInput accessibilityLabel="Profile name" maxLength={40} value={name} onChangeText={setName} placeholder="Profile name" placeholderTextColor={colors.textMuted} style={styles.input} autoFocus />
      <View style={styles.swatches}>{PROFILE_COLORS.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: color === value }} accessibilityLabel={`Profile color ${value}`} onPress={() => setColor(value)} style={[styles.swatch, { backgroundColor: value, borderColor: color === value ? colors.text : 'transparent' }]} />)}</View>
      <View style={styles.buttons}><Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={styles.button}><Txt weight="semibold" size={15}>Cancel</Txt></Pressable><Pressable accessibilityRole="button" onPress={save} style={[styles.button, { backgroundColor: colors.red }]}><Txt weight="bold" size={15} color={colors.bg}>Save</Txt></Pressable></View>
    </View></View></Modal>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 840, alignSelf: 'center' }, intro: { paddingVertical: 16, marginBottom: 12 }, card: { flexDirection: 'row', backgroundColor: colors.surface1, marginBottom: 12, borderRadius: 18, alignItems: 'center', borderWidth: 1, borderColor: colors.surface4 }, select: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 16 }, edit: { minWidth: 48, minHeight: 64, alignItems: 'center', justifyContent: 'center', marginRight: 6 }, add: { minHeight: 56, borderWidth: 1, borderColor: colors.surface4, borderStyle: 'dashed', borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }, backdrop: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: colors.overlay }, modal: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: 24, borderRadius: 24, backgroundColor: colors.surface2 }, input: { minHeight: 52, marginTop: 20, paddingHorizontal: 14, backgroundColor: colors.surface3, borderRadius: 12, color: colors.text, fontFamily: font.regular, fontSize: 16 }, swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 20 }, swatch: { width: 48, height: 48, borderRadius: 24, borderWidth: 3 }, buttons: { flexDirection: 'row', gap: 12 }, button: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 } });
