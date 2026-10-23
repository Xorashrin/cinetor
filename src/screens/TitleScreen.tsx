import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, CircleIconButton, IconAction, ProgressBar } from '../components/Buttons';
import { PickerList } from '../components/ListItems';
import { MLogo } from '../components/Logo';
import { Poster } from '../components/Poster';
import { PickerOverlay } from '../components/Sheet';
import { Txt } from '../components/Txt';
import { img } from '../data/images';
import { AVAILABLE, findEpisode, getTitle, top10Rank, type Episode, type Title } from '../data/mock';
import type { RootStackParamList } from '../navigation/types';
import { downloadFor, progressFor, useApp, type Rating } from '../state/AppState';
import { catalog } from '../engine/runtime';
import { colors, radius } from '../theme/tokens';
import { formatRuntime, seasonsLabel } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Title'>;
type Tab = 'episodes' | 'more' | 'trailers';

const RATING_ICON: Record<Rating, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  down: 'thumb-down',
  up: 'thumb-up',
  love: 'thumbs-up-down',
};

function MetaTag({ label }: { label: string }) {
  return (
    <View style={styles.metaTag}>
      <Txt weight="semibold" size={10} color={colors.textSoft}>
        {label}
      </Txt>
    </View>
  );
}

function DownloadIcon({ titleId, episode }: { titleId: string; episode?: Episode }) {
  const { profileData, startDownload, deleteDownload, showToast } = useApp();
  const entry = downloadFor(profileData, titleId, episode?.id);
  if (entry?.status === 'downloading') {
    return (
      <Pressable hitSlop={10} onPress={() => deleteDownload(titleId, episode?.id)} style={styles.dlIcon}>
        <ActivityIndicator size="small" color={colors.blue} />
      </Pressable>
    );
  }
  if (entry?.status === 'failed') {
    return (
      <Pressable hitSlop={10} onPress={() => startDownload(titleId, episode ? episode.runtime * 6 : 800, episode?.id)} style={styles.dlIcon}>
        <Ionicons name="refresh-circle-outline" size={26} color={colors.redLight} />
      </Pressable>
    );
  }
  if (entry?.status === 'downloaded') {
    return (
      <Pressable hitSlop={10} onPress={() => { deleteDownload(titleId, episode?.id); showToast('Download deleted'); }} style={styles.dlIcon}>
        <Ionicons name="checkmark-circle" size={24} color={colors.blue} />
      </Pressable>
    );
  }
  return (
    <Pressable hitSlop={10} onPress={() => startDownload(titleId, episode ? episode.runtime * 6 : 800, episode?.id)} style={styles.dlIcon}>
      <Ionicons name="download-outline" size={24} color={colors.text} />
    </Pressable>
  );
}

function EpisodeRow({ title, episode, onPlay }: { title: Title; episode: Episode; onPlay: () => void }) {
  const { profileData } = useApp();
  const progress = progressFor(profileData, title.id);
  const watched = progress?.episodeId === episode.id ? progress.position / Math.max(1, progress.duration) : 0;
  return (
    <View style={styles.episode}>
      <View style={styles.episodeTop}>
        <Pressable onPress={onPlay} style={styles.still}>
          <Image source={episode.posterUrl ? { uri: episode.posterUrl } : title.backdropUrl ? { uri: title.backdropUrl } : img.still(episode.seed)} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" />
          <View style={styles.stillPlay}>
            <Ionicons name="play" size={16} color={colors.text} style={{ marginLeft: 2 }} />
          </View>
          {watched > 0 ? <ProgressBar value={watched} height={3} style={styles.stillProgress} /> : null}
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Txt weight="medium" size={14} numberOfLines={2}>
            {episode.number}. {episode.name}
          </Txt>
          <Txt size={12} color={colors.textDim} style={{ marginTop: 4 }}>
            {episode.runtime}m
          </Txt>
        </View>
        <DownloadIcon titleId={title.id} episode={episode} />
      </View>
      <Txt size={13} color={colors.textMuted} lineHeight={18} numberOfLines={3} style={{ marginTop: 8 }}>
        {episode.synopsis}
      </Txt>
    </View>
  );
}

export default function TitleScreen({ navigation, route }: Props) {
  const title = getTitle(route.params.id);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { profileData, toggleMyList, rate, toggleReminder, startDownload, showToast, catalogVersion } = useApp();
  useEffect(() => {
    const controller = new AbortController();
    void catalog.detail(route.params.id, controller.signal).catch(() => showToast("Could not load title details. Please try again."));
    return () => controller.abort();
  }, [route.params.id]);
  const [tab, setTab] = useState<Tab>(title.kind === 'series' ? 'episodes' : 'more');
  const [seasonNumber, setSeasonNumber] = useState(1);
  const [seasonPicker, setSeasonPicker] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const progress = progressFor(profileData, title.id);
  const resume = progress?.episodeId ? findEpisode(title, progress.episodeId) : null;
  const first = findEpisode(title);
  const target = resume ?? first;
  const inList = profileData.myList.includes(title.id);
  const rating = profileData.ratings[title.id];
  const reminded = profileData.reminders.includes(title.id);
  const rank = top10Rank(title.id);
  const season = title.seasons.find((s) => s.number === seasonNumber) ?? title.seasons[0];
  const movieDownload = title.kind === 'movie' ? downloadFor(profileData, title.id) : undefined;
  const similar = useMemo(
    () => AVAILABLE.filter((t) => t.id !== title.id && t.genres.some((g) => title.genres.includes(g))).slice(0, 12),
    [title, catalogVersion],
  );
  const tabs: { key: Tab; label: string }[] = [
    ...(title.kind === 'series' ? [{ key: 'episodes' as const, label: 'Episodes' }] : []),
    { key: 'more', label: 'More Like This' },
    { key: 'trailers', label: 'Trailers & More' },
  ];
  const gridWidth = (width - 24 - 16) / 3;

  const play = (episodeId?: string) => {
    if (title.comingSoon) {
      showToast(`${title.name} is ${title.comingSoon.label.toLowerCase()}`);
      return;
    }
    navigation.navigate('Player', { id: title.id, episodeId });
  };

  const setRating = (r: Rating) => {
    const next = rating === r ? null : r;
    rate(title.id, next);
    setRatingOpen(false);
    if (next === 'down') showToast("We won't suggest this again.");
    else if (next === 'up') showToast("You'll see more like this.");
    else if (next === 'love') showToast('We know you’re a true fan!');
  };

  const playLabel = progress ? 'Resume' : 'Play';
  const epCode = target ? `S${target.season.number}:E${target.episode.number}` : '';

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: insets.top, backgroundColor: colors.bg }}>
        <Pressable onPress={() => play(target?.episode.id)} style={{ width, height: (width * 9) / 16 }}>
          <Image source={title.backdropUrl ? { uri: title.backdropUrl } : title.posterUrl ? { uri: title.posterUrl } : img.backdrop(title.seed)} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" />
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.5)']} style={StyleSheet.absoluteFill} />
          <View style={styles.heroPlay}>
            <Ionicons name="play" size={30} color={colors.text} style={{ marginLeft: 4 }} />
          </View>
          <View style={styles.heroActions}>
            <CircleIconButton icon="close" size={32} onPress={() => navigation.goBack()} />
          </View>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.body}>
          {title.original ? (
            <View style={styles.kicker}>
              <MLogo size={16} />
              <Txt weight="bold" size={11} spacing={3} color={colors.textSoft} style={{ marginLeft: 6 }}>
                {title.kind === 'series' ? 'SERIES' : 'FILM'}
              </Txt>
            </View>
          ) : null}
          <Txt weight="extrabold" size={24} lineHeight={30}>
            {title.name}
          </Txt>
          <View style={styles.meta}>
            {title.year > 0 ? <Txt size={13} color={colors.textMuted}>{title.year}</Txt> : null}
            <View style={styles.maturity}>
              <Txt weight="semibold" size={11}>{title.maturity}</Txt>
            </View>
            <Txt size={13} color={colors.textMuted}>
              {title.kind === 'series' ? seasonsLabel(title.seasons.length) : formatRuntime(title.runtime)}
            </Txt>
            {title.quality.map((q) => (
              <MetaTag key={q} label={q} />
            ))}
          </View>

          {rank ? (
            <View style={styles.rank}>
              <View style={styles.rankBadge}>
                <Txt weight="black" size={7} lineHeight={8} align="center">TOP</Txt>
                <Txt weight="black" size={11} lineHeight={12} align="center">10</Txt>
              </View>
              <Txt weight="bold" size={15}>
                #{rank.rank} in {rank.list} Today
              </Txt>
            </View>
          ) : null}

          {title.comingSoon ? (
            <Button
              label={reminded ? 'Reminder Set' : 'Remind Me'}
              icon={reminded ? 'checkmark' : 'notifications-outline'}
              variant="white"
              onPress={() => {
                toggleReminder(title.id);
                showToast(reminded ? 'Reminder removed' : 'Reminder set. Look for this in My List soon.');
              }}
              style={styles.cta}
            />
          ) : (
            <>
              <Button label={playLabel} icon="play" variant="white" onPress={() => play(target?.episode.id)} style={styles.cta} />
              {title.kind === 'movie' ? (
                <Button
                  label={
                    movieDownload?.status === 'downloaded'
                      ? 'Downloaded'
                      : movieDownload?.status === 'failed'
                        ? 'Retry Download'
                        : movieDownload
                        ? `Downloading ${Math.round(movieDownload.progress * 100)}%`
                        : 'Download'
                  }
                  icon={movieDownload?.status === 'downloaded' ? 'checkmark-circle' : 'download-outline'}
                  variant="gray"
                  onPress={() => (movieDownload && movieDownload.status !== 'failed' ? navigation.navigate('Downloads') : startDownload(title.id, 845))}
                  style={styles.cta}
                />
              ) : (
                <Button
                  label={`Download ${epCode}`}
                  icon="download-outline"
                  variant="gray"
                  onPress={() => target && startDownload(title.id, target.episode.runtime * 6, target.episode.id)}
                  style={styles.cta}
                />
              )}
            </>
          )}

          {progress ? (
            <View style={styles.resume}>
              <ProgressBar value={progress.position / Math.max(1, progress.duration)} style={{ flex: 1 }} />
              <Txt size={12} color={colors.textMuted} style={{ marginLeft: 10 }}>
                {Math.max(1, Math.round((progress.duration - progress.position) / 60))}m remaining
              </Txt>
            </View>
          ) : null}

          {resume ? (
            <Txt weight="bold" size={14} style={{ marginTop: 10 }}>
              {epCode} {resume.episode.name}
            </Txt>
          ) : null}

          <Pressable onPress={() => setExpanded((e) => !e)}>
            <Txt size={14} lineHeight={20} numberOfLines={expanded ? undefined : 3} style={{ marginTop: 10 }}>
              {title.synopsis}
            </Txt>
          </Pressable>
          <Txt size={12} color={colors.textDim} numberOfLines={expanded ? undefined : 1} style={{ marginTop: 10 }}>
            <Txt weight="semibold" size={12} color={colors.textMuted}>Starring: </Txt>
            {title.cast.join(', ')}
          </Txt>
          <Txt size={12} color={colors.textDim} numberOfLines={1} style={{ marginTop: 4 }}>
            <Txt weight="semibold" size={12} color={colors.textMuted}>
              {title.kind === 'series' ? (title.creators.length > 1 ? 'Creators: ' : 'Creator: ') : 'Director: '}
            </Txt>
            {title.creators.join(', ')}
          </Txt>

          <View style={styles.actions}>
            <IconAction
              label="My List"
              icon={inList ? 'check' : 'plus'}
              active={inList}
              onPress={() => {
                toggleMyList(title.id);
                showToast(inList ? 'Removed from My List' : 'Added to My List');
              }}
            />
            <View>
              <IconAction label="Rate" icon={rating ? RATING_ICON[rating] : 'thumb-up-outline'} active={!!rating} onPress={() => setRatingOpen((o) => !o)} />
              {ratingOpen ? (
                <View style={styles.ratingPopover}>
                  {(['down', 'up', 'love'] as const).map((r) => (
                    <Pressable key={r} hitSlop={6} onPress={() => setRating(r)} style={[styles.ratingButton, rating === r ? styles.ratingActive : null]}>
                      <MaterialCommunityIcons name={r === 'down' ? 'thumb-down-outline' : r === 'up' ? 'thumb-up-outline' : 'thumbs-up-down-outline'} size={26} color={colors.text} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <IconAction label="Share" icon="send-outline" onPress={() => Share.share({ message: `Check out "${title.name}" on Cinator` }).catch(() => undefined)} />
          </View>
          {ratingOpen ? (
            <View style={styles.ratingLabels}>
              <Txt size={11} color={colors.textMuted}>Not for me</Txt>
              <Txt size={11} color={colors.textMuted}>I like this</Txt>
              <Txt size={11} color={colors.textMuted}>Love this!</Txt>
            </View>
          ) : null}
        </View>

        <View style={styles.tabs}>
          {tabs.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={styles.tab}>
              <View style={[styles.tabIndicator, tab === t.key ? { backgroundColor: colors.red } : null]} />
              <Txt weight="bold" size={14} color={tab === t.key ? colors.text : colors.textDim}>
                {t.label}
              </Txt>
            </Pressable>
          ))}
        </View>

        {tab === 'episodes' && season ? (
          <View style={styles.tabBody}>
            <Pressable onPress={() => title.seasons.length > 1 && setSeasonPicker(true)} style={styles.seasonButton}>
              <Txt weight="semibold" size={14}>
                Season {season.number}
              </Txt>
              {title.seasons.length > 1 ? <Ionicons name="chevron-down" size={16} color={colors.text} style={{ marginLeft: 6 }} /> : null}
            </Pressable>
            {season.episodes.map((e) => (
              <EpisodeRow key={e.id} title={title} episode={e} onPlay={() => play(e.id)} />
            ))}
          </View>
        ) : null}

        {tab === 'more' ? (
          <View style={[styles.tabBody, styles.grid]}>
            {similar.map((t) => (
              <Poster key={t.id} title={t} width={gridWidth} height={gridWidth * 1.45} onPress={(p) => navigation.push('Title', { id: p.id })} />
            ))}
          </View>
        ) : null}

        {tab === 'trailers' ? (
          <View style={styles.tabBody}>
            {['Official Trailer', 'Teaser', 'Behind the Scenes'].map((label, i) => (
              <Pressable key={label} onPress={() => play(target?.episode.id)} style={{ marginBottom: 18 }}>
                <View style={[styles.trailer, { height: ((width - 24) * 9) / 16 }]}>
                  <Image source={img.still(`${title.seed}-trailer-${i}`)} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                  <View style={styles.heroPlay}>
                    <Ionicons name="play" size={26} color={colors.text} style={{ marginLeft: 3 }} />
                  </View>
                </View>
                <Txt weight="semibold" size={14} style={{ marginTop: 8 }}>
                  {label}: {title.name}
                </Txt>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <PickerOverlay visible={seasonPicker} onClose={() => setSeasonPicker(false)}>
        <PickerList
          options={title.seasons.map((s) => `Season ${s.number}`)}
          selected={`Season ${seasonNumber}`}
          onClose={() => setSeasonPicker(false)}
          onSelect={(v) => {
            const selected = Number(v.replace('Season ', ''));
            setSeasonNumber(selected);
            void catalog.season(title.id, selected).catch(() => showToast("Could not load episodes."));
            setSeasonPicker(false);
          }}
        />
      </PickerOverlay>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  heroPlay: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroActions: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', gap: 10 },
  body: { paddingHorizontal: 12, paddingTop: 12 },
  kicker: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  maturity: { backgroundColor: colors.surface6, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2 },
  metaTag: { borderWidth: 1, borderColor: colors.textDim, borderRadius: 2, paddingHorizontal: 4, paddingVertical: 1 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  rankBadge: { width: 20, height: 26, backgroundColor: colors.red, borderRadius: 2, justifyContent: 'center' },
  cta: { marginTop: 10 },
  resume: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  actions: { flexDirection: 'row', gap: 28, marginTop: 22 },
  ratingPopover: {
    position: 'absolute',
    bottom: 52,
    left: -60,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.surface4,
    borderRadius: 40,
    padding: 6,
    elevation: 8,
  },
  ratingButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  ratingActive: { backgroundColor: colors.surface6 },
  ratingLabels: { flexDirection: 'row', justifyContent: 'space-between', width: 220, marginTop: 8 },
  tabs: { flexDirection: 'row', gap: 22, paddingHorizontal: 12, marginTop: 26, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surface5 },
  tab: { paddingBottom: 12 },
  tabIndicator: { height: 4, marginBottom: 12, backgroundColor: 'transparent' },
  tabBody: { paddingHorizontal: 12, paddingTop: 6 },
  seasonButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface4,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 14,
  },
  episode: { marginBottom: 22 },
  episodeTop: { flexDirection: 'row', alignItems: 'center' },
  still: { width: 124, height: 70, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stillPlay: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.text, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  stillProgress: { position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: 0 },
  dlIcon: { paddingLeft: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trailer: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surface2 },
});
