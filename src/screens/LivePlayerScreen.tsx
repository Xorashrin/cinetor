import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../components/Buttons';
import OfflineVideo from '../components/OfflineVideo';
import { Txt } from '../components/Txt';
import { filterChannels, getChannel, neighbor } from '../data/channels';
import type { PlaybackSourceRef } from '../data/mock';
import type { PlaybackControl } from '../engine/playbackControl';
import { createPlaybackControl, liveSources, prepareLiveSource } from '../engine/runtime';
import type { RootStackParamList } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Live'>;
export default function LivePlayerScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { state } = useApp();
  const owner = useRef(state.activeProfileId);
  const channel = getChannel(route.params.channelId);
  const control = useRef<PlaybackControl | undefined>(undefined);
  const choices = useRef<PlaybackSourceRef[]>([]);
  const position = useRef(-1);
  const generation = useRef(0);
  const replacing = useRef(false);
  const [source, setSource] = useState<PlaybackSourceRef>();
  const currentSource = useRef<PlaybackSourceRef | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const stop = useCallback(() => { generation.current++; control.current?.stop(); control.current = undefined; currentSource.current = undefined; setSource(undefined); setPaused(true); setLoading(false); }, []);
  const advance = useCallback(async () => {
    const session = control.current;
    if (!session || replacing.current || session.stopped) return;
    const operation = generation.current;
    replacing.current = true; setLoading(true); setRendered(false);
    try {
      while (++position.current < choices.current.length) {
        if (session.stopped || operation !== generation.current) return;
        const candidate = choices.current[position.current];
        // Every failed transport or decoder candidate consumes the same bounded attempt.
        if (position.current > 0 && !session.budget.canSwitch()) break;
        try {
          const checked = await prepareLiveSource(candidate, session.signal);
          if (session.stopped || operation !== generation.current) return;
          session.update([checked]);
          if (!session.select(checked)) return;
          currentSource.current = checked; setSource(checked); setError(undefined);
          return;
        } catch { if (session.signal.aborted) return; }
      }
      setError('No listed live source played within this attempt’s limits. This does not prove the channel is offline.'); setLoading(false);
    } finally { if (operation === generation.current) replacing.current = false; }
  }, []);
  useEffect(() => {
    const session = createPlaybackControl(); control.current = session;
    const operation = ++generation.current;
    choices.current = liveSources(route.params.channelId).slice(0, 4);
    position.current = -1; replacing.current = false; currentSource.current = undefined; setSource(undefined); setError(undefined); setPaused(false); setRendered(false); setLoading(true);
    const aborted = () => { if (operation !== generation.current) return; currentSource.current = undefined; setSource(undefined); setLoading(false); setPaused(true); setError('Live playback stopped because the app left the foreground or its budget/network context changed.'); session.stop(); };
    session.signal.addEventListener('abort', aborted, { once: true });
    void advance();
    return () => { generation.current++; session.signal.removeEventListener('abort', aborted); session.stop(); if (control.current === session) control.current = undefined; };
  }, [route.params.channelId, retry, advance]);
  useEffect(() => {
    if (!source || paused || !loading || error) return;
    const remaining = control.current?.budget.remainingMs ?? 0;
    const timer = setTimeout(() => void advance(), remaining > 0 ? Math.min(12000, remaining) : 12000);
    return () => clearTimeout(timer);
  }, [source, paused, loading, error, advance]);
  useEffect(() => { const subscription = AppState.addEventListener('change', value => { if (value !== 'active') setPaused(true); }); return () => subscription.remove(); }, []);
  useEffect(() => { if (state.activeProfileId !== owner.current) { stop(); setError('Profile changed. Reopen Live TV from that profile.'); } }, [state.activeProfileId, stop]);
  const zap = (step: 1 | -1) => {
    const next = neighbor(filterChannels(route.params.filter ?? 'All'), route.params.channelId, step);
    if (next && next.id !== route.params.channelId) { stop(); navigation.replace('Live', { channelId: next.id, filter: route.params.filter }); }
  };
  const valid = (value: PlaybackSourceRef) => currentSource.current === value && !control.current?.stopped && state.activeProfileId === owner.current;
  return <View style={styles.root}><StatusBar hidden />
    {source ? <OfflineVideo key={`${retry}:${source.url}`} uri={source.url} style={StyleSheet.absoluteFill} paused={paused || !!error} headers={source.headers} headerOrigin={source.headerOrigin} container={source.container === 'hls' ? 'hls' : source.container === 'dash' ? 'dash' : 'mp4'}
      onFirstFrame={() => { if (!valid(source)) return; control.current?.renderedFrame(source); setRendered(true); setLoading(false); }}
      onState={event => { if (!valid(source)) return; if (event.state === 'error') void advance(); else if (event.state === 'loading') setLoading(true); else if (event.state === 'playing' && rendered) setLoading(false); }} onEnd={() => { if (valid(source)) { setPaused(true); setError('This live source ended. Start a new attempt if you want to reconnect.'); } }} /> : null}
    <View style={[styles.top, { paddingTop: insets.top + 8, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}><IconButton icon="arrow-back" accessibilityLabel="Stop live playback and go back" onPress={() => { stop(); navigation.goBack(); }} /><View style={{ flex: 1 }}><Txt size={18} weight="bold">{channel?.name ?? 'Channel unavailable'}</Txt><Txt size={12} color={colors.textMuted}>{rendered ? 'Frame rendered in this session' : 'Live directory · source unverified'}</Txt></View><Button label="Stop" variant="secondary" onPress={() => { stop(); setError('Live playback stopped.'); }} /></View>
    {loading ? <View pointerEvents="none" style={styles.center}><ActivityIndicator size="large" color={colors.accent} /><Txt style={styles.space}>Checking live source…</Txt></View> : null}
    {error ? <View style={styles.center}><View style={styles.error}><Txt weight="bold" size={20}>Live playback unavailable</Txt><Txt size={14} color={colors.textMuted} style={styles.space}>{error}</Txt><View style={[styles.actions, styles.space]}><Button label="New attempt" disabled={state.activeProfileId !== owner.current} onPress={() => { stop(); setRetry(value => value + 1); }} /><Button label="Back" variant="secondary" onPress={() => { stop(); navigation.goBack(); }} /></View></View></View> : null}
    <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}><Button label="Previous channel" variant="secondary" onPress={() => zap(-1)} /><IconButton icon={paused ? 'play' : 'pause'} size={32} accessibilityLabel={paused ? 'Play live source' : 'Pause live source'} disabled={!source || !!error} onPress={() => setPaused(value => !value)} /><Button label="Next channel" variant="secondary" onPress={() => zap(1)} /></View>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#000000' }, top: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.scrim }, center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' }, space: { marginTop: 12 }, error: { padding: 24, borderRadius: 16, maxWidth: 560, backgroundColor: colors.overlay }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, bottom: { marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, backgroundColor: colors.scrim, paddingTop: 12 } });
