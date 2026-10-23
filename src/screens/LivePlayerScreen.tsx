import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEvent, useEventListener } from "expo";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChannelLogo } from "../components/ChannelLogo";
import { Txt } from "../components/Txt";
import { filterChannels, getChannel, neighbor } from "../data/channels";
import { getAdultChannel } from "../data/adultChannels";
import type { RootStackParamList } from "../navigation/types";
import {
  reportPlayback,
  liveSources,
  verifiedLiveSource,
} from "../engine/runtime";
import { colors, motion } from "../theme/tokens";
import { useApp } from "../state/AppState";

type Props = NativeStackScreenProps<RootStackParamList, "Live">;

const LOAD_TIMEOUT_MS = 15000;

export default function LivePlayerScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { catalogVersion } = useApp();
  const channel =
    getChannel(route.params.channelId) ||
    getAdultChannel(route.params.channelId);
  const list = useMemo(
    () =>
      channel && getAdultChannel(channel.id)
        ? []
        : filterChannels(route.params.filter ?? "All"),
    [route.params.filter, channel],
  );
  const sources = useMemo(
    () =>
      channel ? liveSources(channel.id) : [],
    [route.params.channelId, catalogVersion],
  );
  const sourceUrls = sources.map((source) => source.url).join("|");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [visible, setVisible] = useState(true);
  const advancing = useRef(false);
  const loadGeneration = useRef(0);
  const request = useRef<AbortController | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1;
    p.play();
  });
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });

  // A source that errors (or never becomes ready) falls through to the next working source.
  const indexRef = useRef(0);
  const decoded = useRef(new Set<string>());
  const loadSource = useCallback(async (start: number, signal: AbortSignal) => {
    const generation = ++loadGeneration.current;
    advancing.current = true;
    setResolving(true);
    try {
      for (let index = start; index < sources.length; index++) {
        if (signal.aborted) return;
        indexRef.current = index;
        setSourceIndex(index);
        try {
          const ref = await verifiedLiveSource(sources[index], signal);
          if (signal.aborted) return;
          await player.replaceAsync(ref);
          if (signal.aborted) return;
          player.play();
          setFailed(false);
          return;
        } catch {
          if (signal.aborted) return;
          if (channel) void reportPlayback(channel.id, sources[index].url, false).catch(() => undefined);
        }
      }
      if (!signal.aborted) setFailed(true);
    } finally {
      if (generation === loadGeneration.current) {
        advancing.current = false;
        if (!signal.aborted) setResolving(false);
      }
    }
  }, [sourceUrls, player, route.params.channelId]);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    indexRef.current = 0;
    setSourceIndex(0);
    setFailed(false);
    void loadSource(0, controller.signal);
    return () => controller.abort();
  }, [loadSource]);
  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    const source = sources[indexRef.current];
    if (
      channel &&
      source &&
      currentTime > 0 &&
      player.playing &&
      !decoded.current.has(source.url)
    ) {
      decoded.current.add(source.url);
      void reportPlayback(channel.id, source.url, true)
        .catch(() => undefined);
    }
  });
  const tryNextSource = () => {
    if (advancing.current || failed) return;
    const failedSource = sources[indexRef.current];
    if (channel && failedSource)
      void reportPlayback(channel.id, failedSource.url, false)
        .catch(() => undefined);
    const signal = request.current?.signal;
    if (signal && !signal.aborted) void loadSource(indexRef.current + 1, signal);
  };

  useEventListener(player, "statusChange", ({ status: s }) => {
    if (s === "error") tryNextSource();
  });

  useEffect(() => {
    if (status === "readyToPlay" || failed || resolving) return;
    const timer = setTimeout(tryNextSource, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
    // tryNextSource reads the latest state through setState; re-arm only when the source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sourceIndex, failed, resolving]);

  useEffect(() => {
    if (!visible || !isPlaying) return;
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [visible, isPlaying]);

  const fade = useSharedValue(1);
  useEffect(() => {
    fade.value = withTiming(visible ? 1 : 0, { duration: motion.base });
  }, [visible, fade]);
  const controlsStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const zap = (step: 1 | -1) => {
    if (!channel) return;
    const next = neighbor(list, channel.id, step);
    if (next)
      navigation.replace("Live", {
        channelId: next.id,
        filter: route.params.filter,
      });
  };

  if (!channel) {
    return (
      <View style={[styles.root, styles.center]}>
        <Txt size={16}>This channel is no longer available.</Txt>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => setVisible((v) => !v)}
      />

      {failed ? (
        <View style={[StyleSheet.absoluteFill, styles.center, styles.dim]}>
          <MaterialCommunityIcons
            name="television-off"
            size={48}
            color={colors.textMuted}
          />
          <Txt weight="bold" size={18} style={{ marginTop: 12 }}>
            {channel.name} is offline right now
          </Txt>
          <Txt size={13} color={colors.textMuted} style={{ marginTop: 6 }}>
            Live channels sometimes go down. Try another channel.
          </Txt>
          <View style={styles.failActions}>
            <Pressable onPress={() => zap(1)} style={styles.failButton}>
              <Txt weight="bold" size={14} color="#000000">
                Next Channel
              </Txt>
            </Pressable>
            <Pressable
              onPress={() => navigation.goBack()}
              style={[styles.failButton, styles.failGhost]}
            >
              <Txt weight="bold" size={14}>
                Back
              </Txt>
            </Pressable>
          </View>
        </View>
      ) : status !== "readyToPlay" ? (
        <ActivityIndicator
          size="large"
          color={colors.red}
          style={styles.spinner}
        />
      ) : null}

      {!failed ? (
        <Animated.View
          pointerEvents={visible ? "box-none" : "none"}
          style={[StyleSheet.absoluteFill, controlsStyle]}
        >
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.dim]}
          />
          <View
            style={[
              styles.top,
              {
                paddingLeft: insets.left + 20,
                paddingRight: insets.right + 20,
              },
            ]}
          >
            <Pressable hitSlop={12} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={28} color={colors.text} />
            </Pressable>
            <View style={styles.titleWrap}>
              <ChannelLogo channel={channel} size={56} />
              <View style={{ marginLeft: 12, flexShrink: 1 }}>
                <Txt weight="bold" size={16} numberOfLines={1}>
                  {channel.name}
                </Txt>
                <Txt size={12} color={colors.textMuted} numberOfLines={1}>
                  {channel.category} • {channel.country}
                  {channel.quality ? ` • ${channel.quality}` : ""}
                </Txt>
              </View>
            </View>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Txt weight="bold" size={12}>
                LIVE
              </Txt>
            </View>
          </View>

          <View style={styles.centerControls} pointerEvents="box-none">
            <Pressable hitSlop={16} onPress={() => zap(-1)}>
              <MaterialCommunityIcons
                name="skip-previous"
                size={46}
                color={colors.text}
              />
            </Pressable>
            <Pressable
              hitSlop={16}
              onPress={() => (isPlaying ? player.pause() : player.play())}
              style={{ marginHorizontal: 70 }}
            >
              <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={64}
                color={colors.text}
              />
            </Pressable>
            <Pressable hitSlop={16} onPress={() => zap(1)}>
              <MaterialCommunityIcons
                name="skip-next"
                size={46}
                color={colors.text}
              />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  center: { alignItems: "center", justifyContent: "center" },
  dim: { backgroundColor: "rgba(0,0,0,0.5)" },
  spinner: { position: "absolute", alignSelf: "center", top: "45%" },
  top: { flexDirection: "row", alignItems: "center", paddingTop: 20 },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 18,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.red,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.text,
    marginRight: 6,
  },
  centerControls: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  failActions: { flexDirection: "row", gap: 12, marginTop: 20 },
  failButton: {
    backgroundColor: colors.text,
    borderRadius: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  failGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: colors.text,
  },
});
