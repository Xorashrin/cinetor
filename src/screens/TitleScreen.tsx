import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, Share, StyleSheet, View, useWindowDimensions, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton, ProgressBar } from '../components/Buttons';
import { CatalogArtwork, titleMetadata } from '../components/CatalogRow';
import { CatalogNotice, CatalogPicker, CatalogSeparator, catalogErrorCode, catalogErrorMessage } from '../components/CatalogScreen';
import { Chip } from '../components/Chip';
import { Txt } from '../components/Txt';
import { getTitle, type Episode, type Title } from '../data/mock';
import { sectionFor } from '../engine/contracts';
import { catalog } from '../engine/runtime';
import type { RootStackParamList } from '../navigation/types';
import { downloadFor, progressFor, useApp } from '../state/AppState';
import { colors, layout, radius } from '../theme/tokens';
import { formatClock } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Title'>;
interface MetadataRequest { key: string; phase: 'loading' | 'ready' | 'error'; error?: string }

function seasonLabel(number: number): string { return number === 0 ? 'Specials (season 0)' : `Season ${number}`; }

function DownloadAction({ titleId, episodeId, onManage }: { titleId: string; episodeId?: string; onManage: () => void }) {
  const { profileData, startDownload, activeProfile } = useApp();
  const entry = downloadFor(profileData, titleId, episodeId);
  const status = entry?.status;
  const isExisting = !!entry && status !== 'failed';
  const label = status === 'downloaded' ? 'Manage download'
    : status === 'queued' ? 'Download queued'
      : status === 'paused' ? 'Download paused'
        : status === 'downloading' ? 'View download'
          : status === 'failed' ? 'Retry download check' : 'Check & download';
  return (
    <Button
      label={label}
      icon={isExisting ? 'download' : 'download-outline'}
      variant="secondary"
      disabled={!activeProfile}
      onPress={() => isExisting ? onManage() : startDownload(titleId, 0, episodeId)}
      accessibilityHint={isExisting ? 'Opens your downloads' : 'Looks for a downloadable source and starts a download only if one is available. File size may be unknown.'}
    />
  );
}

const EpisodeRow = memo(function EpisodeRow({ title, episode, seasonNumber, onOpen, onManage }: { title: Title; episode: Episode; seasonNumber: number; onOpen: (episodeId?: string) => void; onManage: () => void }) {
  const { profileData } = useApp();
  const { width, fontScale } = useWindowDimensions();
  const progress = progressFor(profileData, title.id, episode.id);
  const savedPosition = progress && Number.isFinite(progress.position) && progress.position > 0 ? progress.position : undefined;
  const duration = progress && Number.isFinite(progress.duration) && progress.duration > 0 ? progress.duration : undefined;
  const local = downloadFor(profileData, title.id, episode.id);
  const hasLocalFile = local?.status === 'downloaded' && !!local.localUri;
  const compact = width < 380 || fontScale > 1.3;
  return (
    <View style={styles.episode}>
      <View style={styles.episodeHeading}>
        {!compact ? <CatalogArtwork uri={episode.posterUrl} identity={episode.id} style={styles.episodeImage} /> : null}
        <View style={styles.flex}>
          <Txt size={12} color={colors.accent} weight="semibold">S{seasonNumber} · E{episode.number}</Txt>
          <Txt weight="semibold" size={17} style={styles.episodeTitle}>{episode.name}</Txt>
          <Txt size={12} color={colors.textDim} style={styles.episodeTitle}>{Number.isFinite(episode.runtime) && episode.runtime > 0 ? `${Math.round(episode.runtime)} min` : 'Runtime not provided'}</Txt>
        </View>
      </View>
      {episode.synopsis?.trim() ? <Txt size={14} color={colors.textMuted} style={styles.paragraph}>{episode.synopsis}</Txt> : null}
      {savedPosition !== undefined ? (
        <View style={styles.episodeProgress}>
          <Txt size={12} color={colors.textMuted}>Saved position · {formatClock(savedPosition)}{duration !== undefined ? ` of ${formatClock(duration)}` : ''}</Txt>
          {duration !== undefined ? <ProgressBar value={savedPosition / duration} style={styles.progress} /> : null}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label={hasLocalFile ? 'Open downloaded file' : 'Check sources'} icon={hasLocalFile ? 'folder-open-outline' : 'search-outline'} onPress={() => onOpen(episode.id)} accessibilityLabel={`${hasLocalFile ? 'Open downloaded file' : 'Check sources'} for season ${seasonNumber}, episode ${episode.number}, ${episode.name}`} />
        <DownloadAction titleId={title.id} episodeId={episode.id} onManage={onManage} />
      </View>
    </View>
  );
});

export default function TitleScreen({ navigation, route }: Props) {
  const { activeProfile } = useApp();
  return <TitleDetails key={`${activeProfile?.id ?? 'local'}:${route.params.id}`} id={route.params.id} navigation={navigation} />;
}

function TitleDetails({ id, navigation }: { id: string; navigation: Props['navigation'] }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const focused = useIsFocused();
  const { activeProfile, profileData, toggleMyList, rate, showToast, catalogVersion } = useApp();
  const [detailRequest, setDetailRequest] = useState<MetadataRequest>({ key: id, phase: 'loading' });
  const [seasonRequest, setSeasonRequest] = useState<MetadataRequest>();
  const [detailRetry, setDetailRetry] = useState(0);
  const [seasonRetry, setSeasonRetry] = useState(0);
  const [selectedSeason, setSelectedSeason] = useState<number>();
  const [seasonPicker, setSeasonPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const gutter = Math.max(layout.gutter, (width - layout.maxContentWidth) / 2);

  const title = useMemo(() => {
    const current = getTitle(id);
    return current && current.id === id && current.id !== 'empty' && current.name.trim() && sectionFor(current) !== undefined ? current : undefined;
  }, [id, catalogVersion]);
  const seasons = useMemo(() => (title?.seasons ?? []).filter(season => Number.isInteger(season.number) && season.number >= 0).slice().sort((a, b) => a.number - b.number), [title]);
  const season = seasons.find(value => value.number === selectedSeason) ?? seasons.find(value => value.number > 0) ?? seasons[0];
  const seasonNumber = season?.number;
  const seasonKey = seasonNumber === undefined ? '' : `${id}:s${seasonNumber}`;
  const episodes = useMemo(() => (season?.episodes ?? []).filter(episode => episode.id && Number.isInteger(episode.number) && episode.number >= 0).slice().sort((a, b) => a.number - b.number), [season]);

  useEffect(() => {
    if (!focused) return;
    const controller = new AbortController();
    setDetailRequest({ key: id, phase: 'loading' });
    const deadline = setTimeout(() => {
      controller.abort();
      setDetailRequest({ key: id, phase: 'error', error: 'timeout' });
    }, 20000);
    void catalog.detail(id, controller.signal)
      .then(() => { if (!controller.signal.aborted) setDetailRequest({ key: id, phase: 'ready' }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setDetailRequest({ key: id, phase: 'error', error: catalogErrorCode(error) }); })
      .finally(() => clearTimeout(deadline));
    return () => { controller.abort(); clearTimeout(deadline); };
  }, [id, detailRetry, focused]);

  const detailPending = detailRequest.phase === 'loading';
  useEffect(() => {
    if (!focused || detailPending || seasonNumber === undefined || title?.kind !== 'series') return;
    const controller = new AbortController();
    setSeasonRequest({ key: seasonKey, phase: 'loading' });
    const deadline = setTimeout(() => {
      controller.abort();
      setSeasonRequest({ key: seasonKey, phase: 'error', error: 'timeout' });
    }, 20000);
    void catalog.season(id, seasonNumber, controller.signal)
      .then(() => { if (!controller.signal.aborted) setSeasonRequest({ key: seasonKey, phase: 'ready' }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setSeasonRequest({ key: seasonKey, phase: 'error', error: catalogErrorCode(error) }); })
      .finally(() => clearTimeout(deadline));
    return () => { controller.abort(); clearTimeout(deadline); };
  }, [id, seasonNumber, seasonKey, title?.kind, detailPending, seasonRetry, focused]);

  const openPlayer = useCallback((episodeId?: string) => {
    const current = getTitle(id);
    if (!current || current.id !== id || sectionFor(current) === undefined) {
      showToast('This title is no longer available in the catalog.');
      return;
    }
    if (current.kind === 'series' && (!episodeId || !current.seasons.some(value => value.episodes.some(episode => episode.id === episodeId)))) {
      showToast('Choose an episode from the available metadata before checking sources.');
      return;
    }
    navigation.navigate('Player', { id, episodeId });
  }, [id, navigation, showToast]);
  const openDownloads = useCallback(() => navigation.navigate('Downloads'), [navigation]);
  const renderEpisode = useCallback<ListRenderItem<Episode>>(({ item }) => title && seasonNumber !== undefined ? <EpisodeRow title={title} episode={item} seasonNumber={seasonNumber} onOpen={openPlayer} onManage={openDownloads} /> : null, [title, seasonNumber, openPlayer, openDownloads]);

  const inList = profileData.myList.includes(id);
  const movieProgress = title?.kind === 'movie' ? progressFor(profileData, id, undefined) : undefined;
  const movieDownload = title?.kind === 'movie' ? downloadFor(profileData, id) : undefined;
  const hasMovieFile = movieDownload?.status === 'downloaded' && !!movieDownload.localUri;
  const activeSeasonRequest = seasonRequest?.key === seasonKey ? seasonRequest : undefined;
  const episodesPending = title?.kind === 'series' && (detailPending || (seasonNumber !== undefined && (!activeSeasonRequest || activeSeasonRequest.phase === 'loading')));
  const detailError = detailRequest.phase === 'error' ? detailRequest.error : undefined;
  const episodeError = activeSeasonRequest?.phase === 'error' ? activeSeasonRequest.error : undefined;

  const shareTitle = () => {
    if (title) void Share.share({ message: `${title.name}${title.year > 0 ? ` (${title.year})` : ''} — catalog details in Cinetor.` }).catch(() => showToast('The share menu could not be opened.'));
  };

  const emptyEpisodes = title?.kind !== 'series' ? null : episodesPending ? (
    <CatalogNotice title="Loading episode metadata" message="Only episodes supplied by the catalog are listed." busy />
  ) : episodeError ? (
    <CatalogNotice title="Episodes could not be loaded" message={catalogErrorMessage(episodeError)} tone={episodeError === 'offline' ? 'offline' : 'error'} actionLabel="Try again" onAction={() => setSeasonRetry(value => value + 1)} />
  ) : (
    <CatalogNotice title={seasonNumber === undefined ? 'No season metadata' : 'No episode metadata'} message="The catalog has not supplied episodes for this selection. Cinetor does not generate episode names or numbering from a count." actionLabel="Refresh details" onAction={() => setDetailRetry(value => value + 1)} />
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.topBar, { paddingLeft: gutter + insets.left - 8, paddingRight: gutter + insets.right - 8 }]}>
        <IconButton icon="arrow-back" onPress={() => navigation.goBack()} accessibilityLabel="Go back" />
        <Txt weight="semibold" size={17} style={styles.flex}>Title details</Txt>
        {title ? <IconButton icon="share-outline" onPress={shareTitle} accessibilityLabel={`Share ${title.name}`} /> : null}
      </View>
      {!title ? (
        <ScrollView contentContainerStyle={{ paddingLeft: gutter + insets.left, paddingRight: gutter + insets.right, paddingTop: 24, paddingBottom: insets.bottom + 24 }}>
          <CatalogNotice title={detailPending ? 'Loading title metadata' : 'Title unavailable'} message={detailPending ? 'Retrieving details from the catalog.' : detailError ? catalogErrorMessage(detailError) : 'This title is not present in the available catalog. It may have been removed or may not belong to a supported section.'} busy={detailPending} tone={detailError === 'offline' ? 'offline' : detailError ? 'error' : 'neutral'} actionLabel={detailPending ? undefined : 'Try again'} onAction={detailPending ? undefined : () => setDetailRetry(value => value + 1)} />
        </ScrollView>
      ) : (
        <FlatList
          data={title.kind === 'series' ? episodes : []}
          renderItem={renderEpisode}
          keyExtractor={item => item.id}
          initialNumToRender={5}
          maxToRenderPerBatch={5}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingLeft: gutter + insets.left, paddingRight: gutter + insets.right, paddingTop: 12, paddingBottom: insets.bottom + 32 }}
          ItemSeparatorComponent={CatalogSeparator}
          ListHeaderComponent={
            <View>
              <CatalogArtwork uri={title.backdropUrl ?? title.posterUrl} identity={title.id} style={styles.hero} />
              <View style={styles.titleBlock}>
                <Txt size={12} weight="semibold" color={colors.accent} spacing={1.2}>CATALOG DETAILS</Txt>
                <Txt weight="bold" size={30} accessibilityRole="header" style={styles.name}>{title.name}</Txt>
                <Txt size={14} color={colors.textMuted} style={styles.paragraph}>{titleMetadata(title)}</Txt>
                {title.genres.length ? <Txt size={13} color={colors.textDim} style={styles.genre}>{title.genres.join(' · ')}</Txt> : null}
              </View>
              <View style={styles.availability}>
                <Ionicons name="information-circle-outline" size={22} color={colors.accent} accessible={false} />
                <Txt size={13} color={colors.textMuted} style={styles.flex}>Metadata only. Playback availability has not been verified. Checking sources may open the player, but a working stream is not guaranteed.</Txt>
              </View>
              {detailPending || detailError ? <View style={styles.status}><CatalogNotice title={detailPending ? 'Updating title metadata' : 'Showing saved details'} message={detailPending ? 'Available details remain visible while the update runs.' : catalogErrorMessage(detailError)} busy={detailPending} tone={detailError === 'offline' ? 'offline' : detailError ? 'error' : 'neutral'} actionLabel={detailError ? 'Try again' : undefined} onAction={detailError ? () => setDetailRetry(value => value + 1) : undefined} /></View> : null}
              <View style={styles.actions}>
                {title.kind === 'movie' ? <Button label={hasMovieFile ? 'Open downloaded file' : 'Check sources'} icon={hasMovieFile ? 'folder-open-outline' : 'search-outline'} onPress={() => openPlayer()} /> : null}
                <Button label={inList ? 'Saved to My List' : 'Save to My List'} icon={inList ? 'checkmark' : 'add'} variant="secondary" disabled={!activeProfile} onPress={() => { toggleMyList(id); showToast(inList ? 'Removed from My List' : 'Saved to My List'); }} />
                {title.kind === 'movie' ? <DownloadAction titleId={id} onManage={openDownloads} /> : null}
              </View>
              {title.kind === 'movie' && movieProgress && Number.isFinite(movieProgress.position) && movieProgress.position > 0 ? (
                <View style={styles.episodeProgress}>
                  <Txt size={12} color={colors.textMuted}>Saved position · {formatClock(movieProgress.position)}</Txt>
                  {Number.isFinite(movieProgress.duration) && movieProgress.duration > 0 ? <ProgressBar value={movieProgress.position / movieProgress.duration} style={styles.progress} /> : null}
                </View>
              ) : null}
              <View style={styles.infoCard}>
                <Txt weight="bold" size={18}>Your rating</Txt>
                <Txt size={13} color={colors.textMuted} style={styles.paragraph}>Saved to this profile only. This is not a public score.</Txt>
                <View style={styles.actions}>
                  {([{ value: 'down', label: 'Not for me' }, { value: 'up', label: 'Liked it' }, { value: 'love', label: 'Loved it' }] as const).map(option => (
                    <Chip key={option.value} label={option.label} selected={profileData.ratings[id] === option.value} disabled={!activeProfile} onPress={() => {
                      const next = profileData.ratings[id] === option.value ? null : option.value;
                      rate(id, next);
                      showToast(next ? 'Rating saved to this profile' : 'Rating removed');
                    }} />
                  ))}
                </View>
              </View>
              <View style={styles.infoCard}>
                <Txt weight="bold" size={18}>Overview</Txt>
                <Txt size={15} color={colors.textMuted} numberOfLines={expanded ? undefined : 5} style={styles.paragraph}>{title.synopsis?.trim() || 'No synopsis has been supplied for this title.'}</Txt>
                {title.synopsis?.trim() ? <Button label={expanded ? 'Show less' : 'Read full overview'} variant="outline" onPress={() => setExpanded(value => !value)} style={styles.expand} /> : null}
                <View style={styles.facts}>
                  <MetadataFact label="Release year" value={Number.isFinite(title.year) && title.year > 0 ? String(title.year) : 'Not provided'} />
                  <MetadataFact label={title.kind === 'series' ? 'Episode runtime' : 'Runtime'} value={Number.isFinite(title.runtime) && title.runtime > 0 ? `${Math.round(title.runtime)} min` : 'Not provided'} />
                  <MetadataFact label="Age rating" value={title.maturity && title.maturity !== 'UNRATED' ? title.maturity : 'Not provided'} />
                  {title.cast.length ? <MetadataFact label="Cast" value={title.cast.join(', ')} /> : null}
                  {title.creators.length ? <MetadataFact label="Creators" value={title.creators.join(', ')} /> : null}
                </View>
              </View>
              <Txt size={12} color={colors.textDim} style={styles.downloadNote}>Downloads start only when a supported downloadable source is found. File size is unknown until the source reports it.</Txt>
              {title.kind === 'series' ? (
                <View style={styles.episodesHeader}>
                  <Txt weight="bold" size={22} accessibilityRole="header" style={styles.flex}>Episodes</Txt>
                  {seasonNumber !== undefined ? <Chip label={seasonLabel(seasonNumber)} caret expanded={seasonPicker} onPress={() => setSeasonPicker(true)} accessibilityLabel={`Choose season. Current: ${seasonLabel(seasonNumber)}`} /> : null}
                  <Txt size={13} color={colors.textMuted} style={styles.fullWidth}>{episodes.length > 0 ? `${episodes.length} ${episodes.length === 1 ? 'episode' : 'episodes'} loaded · Choose an episode to check sources.` : 'Episode availability is checked individually.'}</Txt>
                  {episodes.length > 0 && (episodesPending || episodeError) ? <View style={styles.fullWidth}><CatalogNotice title={episodesPending ? 'Updating episodes' : 'Showing saved episodes'} message={episodesPending ? 'Existing episode metadata remains available.' : catalogErrorMessage(episodeError)} busy={episodesPending} tone={episodeError === 'offline' ? 'offline' : episodeError ? 'error' : 'neutral'} actionLabel={episodeError ? 'Try again' : undefined} onAction={episodeError ? () => setSeasonRetry(value => value + 1) : undefined} /></View> : null}
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={emptyEpisodes}
        />
      )}
      <CatalogPicker visible={seasonPicker} title="Choose season" choices={seasons.map(value => ({ key: String(value.number), label: seasonLabel(value.number) }))} selected={seasonNumber === undefined ? '' : String(seasonNumber)} onSelect={value => setSelectedSeason(Number(value))} onClose={() => setSeasonPicker(false)} />
    </View>
  );
}

function MetadataFact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}><Txt size={12} color={colors.textDim}>{label}</Txt><Txt size={14} style={styles.factValue}>{value}</Txt></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  fullWidth: { width: '100%' },
  topBar: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  hero: { width: '100%', aspectRatio: 16 / 9, borderRadius: radius.xl },
  titleBlock: { marginTop: 24 },
  name: { marginTop: 8 },
  paragraph: { marginTop: 12 },
  genre: { marginTop: 6 },
  availability: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 16, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.lg, backgroundColor: colors.surface1, marginTop: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  status: { marginTop: 12 },
  infoCard: { marginTop: 24, padding: 20, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.lg, backgroundColor: colors.surface0 },
  expand: { alignSelf: 'flex-start', marginTop: 14 },
  facts: { marginTop: 12 },
  fact: { marginTop: 14 },
  factValue: { marginTop: 4 },
  downloadNote: { marginTop: 18 },
  episodesHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 28, marginBottom: 16 },
  episode: { padding: 18, backgroundColor: colors.surface0, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSubtle },
  episodeHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  episodeTitle: { marginTop: 5 },
  episodeImage: { width: 96, height: 60 },
  episodeProgress: { marginTop: 16 },
  progress: { marginTop: 8 },
});
