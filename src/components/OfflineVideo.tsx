import React, { useEffect } from 'react';
import { Platform, View, type NativeSyntheticEvent, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import type { DownloadContainer } from '../../modules/cinetor-media/src/download-client';

export type PlaybackContainer = DownloadContainer | 'webm';

export interface MediaTrack {
  id: string;
  label?: string;
  language?: string;
  width?: number;
  height?: number;
  bitrate?: number;
}
export interface MediaTracks {
  audio: MediaTrack[];
  subtitles: MediaTrack[];
  video: MediaTrack[];
}
export interface MediaTimeUpdate { currentTime: number; duration: number }
export interface MediaState {
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';
  error?: string;
}
export interface OfflineVideoProps extends ViewProps {
  uri: string;
  headers?: Record<string, string>;
  headerOrigin?: string;
  container?: PlaybackContainer;
  subtitleTracks?: Array<{ url: string; language?: string; label?: string; mimeType?: string }>;
  paused?: boolean;
  /** Seek command in seconds; update when requesting a seek, not on every time event. */
  position?: number;
  rate?: number;
  audioTrackId?: string;
  subtitleTrackId?: string | null;
  videoTrackId?: string;
  onFirstFrame?: () => void;
  onTimeUpdate?: (event: MediaTimeUpdate) => void;
  onState?: (event: MediaState) => void;
  onEnd?: () => void;
  onTracks?: (tracks: MediaTracks) => void;
}
interface NativeProps extends Omit<OfflineVideoProps, 'onFirstFrame' | 'onTimeUpdate' | 'onState' | 'onEnd' | 'onTracks'> {
  onFirstFrame?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  onTimeUpdate?: (event: NativeSyntheticEvent<MediaTimeUpdate>) => void;
  onState?: (event: NativeSyntheticEvent<MediaState>) => void;
  onEnd?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
  onTracks?: (event: NativeSyntheticEvent<MediaTracks>) => void;
}

let NativeVideo: React.ComponentType<NativeProps> | undefined;
if (Platform.OS === 'android') {
  try { NativeVideo = requireNativeViewManager<NativeProps>('CinetorMedia'); }
  catch { /* Expo Go and unsupported targets render an explicit unavailable state, not unsafe playback. */ }
}

/**
 * Unified Android player. Online media uses origin-confined native HTTP. cinetor-offline URIs
 * use cache-only Media3 sources; legacy app-private files use a file-only allowlisted source.
 */
export function OfflineVideo({
  onFirstFrame, onTimeUpdate, onState, onEnd, onTracks,
  paused = true, rate = 1, subtitleTrackId = 'off', videoTrackId = 'auto', ...props
}: OfflineVideoProps) {
  useEffect(() => {
    if (!NativeVideo) onState?.({ state: 'error', error: 'Secure media playback requires an Android development or release build, not Expo Go' });
  }, [onState]);
  if (!NativeVideo) return <View style={props.style} accessibilityLabel="Native media playback unavailable" />;
  return <NativeVideo
    {...props} paused={paused} rate={rate} subtitleTrackId={subtitleTrackId} videoTrackId={videoTrackId}
    onFirstFrame={() => onFirstFrame?.()}
    onTimeUpdate={event => onTimeUpdate?.(event.nativeEvent)}
    onState={event => onState?.(event.nativeEvent)}
    onEnd={() => onEnd?.()}
    onTracks={event => onTracks?.(event.nativeEvent)}
  />;
}
export default OfflineVideo;
