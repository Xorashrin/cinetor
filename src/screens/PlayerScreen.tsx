import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../components/Buttons';
import OfflineVideo, { type MediaTrack, type MediaTracks } from '../components/OfflineVideo';
import { Txt } from '../components/Txt';
import { findEpisode, getTitle, nextEpisode, type PlaybackSourceRef } from '../data/mock';
import { playbackSourceKey, type PlaybackControl } from '../engine/playbackControl';
import { catalog, createPlaybackControl, refreshPlaybackSource, reportDecodedPlayback, reportPlaybackFailure, resolvePlayback } from '../engine/runtime';
import type { RootStackParamList } from '../navigation/types';
import { downloadFor, progressFor, useApp } from '../state/AppState';
import { colors } from '../theme/tokens';
import { formatClock } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;
type Panel = 'none' | 'sources' | 'tracks' | 'speed' | 'episodes';
type Target = { uri: string; source?: PlaybackSourceRef; attempt: number; offline: boolean; timelineId?: string };
const EMPTY_TRACKS: MediaTracks = { audio: [], subtitles: [], video: [] };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function SeekBar({ position, duration, onSeek }: { position: number; duration: number; onSeek: (value: number) => void }) {
  const width = useRef(1);
  const start = useRef(0);
  const [scrub, setScrub] = useState<number>();
  const clamp = (pixel: number) => Math.max(0, Math.min(1, pixel / width.current)) * duration;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => duration > 0,
    onMoveShouldSetPanResponder: () => duration > 0,
    onPanResponderGrant: event => { start.current = event.nativeEvent.locationX; setScrub(clamp(start.current)); },
    onPanResponderMove: (_event, gesture) => setScrub(clamp(start.current + gesture.dx)),
    onPanResponderRelease: (_event, gesture) => { onSeek(clamp(start.current + gesture.dx)); setScrub(undefined); },
    onPanResponderTerminate: () => setScrub(undefined),
  }), [duration, onSeek]);
  const current = scrub ?? position;
  return <View style={styles.seekRow}><Txt size={12}>{formatClock(current)}</Txt><View accessibilityRole="adjustable" accessibilityLabel="Playback position" accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(current) }} accessibilityActions={[{ name: 'increment', label: 'Forward 10 seconds' }, { name: 'decrement', label: 'Back 10 seconds' }]} onAccessibilityAction={event => onSeek(position + (event.nativeEvent.actionName === 'increment' ? 10 : -10))} onLayout={event => { width.current = Math.max(1, event.nativeEvent.layout.width); }} style={styles.seekTouch} {...responder.panHandlers}><View style={styles.seekTrack}><View style={[styles.seekFill, { width: `${duration > 0 ? Math.min(100, current / duration * 100) : 0}%` }]} /></View></View><Txt size={12}>{duration > 0 ? formatClock(duration) : 'Unknown'}</Txt></View>;
}
function trackLabel(track: MediaTrack, kind: 'audio' | 'subtitles' | 'video', index: number): string {
  if (kind === 'video' && track.height) return `${track.width ? `${track.width} × ` : ''}${track.height}${track.bitrate ? ` · ${Math.round(track.bitrate / 1000)} kbps` : ''}`;
  return track.label || track.language || `Track ${index + 1}`;
}
export default function PlayerScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const app = useApp();
  const appRef = useRef(app); appRef.current = app;
  const owner = useRef(app.state.activeProfileId);
  const title = getTitle(route.params.id);
  const episodeId = route.params.episodeId;
  const found = episodeId ? findEpisode(title, episodeId) : null;
  const next = episodeId ? nextEpisode(title, episodeId) : null;
  const [target, setTarget] = useState<Target>();
  const targetRef = useRef<Target | undefined>(undefined);
  const [sources, setSources] = useState<PlaybackSourceRef[]>([]);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [panel, setPanel] = useState<Panel>('none');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seek, setSeek] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [tracks, setTracks] = useState<MediaTracks>(EMPTY_TRACKS);
  const [audioTrackId, setAudioTrackId] = useState<string>();
  const [subtitleTrackId, setSubtitleTrackId] = useState<string | null>(null);
  const [videoTrackId, setVideoTrackId] = useState('auto');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const session = useRef<PlaybackControl | undefined>(undefined);
  const generation = useRef(0);
  const attempt = useRef(0);
  const stopped = useRef(false);
  const switching = useRef(false);
  const latest = useRef({ position: 0, duration: 0, frame: false, savedAt: 0 });
  const persist = useRef<() => void>(() => undefined);
  persist.current = () => {
    const current = latest.current;
    if (!current.frame || current.duration <= 0 || current.position < 1) return;
    appRef.current.setProgress({ titleId: route.params.id, episodeId, position: Math.min(current.position, current.duration), duration: current.duration, updatedAt: Date.now(), timelineId: targetRef.current?.timelineId }, owner.current);
  };
  const resetTracks = () => { setTracks(EMPTY_TRACKS); setAudioTrackId(undefined); setSubtitleTrackId(null); setVideoTrackId('auto'); };
  const load = useCallback((source: PlaybackSourceRef, automatic = false): boolean => {
    const control = session.current;
    if (!control || stopped.current) return false;
    const selected = control.select(source, automatic);
    if (!selected) return false;
    persist.current();
    const previous = targetRef.current;
    const saved = appRef.current.state.profiles.find(row => row.id === owner.current)?.data;
    const progress = saved ? progressFor(saved, route.params.id, route.params.episodeId) : undefined;
    const canResume = !previous && !!source.timelineId && progress?.timelineId === source.timelineId;
    const resume = selected.preservePosition ? latest.current.position : canResume && progress && progress.position < progress.duration - 10 ? progress.position : 0;
    if (previous && !selected.preservePosition && latest.current.position > 5) appRef.current.showToast('Different timeline. This source starts at the beginning; seek manually if needed.');
    const value: Target = { uri: source.url, source, attempt: ++attempt.current, offline: false, timelineId: source.timelineId };
    latest.current = { position: resume, duration: 0, frame: false, savedAt: 0 };
    targetRef.current = value; setTarget(value); setPosition(resume); setSeek(resume); setDuration(0); resetTracks(); setLoading(true); setError(undefined); setPanel('none');
    return true;
  }, [route.params.id, route.params.episodeId]);
  const stop = useCallback(() => {
    persist.current(); stopped.current = true; generation.current++; session.current?.stop(); session.current = undefined;
    targetRef.current = undefined; setTarget(undefined); setLoading(false); setPaused(true); setVisible(true);
  }, []);
  const fail = useCallback(async (failed: Target) => {
    const control = session.current;
    if (stopped.current || targetRef.current?.attempt !== failed.attempt || switching.current) return;
    if (failed.offline || !control || !failed.source) { setError('This offline file is missing, incomplete, or not supported. No network fallback was attempted.'); setLoading(false); setPaused(true); return; }
    persist.current(); control.fail(failed.source); reportPlaybackFailure(failed.source);
    const backup = control.candidates[0];
    if (backup && load(backup, true)) return;
    switching.current = true; setLoading(true);
    const operation = generation.current;
    try {
      const refreshed = await refreshPlaybackSource(failed.source, control, owner.current);
      if (operation !== generation.current || stopped.current || targetRef.current?.attempt !== failed.attempt) return;
      const replacement = refreshed.find(row => playbackSourceKey(row) !== playbackSourceKey(failed.source!)) ?? control.candidates[0];
      if (replacement && load(replacement, true)) return;
      throw new Error('No replacement source.');
    } catch {
      if (operation === generation.current && !stopped.current) { setLoading(false); setError('No eligible source played within this attempt’s recovery limits. Start a new attempt or choose another source.'); setVisible(true); }
    } finally { if (operation === generation.current) switching.current = false; }
  }, [load]);
  useEffect(() => {
    const operation = ++generation.current;
    stopped.current = false; switching.current = false; setPaused(false); setLoading(true); setError(undefined); setSources([]); setVisible(true);
    targetRef.current = undefined; setTarget(undefined); latest.current = { position: 0, duration: 0, frame: false, savedAt: 0 }; setPosition(0); setDuration(0); resetTracks();
    const profile = appRef.current.state.profiles.find(row => row.id === owner.current);
    const offline = profile ? downloadFor(profile.data, route.params.id, episodeId) : undefined;
    let unsubscribe: () => void = () => undefined;
    let control: PlaybackControl | undefined;
    const abort = () => {
      if (operation !== generation.current || stopped.current) return;
      persist.current(); stopped.current = true; targetRef.current = undefined; setTarget(undefined); setPaused(true); setLoading(false); setVisible(true);
      setError('Playback stopped: the app left the foreground, the startup budget expired, or the network/provider context changed.');
      control?.stop();
    };
    void (async () => {
      const movie = /^tmdb:movie:[1-9]\d*$/.test(route.params.id) && !episodeId;
      const tv = /^tmdb:tv:[1-9]\d*$/.test(route.params.id) && !!episodeId && episodeId.startsWith(`${route.params.id}:`) && /^tmdb:tv:[1-9]\d*:s\d+e[1-9]\d*$/.test(episodeId);
      if (!movie && !tv) throw new Error('Select an exact movie or episode before playing.');
      if (offline?.status === 'downloaded' && offline.localUri) {
        const timelineId = `offline:${offline.localUri}`;
        const saved = progressFor(profile!.data, route.params.id, episodeId);
        const resume = saved?.timelineId === timelineId && saved.position < saved.duration - 10 ? saved.position : 0;
        const value: Target = { uri: offline.localUri, attempt: ++attempt.current, offline: true, timelineId };
        targetRef.current = value; setTarget(value); setSeek(resume); latest.current.position = resume; setPosition(resume);
        return;
      }
      control = createPlaybackControl(); session.current = control;
      control.signal.addEventListener('abort', abort, { once: true });
      unsubscribe = control.subscribe(values => { if (operation === generation.current && !stopped.current) setSources(values); });
      let metadata = catalog.get(route.params.id);
      if (!metadata) metadata = await catalog.detail(route.params.id, control.signal);
      if (!metadata) throw new Error('Title metadata could not be loaded. Try again when metadata is available.');
      if (control.stopped || operation !== generation.current) return;
      const resolved = await resolvePlayback(route.params.id, episodeId, control.signal, control, owner.current);
      if (operation !== generation.current || stopped.current) return;
      if (!resolved[0] || !load(resolved[0])) throw new Error('No reviewed provider returned this exact title or episode. Enable a compatible provider or configure an approved local mapping.');
    })().catch(failure => {
      if (operation !== generation.current || stopped.current) return;
      setLoading(false); setError(failure instanceof Error && failure.message.length > 25 ? failure.message : 'No eligible source is available for this exact title or episode. Check Engines & Providers.'); setVisible(true);
    });
    return () => {
      persist.current(); stopped.current = true; generation.current++;
      control?.signal.removeEventListener('abort', abort); unsubscribe(); control?.stop();
      if (session.current === control) session.current = undefined;
    };
  }, [route.params.id, episodeId, retry, load]);
  useEffect(() => {
    if (app.state.activeProfileId !== owner.current) { stop(); setError('Profile changed. Reopen playback from the selected profile.'); }
  }, [app.state.activeProfileId, stop]);
  useEffect(() => { const listener = AppState.addEventListener('change', value => { if (value !== 'active') { persist.current(); setPaused(true); setVisible(true); } }); return () => listener.remove(); }, []);
  useEffect(() => {
    if (!target || error || paused || !loading) return;
    const remaining = session.current?.budget.remainingMs ?? 0;
    const delay = target.offline ? 15000 : remaining > 0 ? Math.min(12000, remaining) : 12000;
    const timer = setTimeout(() => { void fail(target); }, delay);
    return () => clearTimeout(timer);
  }, [target, paused, loading, error, fail]);
  useEffect(() => { if (!visible || paused || loading || error || panel !== 'none') return; const timer = setTimeout(() => setVisible(false), 4500); return () => clearTimeout(timer); }, [visible, paused, loading, error, panel]);
  const seekTo = useCallback((value: number) => { const nextPosition = Math.max(0, Math.min(latest.current.duration, value)); setSeek(nextPosition); setPosition(nextPosition); latest.current.position = nextPosition; }, []);
  const valid = (value: Target) => !stopped.current && targetRef.current?.attempt === value.attempt && appRef.current.state.activeProfileId === owner.current;
  const heading = title.id === 'empty' ? route.params.id : found ? `${title.name} · S${found.season.number} E${found.episode.number}` : title.name;
  return <View style={styles.root}><StatusBar hidden />
    {target ? <OfflineVideo key={target.attempt} uri={target.uri} style={StyleSheet.absoluteFill} paused={paused || !!error} position={seek} rate={speed} headers={target.source?.headers} headerOrigin={target.source?.headerOrigin} subtitleTracks={target.offline ? undefined : target.source?.subtitleTracks} container={target.source?.container === 'mp4' || target.source?.container === 'hls' || target.source?.container === 'dash' || target.source?.container === 'mkv' || target.source?.container === 'webm' ? target.source.container : undefined} audioTrackId={audioTrackId} subtitleTrackId={subtitleTrackId} videoTrackId={videoTrackId}
      onTracks={value => { if (valid(target)) setTracks(value); }}
      onFirstFrame={() => { if (!valid(target)) return; latest.current.frame = true; setLoading(false); if (target.source && session.current?.renderedFrame(target.source)) void reportDecodedPlayback(target.source).catch(() => undefined); }}
      onTimeUpdate={value => { if (!valid(target) || !Number.isFinite(value.currentTime) || !Number.isFinite(value.duration) || value.duration < 0) return; const currentTime = Math.max(0, value.currentTime); latest.current.position = currentTime; latest.current.duration = value.duration; setPosition(currentTime); setDuration(value.duration); if (latest.current.frame && Date.now() - latest.current.savedAt > 5000) { persist.current(); latest.current.savedAt = Date.now(); } }}
      onState={value => { if (!valid(target)) return; if (value.state === 'error') void fail(target); else if (value.state === 'loading') setLoading(true); else if (value.state === 'playing' && latest.current.frame) setLoading(false); }}
      onEnd={() => { if (!valid(target) || !latest.current.frame) return; latest.current.position = latest.current.duration; persist.current(); if (next && appRef.current.state.settings.autoplayNext) navigation.replace('Player', { id: route.params.id, episodeId: next.id }); else { setPaused(true); setVisible(true); } }} /> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide player controls' : 'Show player controls'} style={StyleSheet.absoluteFill} onPress={() => setVisible(value => !value)} />
    {loading ? <View pointerEvents="none" style={styles.center}><ActivityIndicator size="large" color={colors.accent} /><Txt style={styles.space}>{target ? 'Waiting for a rendered frame…' : 'Checking exact sources…'}</Txt></View> : null}
    {visible || error ? <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingLeft: insets.left + 16, paddingRight: insets.right + 16, paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.top}><IconButton icon="arrow-back" accessibilityLabel="Stop and go back" onPress={() => { stop(); navigation.goBack(); }} /><Txt size={15} weight="semibold" style={{ flex: 1 }} numberOfLines={2}>{heading}</Txt><Button label="Stop" variant="secondary" onPress={() => { stop(); setError('Playback stopped. A new attempt starts only when you request it.'); }} /></View>
      {!error ? <View pointerEvents="box-none" style={styles.transport}><IconButton icon="play-back" accessibilityLabel="Back 10 seconds" onPress={() => seekTo(position - 10)} /><IconButton icon={paused ? 'play' : 'pause'} size={38} accessibilityLabel={paused ? 'Play' : 'Pause'} disabled={!target} onPress={() => setPaused(value => !value)} /><IconButton icon="play-forward" accessibilityLabel="Forward 10 seconds" onPress={() => seekTo(position + 10)} /></View> : null}
      <View style={styles.bottom}><SeekBar position={position} duration={duration} onSeek={seekTo} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
        {!target?.offline ? <Button label={`Sources (${sources.length})`} variant="secondary" onPress={() => setPanel('sources')} /> : <Txt style={styles.offline}>Offline · no network fallback</Txt>}
        <Button label="Audio / captions / quality" variant="secondary" disabled={!target} onPress={() => setPanel('tracks')} /><Button label={`${speed}× speed`} variant="secondary" disabled={!target} onPress={() => setPanel('speed')} />
        {found ? <Button label="Episodes" variant="secondary" onPress={() => setPanel('episodes')} /> : null}{next ? <Button label="Next episode" variant="secondary" onPress={() => navigation.replace('Player', { id: route.params.id, episodeId: next.id })} /> : null}
      </ScrollView></View>
    </View> : null}
    {error && panel === 'none' ? <View style={[styles.error, { paddingHorizontal: insets.left + 24 }]}><Txt weight="bold" size={20}>Playback unavailable</Txt><Txt size={14} align="center" color={colors.textMuted} style={styles.space}>{error}</Txt><View style={[styles.actions, styles.space]}><Button label="New attempt" disabled={app.state.activeProfileId !== owner.current} onPress={() => { stop(); setRetry(value => value + 1); }} />{sources.length && !stopped.current ? <Button label="Choose source" variant="secondary" onPress={() => setPanel('sources')} /> : null}<Button label="Go back" variant="secondary" onPress={() => { stop(); navigation.goBack(); }} /></View></View> : null}
    {panel !== 'none' ? <View style={[styles.panel, { paddingTop: insets.top + 8, paddingLeft: insets.left + 16, paddingRight: insets.right + 16, paddingBottom: insets.bottom + 8 }]}><View style={styles.top}><Txt weight="bold" size={20} style={{ flex: 1 }}>{panel === 'tracks' ? 'Available media tracks' : panel === 'sources' ? 'Exact-content sources' : panel === 'speed' ? 'Playback speed' : 'Episodes'}</Txt><IconButton icon="close" accessibilityLabel="Close player panel" onPress={() => setPanel('none')} /></View>
      {panel === 'sources' ? <FlatList data={sources} keyExtractor={playbackSourceKey} ListEmptyComponent={<Txt color={colors.textMuted}>No eligible sources returned.</Txt>} renderItem={({ item, index }) => <Pressable style={styles.option} accessibilityRole="button" onPress={() => load(item)}><Txt weight="semibold">{item.label || item.providerId || `Source ${index + 1}`}</Txt><Txt size={12} color={colors.textMuted}>{item.engine} · {item.locality === 'approved-network' ? 'Selected Wi-Fi path' : 'Internet'} · {item.verificationState === 'recent-decoded-playback' ? 'Recent rendered-frame evidence' : 'Not decoder-verified'}{target?.source && playbackSourceKey(item) === playbackSourceKey(target.source) ? ' · Selected' : ''}</Txt></Pressable>} /> : null}
      {panel === 'speed' ? <ScrollView contentContainerStyle={styles.actions}>{SPEEDS.map(value => <Button key={value} label={`${value}×${value === speed ? ' · selected' : ''}`} variant="secondary" onPress={() => { setSpeed(value); setPanel('none'); }} />)}</ScrollView> : null}
      {panel === 'tracks' ? <ScrollView>{(['audio', 'subtitles', 'video'] as const).map(kind => <View key={kind} style={styles.trackGroup}><Txt weight="bold">{kind === 'audio' ? 'Audio' : kind === 'subtitles' ? 'Captions' : 'Video'}</Txt>{kind !== 'audio' ? <Pressable accessibilityRole="button" style={styles.option} onPress={() => kind === 'video' ? setVideoTrackId('auto') : setSubtitleTrackId(null)}><Txt>{kind === 'video' ? 'Automatic selection' : 'Off'}</Txt></Pressable> : null}{!tracks[kind].length ? <Txt size={13} color={colors.textMuted} style={styles.space}>No selectable {kind} tracks reported.</Txt> : tracks[kind].map((track, index) => <Pressable key={track.id} accessibilityRole="button" style={styles.option} onPress={() => kind === 'audio' ? setAudioTrackId(track.id) : kind === 'video' ? setVideoTrackId(track.id) : setSubtitleTrackId(track.id)}><Txt>{trackLabel(track, kind, index)}{(kind === 'audio' ? audioTrackId : kind === 'video' ? videoTrackId : subtitleTrackId) === track.id ? ' · selected' : ''}</Txt></Pressable>)}</View>)}</ScrollView> : null}
      {panel === 'episodes' && found ? <FlatList data={found.season.episodes} keyExtractor={row => row.id} renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.option} onPress={() => navigation.replace('Player', { id: route.params.id, episodeId: item.id })}><Txt weight="semibold">S{found.season.number} E{item.number} · {item.name}</Txt><Txt color={colors.textMuted} size={12}>{item.id === episodeId ? 'Current episode' : 'Check sources for this exact episode'}</Txt></Pressable>} /> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' }, center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' }, space: { marginTop: 12 },
  top: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.scrim, borderRadius: 12 }, transport: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 48 },
  bottom: { marginTop: 'auto', backgroundColor: colors.overlay, borderRadius: 12, paddingHorizontal: 12 }, actions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, flexWrap: 'wrap' }, offline: { color: colors.success, padding: 12 },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, seekTouch: { flex: 1, minHeight: 48, justifyContent: 'center' }, seekTrack: { height: 5, backgroundColor: colors.surface5, borderRadius: 3 }, seekFill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
  panel: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg }, option: { minHeight: 56, justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 12, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }, trackGroup: { marginVertical: 16 },
  error: { position: 'absolute', top: '20%', left: 16, right: 16, backgroundColor: colors.overlay, padding: 24, borderRadius: 20, alignItems: 'center' },
});
