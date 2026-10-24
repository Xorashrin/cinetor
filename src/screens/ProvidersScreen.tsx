import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button } from '../components/Buttons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { bdix } from '../engine/bdixBridge';
import { engineNative, type NativePluginInfo } from '../engine/nativeBridge';
import { cancelEngineSessions, engineConfiguration, initializeEngine, invalidateNetwork, providerRegistry } from '../engine/runtime';
import type { RootStackParamList } from '../navigation/types';
import { parseEngineConfiguration, type ApprovedEndpoint } from '../providers/engineConfiguration';
import { historicalInventory } from '../providers/registry';
import { useApp } from '../state/AppState';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Providers'>;
const emptyEndpoint = (): ApprovedEndpoint => ({ id: `endpoint_${Date.now().toString(36)}`, name: '', url: '', network: 'wifi', enabled: true, allowPlainFtp: false, allowCleartextHttp: false, anonymous: false, mappings: [] });
function Field({ label, value, onChange, multiline = false, placeholder }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  return <View style={styles.field}><Txt size={13} weight="semibold">{label}</Txt><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} autoCapitalize="none" autoCorrect={false} placeholder={placeholder} placeholderTextColor={colors.textDim} maxLength={multiline ? 65536 : 4096} style={[styles.input, multiline && { minHeight: 130, textAlignVertical: 'top' }]} /></View>;
}
function Consent({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.consent}><Txt size={13} style={{ flex: 1 }}>{label}</Txt><Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: colors.surface5, true: colors.accent }} /></View>;
}
export default function ProvidersScreen({ navigation }: Props) {
  const { activeProfile, showToast } = useApp();
  const registry = useSyncExternalStore(providerRegistry.subscribe, providerRegistry.getSnapshot);
  const [configuration, setConfiguration] = useState(engineConfiguration.getSnapshot());
  const [networks, setNetworks] = useState<{ id: string; label: string; selected: boolean }[]>([]);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [endpoint, setEndpoint] = useState<ApprovedEndpoint>();
  const [mappings, setMappings] = useState('');
  const [settingsPlugin, setSettingsPlugin] = useState<NativePluginInfo>();
  const [settingsText, setSettingsText] = useState('{}');
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const run = async (key: string, task: () => Promise<void>) => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(key); setError(undefined);
    try { await task(); } catch { if (mounted.current && !controller.signal.aborted) setError('The action could not finish. Check the saved configuration, selected network, and native engine status.'); }
    finally { if (request.current === controller) request.current = null; if (mounted.current) setBusy(undefined); }
  };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = engineConfiguration.subscribe(() => setConfiguration(engineConfiguration.getSnapshot()));
    void initializeEngine().then(async () => { const next = await bdix.networks(); if (mounted.current) setNetworks(next); }).catch(() => { if (mounted.current) setError('Engine configuration could not be loaded. Existing saved data has not been overwritten.'); });
    return () => { mounted.current = false; request.current?.abort(); unsubscribe(); };
  }, []);
  const configure = async (next: ApprovedEndpoint[]) => { cancelEngineSessions(); await bdix.configure(next); };
  const saveEndpoint = () => {
    if (!endpoint) return;
    void run('endpoint', async () => {
      const parsedMappings = mappings.split('\n').filter(line => line.trim()).map(line => {
        const split = line.indexOf('=');
        if (split < 1) throw new Error('Use content key = relative path.');
        return { contentKey: line.slice(0, split).trim(), path: line.slice(split + 1).trim() };
      });
      const next = { ...endpoint, name: endpoint.name.trim(), url: endpoint.url.trim(), mappings: parsedMappings };
      const checked = parseEngineConfiguration(JSON.stringify({ ...configuration, endpoints: [...configuration.endpoints.filter(row => row.id !== next.id), next] }));
      // Apply consent to the native engine before publishing the saved configuration.
      await configure(checked.endpoints);
      try { await engineConfiguration.setEndpoint(next); }
      catch (failure) { await configure(engineConfiguration.getSnapshot().endpoints); throw failure; }
      if (mounted.current) setEndpoint(undefined);
      showToast('Endpoint saved. No network scan or title matching was performed.');
    });
  };
  const changePlugin = (plugin: NativePluginInfo) => Alert.alert(plugin.enabled ? 'Disable provider?' : 'Enable reviewed provider?', plugin.enabled ? 'New playback will stop using this provider. Active engine sessions will stop.' : 'Only this build’s reviewed, hash-pinned plugin is admitted. Native extensions run with app privileges, not in a security sandbox. Built-in fixtures cover Big Buck Bunny only.', [
    { text: 'Cancel', style: 'cancel' }, { text: plugin.enabled ? 'Disable' : 'Enable', onPress: () => void run(plugin.id, async () => { cancelEngineSessions(); await providerRegistry.setEnabled(plugin.id, !plugin.enabled); }) },
  ]);
  const openSettings = (plugin: NativePluginInfo) => void run(`settings:${plugin.id}`, async () => {
    if (plugin.engine === 'cloudstream') {
      Alert.alert('Native plugin settings', 'Cloudstream’s settings screen belongs to the plugin and is app-wide, not profile-isolated. Continue?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open', onPress: () => void engineNative.openCloudstreamSettings(plugin.id).catch(() => showToast('This plugin does not expose a compatible settings screen.')) }]);
    } else {
      const values = await engineNative.readSettings(plugin.id, activeProfile.id);
      if (mounted.current) { setSettingsText(JSON.stringify(values ?? {}, null, 2)); setSettingsPlugin(plugin); }
    }
  });
  const renderPlugin = ({ item }: { item: NativePluginInfo }) => <View style={styles.card}>
    <View style={styles.row}><View style={{ flex: 1 }}><Txt size={17} weight="bold">{item.name}</Txt><Txt size={12} color={colors.textMuted}>{item.engine === 'nuvio' ? 'Nuvio · QuickJS' : 'Cloudstream · compiled extension'} · {item.version}</Txt></View><Ionicons name={item.enabled ? 'checkmark-circle' : 'ellipse-outline'} color={item.enabled ? colors.success : colors.textDim} size={24} /></View>
    <Txt size={12} color={colors.textMuted} style={styles.space}>{item.enabled ? 'Enabled for source checks' : 'Disabled'} · {item.installed ? 'Installed' : 'Not installed'} · {item.reviewed ? 'Reviewed build entry' : 'Not reviewed'}</Txt>
    {item.disabledReason ? <Txt size={13} color={colors.warning} style={styles.space}>{item.disabledReason}</Txt> : null}
    {item.hash ? <Txt size={11} selectable color={colors.textDim} style={styles.space}>SHA-256: {item.hash}</Txt> : null}
    <View style={[styles.row, styles.space]}><Button label={item.enabled ? 'Disable' : 'Enable'} variant="secondary" disabled={!!busy || !item.reviewed || !item.hash} onPress={() => changePlugin(item)} />{item.settingsAvailable ? <Button label="Settings" variant="secondary" disabled={!!busy || !item.installed} onPress={() => openSettings(item)} /> : null}</View>
  </View>;
  return <View style={styles.root}><ScreenHeader title="Engines & Providers" back /><FlatList data={registry.plugins} keyExtractor={row => row.id} renderItem={renderPlugin} contentContainerStyle={styles.content} initialNumToRender={8} windowSize={5}
    ListHeaderComponent={<>
      <Txt size={24} weight="bold">Your sources, explicitly enabled.</Txt><Txt size={14} color={colors.textMuted} style={styles.space}>Metadata discovery does not prove playback. Native engine support is separate from reviewed provider coverage. No plugins or local servers are auto-discovered.</Txt>
      {error || registry.lastError ? <Txt accessibilityRole="alert" color={colors.warning} style={styles.notice}>{error ?? registry.lastError}</Txt> : null}
      <Button label={busy === 'refresh' ? 'Reading inventory…' : 'Refresh engine inventory'} variant="secondary" disabled={!!busy} style={styles.space} onPress={() => void run('refresh', async () => { await providerRegistry.refresh(); setNetworks(await bdix.networks()); })} />
      <Button label="Extension repository intake" variant="secondary" style={styles.space} onPress={() => navigation.navigate('Repositories')} />
      <Txt size={12} color={colors.textDim} style={styles.space}>Repository metadata can be inspected separately. Unreviewed entries remain quarantined and cannot enable playback.</Txt>
      <Txt size={20} weight="bold" style={styles.heading}>Reviewed native plugins</Txt>
    </>}
    ListEmptyComponent={<Txt style={styles.notice} color={colors.textMuted}>{registry.state === 'loading' ? 'Reading this build’s inventory…' : 'No reviewed plugins are available in this build. Expo Go does not include these native modules.'}</Txt>}
    ListFooterComponent={<>
      <Txt size={20} weight="bold" style={styles.heading}>BDIX / saved local endpoints</Txt><Txt size={13} color={colors.textMuted}>A saved endpoint and an explicitly selected Wi-Fi path are required. This label does not prove ISP peering. FTP/FTPS supports explicitly approved anonymous access only.</Txt>
      <Button label="Read available Wi-Fi networks" variant="secondary" style={styles.space} disabled={!!busy || !bdix.available()} onPress={() => void run('networks', async () => { setNetworks(await bdix.networks()); })} />
      {networks.map(network => <Pressable accessibilityRole="button" accessibilityLabel={`Select ${network.label}`} key={network.id} disabled={!!busy} style={styles.network} onPress={() => Alert.alert('Use this Wi-Fi path?', 'Existing engine sessions will stop. Requests will use only this selected Android network.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Select', onPress: () => void run('network', async () => { invalidateNetwork(); await bdix.selectNetwork(network.id); setNetworks(await bdix.networks()); }) }])}><Txt style={{ flex: 1 }}>{network.label}</Txt><Txt color={colors.accent}>{network.selected ? 'Selected' : 'Select'}</Txt></Pressable>)}
      {!networks.length ? <Txt color={colors.textDim} size={12} style={styles.space}>No eligible Wi-Fi network is listed. Connect to Wi-Fi, then refresh this list.</Txt> : null}
      {configuration.endpoints.map(row => <View style={[styles.card, styles.space]} key={row.id}><Txt weight="bold">{row.name}</Txt><Txt size={12} color={colors.textMuted}>{row.enabled ? 'Enabled' : 'Disabled'} · {row.mappings.length} exact mappings</Txt><View style={[styles.row, styles.space]}><Button label="Edit" variant="secondary" disabled={!!busy} onPress={() => { setEndpoint(row); setMappings(row.mappings.map(value => `${value.contentKey} = ${value.path}`).join('\n')); }} /><Button label="Check listing" variant="secondary" disabled={!!busy} onPress={() => void run(row.id, async () => { const result = await bdix.index(row.id, request.current?.signal); showToast(`${result.count} file entries found. Unmapped files are not playback candidates.`); })} /><Button label="Revoke" variant="secondary" disabled={!!busy} onPress={() => Alert.alert('Revoke endpoint?', 'Stop active engine sessions and remove this endpoint’s consent and mappings?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Revoke', style: 'destructive', onPress: () => void run(row.id, async () => { await configure(configuration.endpoints.filter(value => value.id !== row.id)); try { await engineConfiguration.revokeEndpoint(row.id); } catch (failure) { await configure(engineConfiguration.getSnapshot().endpoints); throw failure; } }) }])} /></View></View>)}
      <Button label="Add approved endpoint" variant="secondary" disabled={!!busy || !bdix.available() || configuration.endpoints.length >= 16} style={styles.space} onPress={() => { setEndpoint(emptyEndpoint()); setMappings(''); }} />
      <Txt size={20} weight="bold" style={styles.heading}>Historical inventory</Txt>{historicalInventory.map(row => <View key={row.engine} style={styles.card}><Txt weight="bold">{row.engine} · {row.status}</Txt><Txt size={13} style={styles.space}>{row.summary}</Txt><Txt size={12} color={colors.textMuted} style={styles.space}>{row.detail}</Txt></View>)}
      <Button label="Credits and licenses" variant="secondary" onPress={() => navigation.navigate('About')} />
    </>} />
    <Modal visible={!!endpoint} animationType="none" onRequestClose={() => { if (!busy) setEndpoint(undefined); }}><View style={styles.root}><ScreenHeader title="Approved endpoint" /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>{endpoint ? <>
      <Txt size={13} color={colors.warning}>Save only a server you are authorized to access. No credentials, subnet scans, filename guesses, or automatic endpoint discovery.</Txt>
      <Field label="Name" value={endpoint.name} onChange={name => setEndpoint({ ...endpoint, name })} /><Field label="Base URL" value={endpoint.url} onChange={url => setEndpoint({ ...endpoint, url })} placeholder="https://your-approved-server.example/media/" />
      <Consent label="Enable this saved endpoint" value={endpoint.enabled} onChange={enabled => setEndpoint({ ...endpoint, enabled })} /><Consent label="I authorize anonymous FTP/FTPS access" value={endpoint.anonymous === true} onChange={anonymous => setEndpoint({ ...endpoint, anonymous })} /><Consent label="I accept unencrypted FTP for this endpoint" value={endpoint.allowPlainFtp} onChange={allowPlainFtp => setEndpoint({ ...endpoint, allowPlainFtp })} /><Consent label="I accept unencrypted HTTP for this endpoint" value={endpoint.allowCleartextHttp === true} onChange={allowCleartextHttp => setEndpoint({ ...endpoint, allowCleartextHttp })} />
      <Field label="Exact mappings, one per line" value={mappings} onChange={setMappings} multiline placeholder={'tmdb:movie:810 = BigBuckBunny.mp4\ntmdb:tv:123:s0e1 = specials/01.mp4'} /><Txt size={12} color={colors.textMuted}>Movie and TV IDs are separate. TV mappings require the exact season and episode. Listings never create mappings automatically.</Txt>
      {error ? <Txt style={styles.notice} color={colors.warning}>{error}</Txt> : null}<View style={[styles.row, styles.space]}><Button label="Cancel" variant="secondary" disabled={!!busy} onPress={() => setEndpoint(undefined)} /><Button label="Save approved endpoint" disabled={!!busy} onPress={saveEndpoint} /></View>
    </> : null}</ScrollView></View></Modal>
    <Modal visible={!!settingsPlugin} animationType="none" onRequestClose={() => setSettingsPlugin(undefined)}><View style={styles.root}><ScreenHeader title="Plugin settings" /><ScrollView contentContainerStyle={styles.content}><Txt>Profile: {activeProfile.name}</Txt><Txt size={12} color={colors.textMuted} style={styles.space}>JSON settings for this Nuvio plugin and profile. The native store encrypts saved values, but reviewed plugin code can read its settings. Do not enter unrelated passwords or tokens.</Txt><Field label="Settings JSON" value={settingsText} onChange={setSettingsText} multiline />{error ? <Txt color={colors.warning}>{error}</Txt> : null}<View style={styles.row}><Button label="Cancel" variant="secondary" disabled={!!busy} onPress={() => setSettingsPlugin(undefined)} /><Button label="Save" disabled={!!busy} onPress={() => void run('settings', async () => { if (!settingsPlugin || settingsText.length > 32768) throw new Error(); const value: unknown = JSON.parse(settingsText); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); cancelEngineSessions(); await engineNative.writeSettings(settingsPlugin.id, activeProfile.id, value as Record<string, unknown>); if (mounted.current) setSettingsPlugin(undefined); })} /></View></ScrollView></View></Modal>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 840, alignSelf: 'center' },
  card: { backgroundColor: colors.surface1, borderColor: colors.borderSubtle, borderWidth: 1, padding: 16, borderRadius: 16, marginBottom: 12 }, row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  space: { marginTop: 12 }, heading: { marginTop: 28, marginBottom: 14 }, notice: { padding: 16, marginVertical: 12, backgroundColor: colors.surface2, borderRadius: 12 }, network: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: colors.surface1, marginTop: 8, borderRadius: 12 },
  field: { marginTop: 20, marginBottom: 8 }, input: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, minHeight: 48, padding: 12, borderRadius: 10, marginTop: 8 }, consent: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 8 },
});
