import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../components/Buttons';
import { ScreenHeader } from '../components/ScreenHeader';
import { Txt } from '../components/Txt';
import { initializeEngine, repositories } from '../engine/runtime';
import type { RepositoryEngine } from '../providers/repositories';
import { colors } from '../theme/tokens';

export default function RepositoriesScreen() {
  const snapshot = useSyncExternalStore(repositories.subscribe, repositories.getSnapshot);
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [engine, setEngine] = useState<RepositoryEngine>('cloudstream');
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(repositories.ready);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void initializeEngine().then(() => {
      if (!mounted.current) return;
      setStorageReady(repositories.ready);
      if (!repositories.ready) setError('Repository storage could not be loaded. Existing records were not overwritten. Restart to try again.');
    }).catch(() => { if (mounted.current) setError('Repository storage could not be loaded. Existing records were not overwritten.'); });
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  const repository = snapshot.repositories.find(row => row.id === selected) ?? snapshot.repositories[0];
  const entries = useMemo(() => {
    const terms = query.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return repository?.entries.filter(row => terms.every(term => `${row.name} ${row.status}`.normalize('NFKC').toLowerCase().includes(term))) ?? [];
  }, [repository, query]);
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (request.current || !storageReady) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(undefined);
    try { await task(controller.signal); }
    catch { if (mounted.current && !controller.signal.aborted) setError('The action failed. Check the JSON format, public HTTPS address, and network. Existing inventory remains available.'); }
    finally { if (request.current === controller) request.current = undefined; if (mounted.current) setBusy(false); }
  };
  return <View style={styles.root}><ScreenHeader title="Extension repositories" back /><FlatList data={entries} keyExtractor={row => row.id} initialNumToRender={10} maxToRenderPerBatch={10} windowSize={5} contentContainerStyle={styles.content}
    ListHeaderComponent={<>
      <Txt size={24} weight="bold">Inspect metadata. Admit no code.</Txt>
      <Txt size={14} color={colors.textMuted} style={styles.space}>Add a repository you trust, then manually refresh its declarations. Entries stay quarantined. A publisher hash or status never enables installation, native execution, or verified playback.</Txt>
      <Txt size={12} color={colors.textDim} style={styles.space}>Cloudstream descriptors may declare up to four plugin indexes. Nuvio intake accepts provider/plugin arrays. Only declared public HTTPS addresses are read; no source archives, scripts, or .cs3 files are fetched.</Txt>
      {error ? <Txt accessibilityRole="alert" color={colors.warning} style={styles.notice}>{error}</Txt> : null}
      <Button label="Add repository declaration" variant="secondary" style={styles.space} disabled={busy || !storageReady || snapshot.repositories.length >= 16} onPress={() => { setName(''); setUrl(''); setEditing(true); }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{snapshot.repositories.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ selected: row.id === repository?.id }} style={[styles.tab, row.id === repository?.id && styles.selected]} onPress={() => { setSelected(row.id); setQuery(''); }}><Txt>{row.name}</Txt></Pressable>)}</ScrollView>
      {repository ? <View style={styles.card}>
        <Txt size={18} weight="bold">{repository.name}</Txt><Txt color={colors.textMuted} size={12} style={styles.space}>{repository.engine} · {repository.state} · {repository.entries.length} declared entries</Txt>
        <Txt selectable color={colors.textDim} size={12} style={styles.space}>{repository.url}</Txt>
        <Txt color={colors.textDim} size={12} style={styles.space}>{repository.checkedAt ? `Metadata read: ${new Date(repository.checkedAt).toLocaleString('en-US')}. This is not a playback test.` : 'Not fetched. Saving this declaration made no network request.'}</Txt>
        {repository.lastError ? <Txt color={colors.warning} size={12} style={styles.space}>Last refresh failed: {repository.lastError}. Previous rows are stale, not reverified.</Txt> : null}
        {repository.changes ? <Txt color={colors.textMuted} size={12} style={styles.space}>{repository.changes.added} added · {repository.changes.changed} changed · {repository.changes.removed} removed since the previous successful read</Txt> : null}
        <View style={[styles.row, styles.space]}><Button label={busy ? 'Reading…' : 'Refresh metadata'} variant="secondary" disabled={busy} onPress={() => Alert.alert('Read repository metadata?', 'This contacts the saved HTTPS address and up to four explicitly declared index addresses. The remote servers see your network address. No executable artifacts will be downloaded or installed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Read metadata', onPress: () => void run(signal => repositories.refresh(repository.id, signal)) }])} /><Button label="Remove declaration" variant="secondary" disabled={busy} onPress={() => Alert.alert('Remove repository declaration?', 'Remove this saved URL and its metadata ledger? Reviewed built-in plugins are separate and will not be changed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => void run(() => repositories.remove(repository.id)) }])} /></View>
      </View> : null}
      <TextInput accessibilityLabel="Filter declared extensions" placeholder="Filter names or quarantine status" placeholderTextColor={colors.textDim} value={query} onChangeText={setQuery} maxLength={200} autoCorrect={false} style={styles.input} />
    </>}
    ListEmptyComponent={<View style={styles.card}><Txt weight="bold">No matching declaration entries</Txt><Txt color={colors.textMuted} size={13} style={styles.space}>Add and refresh a supported repository, or change the filter. No historical provider counts have been converted into installed plugins.</Txt></View>}
    renderItem={({ item }) => <View style={styles.card}><View style={styles.row}><Ionicons name="lock-closed-outline" size={20} color={colors.warning} /><Txt size={16} weight="bold" style={{ flex: 1 }}>{item.name}</Txt></View><Txt size={12} color={colors.textMuted} style={styles.space}>{item.status}{item.version ? ` · declared version ${item.version}` : ''}</Txt><Txt size={12} color={colors.textMuted} style={styles.space}>{item.reason}</Txt>{item.claimedSha256 ? <Txt size={11} color={colors.textDim} selectable style={styles.space}>Publisher SHA-256 claim: {item.claimedSha256}</Txt> : null}<Txt size={11} color={colors.textDim} selectable style={styles.space}>Metadata SHA-256: {item.documentSha256}</Txt></View>} />
    <Modal visible={editing} animationType="none" onRequestClose={() => { if (!busy) setEditing(false); }}><View style={styles.root}><ScreenHeader title="Repository declaration" /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Txt size={14}>Use an explicit JSON descriptor or index URL. Saving does not fetch it or grant code execution.</Txt>
      <View style={[styles.row, styles.space]}>{(['cloudstream', 'nuvio'] as const).map(value => <Button key={value} label={`${value}${value === engine ? ' · selected' : ''}`} variant="secondary" onPress={() => setEngine(value)} />)}</View>
      <Txt style={styles.space}>Name</Txt><TextInput accessibilityLabel="Repository name" value={name} onChangeText={setName} maxLength={80} style={styles.input} />
      <Txt style={styles.space}>Public HTTPS JSON URL</Txt><TextInput accessibilityLabel="Repository JSON address" value={url} onChangeText={setUrl} maxLength={4096} autoCapitalize="none" autoCorrect={false} placeholder="https://your-repository.example/repo.json" placeholderTextColor={colors.textDim} style={styles.input} />
      <Txt size={12} color={colors.warning}>Do not include credentials, tokens, URL query parameters, or private network addresses.</Txt>
      {error ? <Txt accessibilityRole="alert" color={colors.warning} style={styles.notice}>{error}</Txt> : null}
      <View style={[styles.row, styles.space]}><Button label="Cancel" variant="secondary" disabled={busy} onPress={() => setEditing(false)} /><Button label="Save declaration" disabled={busy || !name.trim() || !url.trim()} onPress={() => void run(async () => { await repositories.add({ name, url, engine }); if (mounted.current) setEditing(false); })} /></View>
    </ScrollView></View></Modal>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 16, paddingBottom: 48, width: '100%', maxWidth: 840, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 }, space: { marginTop: 12 }, tabs: { gap: 10, paddingVertical: 20 },
  tab: { minHeight: 48, padding: 14, borderRadius: 12, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border }, selected: { borderColor: colors.accent },
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.surface1, marginBottom: 12, borderWidth: 1, borderColor: colors.borderSubtle },
  input: { minHeight: 52, padding: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, color: colors.text, borderRadius: 12, marginVertical: 12, fontSize: 15 }, notice: { marginVertical: 12, padding: 16, borderRadius: 12, backgroundColor: colors.surface2 },
});
