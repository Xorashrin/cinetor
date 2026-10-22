import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEvent, useEventListener } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '../components/Txt';
import { img } from '../data/images';
import { findEpisode, getTitle, nextEpisode } from '../data/mock';
import { CatalogService } from '../engine/service/catalog-service';
import type { RootStackParamList } from '../navigation/types';
import { downloadFor, useApp } from '../state/AppState';
import { colors, motion } from '../theme/tokens';
import { formatClock } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Player'>;
type Panel = 'none' | 'speed' | 'episodes' | 'audio';
type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];
const AUDIO = ['English [Original]', 'Bangla', 'Hindi', 'Spanish'];
const SUBTITLES = ['Off', 'English', 'English [CC]', 'Bangla', 'Hindi'];
const HIDE_AFTER = 4000;

function SeekBar({ position, duration, onSeek, onScrubChange }: { position: number; duration: number; onSeek: (t: number) => void; onScrubChange: (t: number | null) => void }) {
  const width = useRef(1);
  const start = useRef(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const ratio = duration > 0 ? (scrub ?? position) / duration : 0;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          start.current = e.nativeEvent.locationX;
          const t = Math.max(0, Math.min(1, start.current / width.current)) * duration;
          setScrub(t);
          onScrubChange(t);
        },
        onPanResponderMove: (_, g) => {
          const t = Math.max(0, Math.min(1, (start.current + g.dx) / width.current)) * duration;
          setScrub(t);
          onScrubChange(t);
        },
        onPanResponderRelease: (_, g) => {
          const t = Math.max(0, Math.min(1, (start.current + g.dx) / width.current)) * duration;
          setScrub(null);
          onScrubChange(null);
          onSeek(t);
        },
        onPanResponderTerminate: () => {
          setScrub(null);
          onScrubChange(null);
        },
      }),
    [duration, onSeek, onScrubChange],
  );

  return (
    <View style={styles.seekRow}>
      <View style={styles.seekTouch} onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))} {...responder.panHandlers}>
        <View style={styles.seekTrack} pointerEvents="none">
          <View style={[styles.seekFill, { width: `${ratio * 100}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.seekThumb, { left: `${ratio * 100}%` }, scrub !== null ? styles.seekThumbActive : null]} />
      </View>
      <Txt weight="medium" size={13} style={{ marginLeft: 14, minWidth: 52 }} align="right">
        {formatClock(Math.max(0, duration - (scrub ?? position)))}
      </Txt>
    </View>
  );
}

function BottomAction({ icon, label, onPress }: { icon: MciName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.bottomAction}>
      <MaterialCommunityIcons name={icon} size={22} color={colors.text} />
      <Txt weight="medium" size={13} style={{ marginLeft: 8 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

export default function PlayerScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { setProgress, state, showToast, profileData } = useApp();
  const title = getTitle(route.params.id);
  const found = title.kind === 'series' ? findEpisode(title, route.params.episodeId) : null;
  const episode = found?.episode;
  const next = episode ? nextEpisode(title, episode.id) : null;
  const offline = downloadFor(profileData, title.id, episode?.id);
  // Prefer the downloaded file so playback works offline.
  const source = offline?.status === 'downloaded' && offline.localUri ? offline.localUri : episode?.video ?? title.video;

  const player = useVideoPlayer(source, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  const [locked, setLocked] = useState(false);
  const [unlockArmed, setUnlockArmed] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [speed, setSpeed] = useState(1);
  const [audio, setAudio] = useState(AUDIO[0]);
  const [subtitle, setSubtitle] = useState(SUBTITLES[0]);
  const [seekHint, setSeekHint] = useState<'back' | 'forward' | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const currentUrlRef = useRef(source);
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const isFailingOverRef = useRef(false);
  const latest = useRef({ position: 0, duration: 0 });
  const lastTap = useRef<{ side: 'left' | 'right'; at: number } | null>(null);

  useEffect(() => {
    if (status === 'error' && !isFailingOverRef.current) {
      isFailingOverRef.current = true;
      const failedUrl = currentUrlRef.current;
      failedUrlsRef.current.add(failedUrl);

      // Attempt verified multi-source failover on the same item/episode
      CatalogService.getInstance()
        .failoverSource(title.id, failedUrl, episode?.id)
        .then((nextMirrorUrl) => {
          if (nextMirrorUrl && !failedUrlsRef.current.has(nextMirrorUrl)) {
            showToast('Switching to alternative verified playback mirror...');
            currentUrlRef.current = nextMirrorUrl;
            player.replace(nextMirrorUrl);
            player.play();
            isFailingOverRef.current = false;
          } else {
            // Exhausted all verified mirrors for this item
            setPlaybackError('Unable to play title. All verified playback sources are currently unavailable.');
            isFailingOverRef.current = false;
          }
        })
        .catch(() => {
          setPlaybackError('Playback error occurred. No alternative source available.');
          isFailingOverRef.current = false;
        });
    }
  }, [status, title.id, episode?.id, player, showToast]);

  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    setPosition(currentTime);
    latest.current.position = currentTime;
    if (player.duration > 0) {
      latest.current.duration = player.duration;
      setDuration(player.duration);
    }
  });

  useEventListener(player, 'playToEnd', () => {
    if (next && state.settings.autoplayNext) navigation.replace('Player', { id: title.id, episodeId: next.id });
    else navigation.goBack();
  });

  // Save watch progress when leaving the player.
  useEffect(
    () => () => {
      const { position: pos, duration: dur } = latest.current;
      if (dur > 0 && pos > 5) setProgress({ titleId: title.id, episodeId: episode?.id, position: pos, duration: dur, updatedAt: Date.now() });
    },
    [setProgress, title.id, episode?.id],
  );

  // Auto-hide controls while playing.
  useEffect(() => {
    if (!visible || !isPlaying || panel !== 'none' || scrubbing !== null) return;
    const timer = setTimeout(() => setVisible(false), HIDE_AFTER);
    return () => clearTimeout(timer);
  }, [visible, isPlaying, panel, scrubbing, position]);

  useEffect(() => {
    if (!seekHint) return;
    const timer = setTimeout(() => setSeekHint(null), 600);
    return () => clearTimeout(timer);
  }, [seekHint]);

  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = withTiming(visible && !locked ? 1 : 0, { duration: motion.base });
  }, [visible, locked, fade]);
  const controlsStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const seekBy = useCallback(
    (delta: number) => {
      player.seekBy(delta);
      setSeekHint(delta < 0 ? 'back' : 'forward');
    },
    [player],
  );
  const seekTo = useCallback((t: number) => (player.currentTime = t), [player]);
  const togglePlay = () => (isPlaying ? player.pause() : player.play());

  const onSurfacePress = (side: 'left' | 'right') => {
    if (locked) {
      setVisible(true);
      return;
    }
    const nowMs = Date.now();
    if (lastTap.current && lastTap.current.side === side && nowMs - lastTap.current.at < 300) {
      seekBy(side === 'left' ? -10 : 10);
      lastTap.current = null;
      return;
    }
    lastTap.current = { side, at: nowMs };
    setVisible((v) => !v);
  };

  const heading = episode && found ? `${title.name}: S${found.season.number}:E${episode.number} “${episode.name}”` : title.name;
  const showSkipIntro = title.kind === 'series' && position > 5 && position < 35;
  const showNext = !!next && duration > 0 && duration - position < 25;
  const pointer = visible && !locked ? 'box-none' : 'none';

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />

      <View style={StyleSheet.absoluteFill}>
        <View style={styles.tapZones}>
          <Pressable style={{ flex: 1 }} onPress={() => onSurfacePress('left')} />
          <Pressable style={{ flex: 1 }} onPress={() => onSurfacePress('right')} />
        </View>
      </View>

      {status === 'loading' ? <ActivityIndicator size="large" color={colors.red} style={styles.center} /> : null}

      {seekHint ? (
        <View pointerEvents="none" style={[styles.seekHint, seekHint === 'back' ? { left: '15%' } : { right: '15%' }]}>
          <MaterialCommunityIcons name={seekHint === 'back' ? 'rewind-10' : 'fast-forward-10'} size={40} color={colors.text} />
        </View>
      ) : null}

      <Animated.View pointerEvents={pointer} style={[StyleSheet.absoluteFill, controlsStyle]}>
        <View pointerEvents="none" style={styles.dim} />
        <View style={[styles.top, { paddingLeft: insets.left + 20, paddingRight: insets.right + 20 }]}>
          <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={28} color={colors.text} />
          </Pressable>
          <Txt weight="semibold" size={15} numberOfLines={1} align="center" style={{ flex: 1, marginHorizontal: 16 }}>
            {heading}
          </Txt>
          <Pressable hitSlop={12} onPress={() => showToast('Thanks! Report a Problem arrives in a later phase')}>
            <MaterialCommunityIcons name="flag-outline" size={24} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.centerControls} pointerEvents="box-none">
          <Pressable hitSlop={16} onPress={() => seekBy(-10)}>
            <MaterialCommunityIcons name="rewind-10" size={46} color={colors.text} />
          </Pressable>
          <Pressable hitSlop={16} onPress={togglePlay} style={{ marginHorizontal: 70 }}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={64} color={colors.text} />
          </Pressable>
          <Pressable hitSlop={16} onPress={() => seekBy(10)}>
            <MaterialCommunityIcons name="fast-forward-10" size={46} color={colors.text} />
          </Pressable>
        </View>

        <View style={[styles.bottom, { paddingLeft: insets.left + 24, paddingRight: insets.right + 24, paddingBottom: insets.bottom + 14 }]}>
          <SeekBar position={position} duration={duration} onSeek={seekTo} onScrubChange={setScrubbing} />
          <View style={styles.bottomActions}>
            <BottomAction icon="speedometer" label={`Speed (${speed}x)`} onPress={() => setPanel('speed')} />
            <BottomAction icon="lock-open-variant-outline" label="Lock" onPress={() => { setLocked(true); setUnlockArmed(false); }} />
            {title.kind === 'series' ? <BottomAction icon="cards-outline" label="Episodes" onPress={() => setPanel('episodes')} /> : null}
            <BottomAction icon="subtitles-outline" label="Audio & Subtitles" onPress={() => setPanel('audio')} />
            {next ? <BottomAction icon="skip-next" label="Next Ep." onPress={() => navigation.replace('Player', { id: title.id, episodeId: next.id })} /> : null}
          </View>
        </View>
      </Animated.View>

      {showSkipIntro && !locked ? (
        <Pressable onPress={() => seekTo(40)} style={[styles.floating, { right: insets.right + 24 }]}>
          <Txt weight="bold" size={14}>
            Skip Intro
          </Txt>
        </Pressable>
      ) : null}
      {showNext && !locked ? (
        <Pressable onPress={() => next && navigation.replace('Player', { id: title.id, episodeId: next.id })} style={[styles.floating, styles.nextButton, { right: insets.right + 24 }]}>
          <MaterialCommunityIcons name="skip-next" size={20} color="#000000" />
          <Txt weight="bold" size={14} color="#000000" style={{ marginLeft: 6 }}>
            Next Episode
          </Txt>
        </Pressable>
      ) : null}

      {locked && visible ? (
        <View style={[styles.lockWrap, { bottom: insets.bottom + 30 }]}>
          <Pressable
            onPress={() => {
              if (unlockArmed) {
                setLocked(false);
                setUnlockArmed(false);
              } else setUnlockArmed(true);
            }}
            style={styles.lockButton}
          >
            <Ionicons name={unlockArmed ? 'lock-open' : 'lock-closed'} size={26} color={colors.text} />
          </Pressable>
          <Txt weight="semibold" size={14} style={{ marginTop: 8 }}>
            {unlockArmed ? 'Unlock controls?' : 'Screen Locked'}
          </Txt>
          <Txt size={12} color={colors.textMuted}>
            {unlockArmed ? 'Tap again to unlock' : 'Tap to Unlock'}
          </Txt>
        </View>
      ) : null}

      {panel !== 'none' ? (
        <View style={styles.panel}>
          <Pressable hitSlop={12} onPress={() => setPanel('none')} style={[styles.panelClose, { right: insets.right + 24 }]}>
            <Ionicons name="close" size={30} color={colors.text} />
          </Pressable>

          {panel === 'speed' ? (
            <View style={styles.speedWrap}>
              <Txt weight="bold" size={20} align="center" style={{ marginBottom: 40 }}>
                Playback Speed
              </Txt>
              <View style={styles.speedRow}>
                <View style={styles.speedLine} />
                {SPEEDS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => {
                      setSpeed(s);
                      player.playbackRate = s;
                      setPanel('none');
                    }}
                    style={styles.speedOption}
                  >
                    <View style={[styles.speedDot, s === speed ? styles.speedDotActive : null]} />
                    <Txt weight={s === speed ? 'bold' : 'regular'} size={14} style={{ marginTop: 14 }}>
                      {s === 1 ? '1x (Normal)' : `${s}x`}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {panel === 'audio' ? (
            <View style={[styles.audioWrap, { paddingLeft: insets.left + 60, paddingRight: insets.right + 60 }]}>
              {[
                { heading: 'Audio', options: AUDIO, value: audio, set: setAudio },
                { heading: 'Subtitles', options: SUBTITLES, value: subtitle, set: setSubtitle },
              ].map((col) => (
                <View key={col.heading} style={{ flex: 1 }}>
                  <Txt weight="bold" size={20} style={{ marginBottom: 16 }}>
                    {col.heading}
                  </Txt>
                  <ScrollView>
                    {col.options.map((o) => (
                      <Pressable key={o} onPress={() => col.set(o)} style={styles.audioOption}>
                        <View style={{ width: 26 }}>{o === col.value ? <Ionicons name="checkmark" size={20} color={colors.text} /> : null}</View>
                        <Txt weight={o === col.value ? 'bold' : 'regular'} size={16} color={o === col.value ? colors.text : colors.textMuted}>
                          {o}
                        </Txt>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ))}
            </View>
          ) : null}

          {panel === 'episodes' && found ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              <Txt weight="bold" size={20} style={{ marginLeft: insets.left + 40, marginBottom: 16 }}>
                Season {found.season.number}
              </Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: insets.left + 40, gap: 14 }}>
                {found.season.episodes.map((e) => (
                  <Pressable key={e.id} onPress={() => navigation.replace('Player', { id: title.id, episodeId: e.id })} style={{ width: 220 }}>
                    <View style={[styles.epThumb, e.id === episode?.id ? styles.epThumbActive : null]}>
                      <Image source={img.still(e.seed)} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                    </View>
                    <Txt weight="semibold" size={14} numberOfLines={1} style={{ marginTop: 8 }}>
                      {e.number}. {e.name}
                    </Txt>
                    <Txt size={12} color={colors.textMuted} numberOfLines={2} style={{ marginTop: 4 }}>
                      {e.synopsis}
                    </Txt>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      ) : null}

      {playbackError ? (
        <View style={styles.errorOverlay}>
          <Ionicons name="alert-circle-outline" size={54} color={colors.red} />
          <Txt weight="bold" size={18} align="center" style={{ marginTop: 16 }}>
            Playback Error
          </Txt>
          <Txt size={14} color={colors.textDim} align="center" style={{ marginTop: 8, maxWidth: 360, lineHeight: 20 }}>
            {playbackError}
          </Txt>
          <Pressable onPress={() => navigation.goBack()} style={styles.errorButton}>
            <Txt weight="bold" size={14}>
              Go Back
            </Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 100,
  },
  errorButton: {
    marginTop: 24,
    paddingHorizontal: 28,
    paddingVertical: 12,
    backgroundColor: colors.surface2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  tapZones: { flex: 1, flexDirection: 'row' },
  center: { position: 'absolute', alignSelf: 'center', top: '45%' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  top: { flexDirection: 'row', alignItems: 'center', paddingTop: 20 },
  centerControls: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  seekRow: { flexDirection: 'row', alignItems: 'center' },
  seekTouch: { flex: 1, height: 30, justifyContent: 'center' },
  seekTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2 },
  seekFill: { height: 3, backgroundColor: colors.red, borderRadius: 2 },
  seekThumb: { position: 'absolute', width: 16, height: 16, borderRadius: 8, marginLeft: -8, backgroundColor: colors.red },
  seekThumbActive: { width: 22, height: 22, borderRadius: 11, marginLeft: -11 },
  bottomActions: { flexDirection: 'row', justifyContent: 'space-evenly', marginTop: 10 },
  bottomAction: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  seekHint: { position: 'absolute', top: '42%', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  floating: {
    position: 'absolute',
    bottom: 110,
    borderWidth: 1.5,
    borderColor: colors.text,
    borderRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  nextButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.text, borderColor: colors.text },
  lockWrap: { position: 'absolute', alignSelf: 'center', alignItems: 'center' },
  lockButton: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center' },
  panelClose: { position: 'absolute', top: 20, zIndex: 2 },
  speedWrap: { alignItems: 'center' },
  speedRow: { flexDirection: 'row', alignItems: 'flex-start', width: '75%', justifyContent: 'space-between' },
  speedLine: { position: 'absolute', left: '10%', right: '10%', top: 11, height: 2, backgroundColor: colors.textDim },
  speedOption: { alignItems: 'center', width: 100 },
  speedDot: { width: 14, height: 14, borderRadius: 7, marginTop: 4, backgroundColor: colors.textDim },
  speedDotActive: { width: 24, height: 24, borderRadius: 12, marginTop: 0, backgroundColor: colors.text },
  audioWrap: { flex: 1, flexDirection: 'row', paddingTop: 60, paddingBottom: 30 },
  audioOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  epThumb: { width: 220, height: 124, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 2, borderColor: 'transparent' },
  epThumbActive: { borderColor: colors.text },
});
