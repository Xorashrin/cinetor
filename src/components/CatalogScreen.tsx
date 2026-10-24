import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AVAILABLE, getTitle, type Title } from '../data/mock';
import { SECTION_LABELS, sectionFor, type CatalogSection } from '../engine/contracts';
import { engineStatus, refreshCatalog } from '../engine/runtime';
import { useRootNav } from '../navigation/types';
import { useApp } from '../state/AppState';
import { colors, layout, radius } from '../theme/tokens';
import { Button, IconButton } from './Buttons';
import { CatalogRow } from './CatalogRow';
import { Chip } from './Chip';
import { CinetorMark, Wordmark } from './Logo';
import { Txt } from './Txt';

export type CatalogKind = 'all' | 'movie' | 'series';

const subscribeToCatalog = (listener: () => void) => engineStatus.subscribe(listener);
const catalogSnapshot = () => engineStatus.getSnapshot();

export function useCatalogStatus() {
  return useSyncExternalStore(subscribeToCatalog, catalogSnapshot, catalogSnapshot);
}

export function catalogErrorCode(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code;
  return 'network';
}

export function catalogErrorMessage(error: unknown): string {
  switch (catalogErrorCode(error)) {
    case 'offline': return 'You are offline. Saved metadata is still available; connect to the internet to try again.';
    case 'configuration': return 'No metadata source is configured. Review source setup in Profiles.';
    case 'authentication': return 'The metadata source needs valid credentials. Review source setup in Profiles.';
    case 'permission':
    case 'scope': return 'This source is not available in the current access context. Review source settings.';
    case 'timeout': return 'The metadata source took too long to respond. You can try again.';
    case 'rate-limit': return 'The metadata source is limiting requests. Wait a moment before trying again.';
    case 'storage': return 'Metadata could not be saved on this device. Check available storage and try again.';
    case 'malformed':
    case 'size': return 'The metadata source returned a response that could not be used. Try again later.';
    case 'unsupported': return 'This source does not support the requested metadata operation.';
    default: return 'The metadata source could not be reached. Check your connection and try again.';
  }
}

interface NoticeProps {
  title: string;
  message: string;
  busy?: boolean;
  tone?: 'neutral' | 'error' | 'offline';
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function CatalogNotice({ title, message, busy, tone = 'neutral', actionLabel, onAction, secondaryLabel, onSecondary }: NoticeProps) {
  const icon = tone === 'offline' ? 'cloud-offline-outline' : tone === 'error' ? 'alert-circle-outline' : 'information-circle-outline';
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      <View style={styles.noticeHeading}>
        {busy ? <ActivityIndicator color={colors.accent} accessible={false} /> : <Ionicons name={icon} size={23} color={tone === 'error' ? colors.warning : colors.accent} accessible={false} />}
        <Txt weight="semibold" size={16} style={styles.flex}>{title}</Txt>
      </View>
      <Txt size={14} color={colors.textMuted} style={styles.noticeMessage}>{message}</Txt>
      {onAction || onSecondary ? (
        <View style={styles.noticeActions}>
          {onAction && actionLabel ? <Button label={actionLabel} onPress={onAction} variant="secondary" loading={busy} /> : null}
          {onSecondary && secondaryLabel ? <Button label={secondaryLabel} onPress={onSecondary} variant="outline" /> : null}
        </View>
      ) : null}
    </View>
  );
}

export interface CatalogChoice { key: string; label: string }
interface PickerProps {
  visible: boolean;
  title: string;
  choices: CatalogChoice[];
  selected: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}

export function CatalogPicker({ visible, title, choices, selected, onSelect, onClose }: PickerProps) {
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const pickerHeight = Math.min(height - insets.top - 32, 620, 104 + insets.bottom + choices.length * Math.max(56, 28 + 24 * fontScale));
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.modalRoot, { paddingTop: insets.top + 16 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filter" />
        <View style={[styles.picker, { height: Math.max(180, pickerHeight), paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal>
          <View style={styles.pickerHeader}>
            <Txt weight="bold" size={22} accessibilityRole="header" style={styles.flex}>{title}</Txt>
            <IconButton icon="close" onPress={onClose} accessibilityLabel="Close filter" />
          </View>
          <FlatList
            data={choices}
            keyExtractor={item => item.key}
            extraData={selected}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={5}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                onPress={() => { onSelect(item.key); onClose(); }}
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{ checked: selected === item.key }}
                style={({ pressed }) => [styles.choice, selected === item.key && styles.selectedChoice, pressed && styles.pressedChoice]}
              >
                <Txt size={15} color={selected === item.key ? colors.accent : colors.text} style={styles.flex}>{item.label}</Txt>
                {selected === item.key ? <Ionicons name="checkmark" size={22} color={colors.accent} accessible={false} /> : null}
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

interface FiltersProps {
  section: CatalogSection;
  titles: Title[];
  kind: CatalogKind;
  genre?: string;
  onKindChange: (kind: CatalogKind) => void;
  onGenreChange: (genre?: string) => void;
}

export function CatalogFilters({ section, titles, kind, genre, onKindChange, onGenreChange }: FiltersProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const choices = useMemo(() => {
    const genres = new Set(titles.flatMap(title => title.genres.filter(value => value.trim())));
    if (genre) genres.add(genre);
    return [{ key: '', label: 'All genres' }, ...[...genres].sort((a, b) => a.localeCompare(b)).map(value => ({ key: value, label: value }))];
  }, [titles, genre]);

  return (
    <View style={styles.filters}>
      <View style={styles.filterRow}>
        <Chip label="All" selected={kind === 'all'} solid onPress={() => onKindChange('all')} accessibilityLabel={`All ${SECTION_LABELS[section]} titles`} />
        <Chip label="Movies" selected={kind === 'movie'} solid onPress={() => onKindChange('movie')} />
        <Chip label="Series" selected={kind === 'series'} solid onPress={() => onKindChange('series')} />
        <Chip
          label={genre ?? 'Genre'}
          icon="options-outline"
          caret
          selected={!!genre}
          expanded={pickerOpen}
          onPress={() => setPickerOpen(true)}
          accessibilityLabel={`Genre filter: ${genre ?? 'all genres'}`}
        />
      </View>
      <CatalogPicker
        visible={pickerOpen}
        title={`${SECTION_LABELS[section]} genres`}
        choices={choices}
        selected={genre ?? ''}
        onSelect={value => onGenreChange(value || undefined)}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

interface CatalogScreenProps {
  section: CatalogSection;
  genre?: string;
  onGenreChange: (genre?: string) => void;
}

const SECTION_DESCRIPTIONS: Record<CatalogSection, string> = {
  home: 'Movies and series, separate from Anime, K-Drama, and Others.',
  anime: 'Titles assigned to Anime by the catalog.',
  kdrama: 'Korean dramas assigned to this section by the catalog.',
  others: 'Explicitly categorized regional titles, cartoons, and shorts.',
};

export function CatalogScreen({ section, genre, onGenreChange }: CatalogScreenProps) {
  const nav = useRootNav();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { activeProfile, catalogVersion, showToast } = useApp();
  const status = useCatalogStatus();
  const [kind, setKind] = useState<CatalogKind>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const controllerRef = useRef<AbortController | null>(null);
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<FlatList<Title>>(null);
  const gutter = Math.max(layout.gutter, (width - layout.maxContentWidth) / 2);

  const pool = useMemo(() => AVAILABLE.filter(title => title.id !== 'empty' && title.name.trim() && sectionFor(title) === section), [section, catalogVersion]);
  const items = useMemo(() => pool.filter(title => (kind === 'all' || title.kind === kind) && (!genre || title.genres.includes(genre))), [pool, kind, genre]);

  const cancelRefresh = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (deadlineRef.current) clearTimeout(deadlineRef.current);
    deadlineRef.current = undefined;
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => cancelRefresh, [cancelRefresh]));
  useEffect(() => {
    setRefreshError(undefined);
    return cancelRefresh;
  }, [activeProfile?.id, section, cancelRefresh]);
  useEffect(() => {
    if (status.state === 'ready') setRefreshError(undefined);
  }, [status.state, status.updatedAt]);

  const refresh = useCallback(() => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setRefreshing(true);
    setRefreshError(undefined);
    deadlineRef.current = setTimeout(() => {
      if (controllerRef.current !== controller) return;
      controller.abort();
      controllerRef.current = null;
      deadlineRef.current = undefined;
      setRefreshing(false);
      setRefreshError('timeout');
    }, 20000);
    void refreshCatalog(section, controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRefreshError(catalogErrorCode(error));
      })
      .finally(() => {
        if (controllerRef.current === controller) {
          if (deadlineRef.current) clearTimeout(deadlineRef.current);
          deadlineRef.current = undefined;
          controllerRef.current = null;
          setRefreshing(false);
        }
      });
  }, [section]);

  const openTitle = useCallback((item: Title) => {
    const current = getTitle(item.id);
    if (!current || current.id !== item.id || sectionFor(current) !== section) {
      showToast('This title is no longer in this section. Refresh the catalog to continue.');
      return;
    }
    nav.navigate('Title', { id: current.id });
  }, [nav, section, showToast]);
  const renderItem = useCallback<ListRenderItem<Title>>(({ item }) => <CatalogRow title={item} onPress={openTitle} />, [openTitle]);

  const changeKind = (value: CatalogKind) => { setKind(value); listRef.current?.scrollToOffset({ offset: 0, animated: false }); };
  const changeGenre = (value?: string) => { onGenreChange(value); listRef.current?.scrollToOffset({ offset: 0, animated: false }); };
  const busy = refreshing || (!refreshError && (status.state === 'initializing' || status.state === 'loading'));
  const issue = refreshError ?? (status.state === 'offline' ? 'offline' : status.state === 'error' ? status.lastError ?? 'network' : undefined);
  const hasFilters = kind !== 'all' || !!genre;
  const openProviders = () => nav.navigate('Providers');

  const emptyState = pool.length && hasFilters ? (
    <CatalogNotice title="No matching titles" message="No saved titles in this section match these filters. Try a different genre or content type." actionLabel="Clear filters" onAction={() => { setKind('all'); onGenreChange(undefined); }} />
  ) : busy ? (
    <CatalogNotice title={status.state === 'initializing' ? 'Opening your catalog' : 'Updating metadata'} message="Titles will appear as metadata becomes available." busy />
  ) : issue ? (
    <CatalogNotice title={issue === 'offline' ? 'No saved titles for this section' : 'Catalog unavailable'} message={catalogErrorMessage(issue)} tone={issue === 'offline' ? 'offline' : 'error'} actionLabel="Try again" onAction={refresh} secondaryLabel="Source settings" onSecondary={openProviders} />
  ) : (
    <CatalogNotice title={`No ${SECTION_LABELS[section]} titles yet`} message="This section has no catalog metadata. Refresh it or review your configured sources. Playback availability is checked separately." actionLabel="Refresh catalog" onAction={refresh} secondaryLabel="Source settings" onSecondary={openProviders} />
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.topBar, { paddingLeft: gutter + insets.left, paddingRight: gutter + insets.right }]}>
        <View style={styles.brand}><CinetorMark size={36} /><Wordmark size={25} /></View>
        <IconButton icon="search-outline" onPress={() => nav.navigate('Search', { section })} accessibilityLabel={`Search ${SECTION_LABELS[section]}`} style={styles.searchAction} />
      </View>
      <FlatList
        ref={listRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingLeft: gutter + insets.left, paddingRight: gutter + insets.right, paddingBottom: 28, flexGrow: 1 }}
        ItemSeparatorComponent={CatalogSeparator}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surface2} />}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Txt size={12} weight="semibold" color={colors.accent} spacing={1.4} style={styles.eyebrow}>YOUR CATALOG</Txt>
            <Txt weight="bold" size={32} accessibilityRole="header">{SECTION_LABELS[section]}</Txt>
            <Txt size={14} color={colors.textMuted} style={styles.description}>{SECTION_DESCRIPTIONS[section]}</Txt>
            <CatalogFilters section={section} titles={pool} kind={kind} genre={genre} onKindChange={changeKind} onGenreChange={changeGenre} />
            {pool.length > 0 && (busy || issue) ? (
              <CatalogNotice
                title={busy ? 'Updating metadata' : issue === 'offline' ? 'Browsing saved metadata' : 'Could not update metadata'}
                message={busy ? 'Your saved catalog stays available while the update runs.' : catalogErrorMessage(issue)}
                busy={busy}
                tone={issue === 'offline' ? 'offline' : issue ? 'error' : 'neutral'}
                actionLabel={busy ? undefined : 'Try again'}
                onAction={busy ? undefined : refresh}
              />
            ) : null}
            <View style={styles.listSummary}>
              <Txt size={13} color={colors.textMuted} style={styles.flex}>{items.length} {items.length === 1 ? 'title' : 'titles'}</Txt>
              <Txt size={12} color={colors.textDim}>Metadata catalog</Txt>
            </View>
          </View>
        }
        ListEmptyComponent={emptyState}
      />
    </View>
  );
}

export function CatalogSeparator() { return <View style={styles.separator} />; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  topBar: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  searchAction: { backgroundColor: colors.surface1, borderColor: colors.borderSubtle },
  listHeader: { paddingTop: 24, paddingBottom: 12 },
  eyebrow: { marginBottom: 6 },
  description: { marginTop: 6, maxWidth: 580 },
  filters: { marginTop: 20, marginBottom: 16 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  listSummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8 },
  separator: { height: 10 },
  notice: { backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.borderSubtle, borderRadius: radius.lg, padding: 18 },
  noticeHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noticeMessage: { marginTop: 10 },
  noticeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  modalRoot: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end', paddingHorizontal: 16 },
  picker: { width: '100%', maxWidth: 640, maxHeight: '85%', alignSelf: 'center', backgroundColor: colors.surface1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: colors.borderSubtle, paddingHorizontal: 16 },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  choice: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.md, marginBottom: 4 },
  selectedChoice: { backgroundColor: colors.accentSoft },
  pressedChoice: { backgroundColor: colors.surface3 },
});
