import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, TextInput, View, useWindowDimensions, type ListRenderItem } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../components/Buttons';
import { CatalogRow } from '../components/CatalogRow';
import { CatalogFilters, CatalogNotice, CatalogPicker, CatalogSeparator, catalogErrorCode, catalogErrorMessage, useCatalogStatus, type CatalogKind } from '../components/CatalogScreen';
import { Chip } from '../components/Chip';
import { Txt } from '../components/Txt';
import { AVAILABLE, getTitle, type Title } from '../data/mock';
import { SECTION_LABELS, sectionFor, type CatalogSection } from '../engine/contracts';
import { catalog } from '../engine/runtime';
import type { RootStackParamList } from '../navigation/types';
import { searchTitles } from '../providers/search';
import { useApp } from '../state/AppState';
import { colors, font, layout, radius } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Search'>;
type SearchSort = 'relevance' | 'newest' | 'title';
interface SearchPreferences { query: string; kind: CatalogKind; genre?: string; sort: SearchSort }
interface SearchRequest { key: string; phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'error'; ids: string[]; error?: string }

const SECTIONS: CatalogSection[] = ['home', 'anime', 'kdrama', 'others'];
const SORTS: { key: SearchSort; label: string }[] = [{ key: 'relevance', label: 'Best match' }, { key: 'newest', label: 'Newest year' }, { key: 'title', label: 'Title A–Z' }];
// Session-only preferences never mix profiles or sections and are not a search-history export.
const savedSearch = new Map<string, SearchPreferences>();

function searchSection(value: CatalogSection | undefined): CatalogSection {
  return value && SECTIONS.includes(value) ? value : 'home';
}

export default function SearchScreen({ navigation, route }: Props) {
  const { activeProfile } = useApp();
  const section = searchSection(route.params?.section);
  const preferenceKey = `${activeProfile?.id ?? 'local'}:${section}`;
  return <SectionSearch key={preferenceKey} section={section} preferenceKey={preferenceKey} navigation={navigation} />;
}

function SectionSearch({ section, preferenceKey, navigation }: { section: CatalogSection; preferenceKey: string; navigation: Props['navigation'] }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const focused = useIsFocused();
  const { catalogVersion, showToast } = useApp();
  const status = useCatalogStatus();
  const [preferences, setPreferences] = useState<SearchPreferences>(() => savedSearch.get(preferenceKey) ?? { query: '', kind: 'all', sort: 'relevance' });
  const [remote, setRemote] = useState<SearchRequest>({ key: '', phase: 'idle', ids: [] });
  const [retry, setRetry] = useState(0);
  const [sectionPicker, setSectionPicker] = useState(false);
  const [sortPicker, setSortPicker] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<Title>>(null);
  const query = preferences.query.trim();
  const requestKey = `${preferenceKey}:${query}`;
  const gutter = Math.max(layout.gutter, (width - layout.maxContentWidth) / 2);

  useEffect(() => {
    savedSearch.delete(preferenceKey);
    savedSearch.set(preferenceKey, preferences);
    if (savedSearch.size > 40) {
      const oldest = savedSearch.keys().next().value;
      if (oldest !== undefined) savedSearch.delete(oldest);
    }
  }, [preferenceKey, preferences]);

  useEffect(() => {
    if (!focused || query.length < 2) return;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    setRemote({ key: requestKey, phase: 'waiting', ids: [] });
    const debounce = setTimeout(() => {
      if (controller.signal.aborted) return;
      setRemote({ key: requestKey, phase: 'loading', ids: [] });
      deadline = setTimeout(() => {
        controller.abort();
        setRemote({ key: requestKey, phase: 'error', ids: [], error: 'timeout' });
      }, 20000);
      void catalog.search(query, controller.signal)
        .then(titles => {
          if (!controller.signal.aborted) {
            setRemote({ key: requestKey, phase: 'ready', ids: titles.filter(title => sectionFor(title) === section).map(title => title.id) });
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setRemote({ key: requestKey, phase: 'error', ids: [], error: catalogErrorCode(error) });
        })
        .finally(() => { if (deadline) clearTimeout(deadline); });
    }, 300);
    return () => { clearTimeout(debounce); if (deadline) clearTimeout(deadline); controller.abort(); };
  }, [query, requestKey, section, retry, focused]);

  useEffect(() => { listRef.current?.scrollToOffset({ offset: 0, animated: false }); }, [query, preferences.kind, preferences.genre, preferences.sort]);

  const pool = useMemo(() => AVAILABLE.filter(title => title.id !== 'empty' && title.name.trim() && sectionFor(title) === section), [section, catalogVersion]);
  const results = useMemo(() => {
    if (!query) return [];
    const local = searchTitles(pool, query, preferences.sort);
    const remoteIds = new Set(remote.key === requestKey ? remote.ids : []);
    const combined = new Map(local.map(title => [title.id, title]));
    for (const title of pool) if (remoteIds.has(title.id) && !combined.has(title.id)) combined.set(title.id, title);
    const filtered = [...combined.values()].filter(title => (preferences.kind === 'all' || title.kind === preferences.kind) && (!preferences.genre || title.genres.includes(preferences.genre)));
    if (preferences.sort === 'title') filtered.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    if (preferences.sort === 'newest') filtered.sort((a, b) => (Number.isFinite(b.year) ? b.year : 0) - (Number.isFinite(a.year) ? a.year : 0) || a.name.localeCompare(b.name));
    return filtered;
  }, [pool, query, preferences.kind, preferences.genre, preferences.sort, remote, requestKey]);

  const openTitle = useCallback((item: Title) => {
    const current = getTitle(item.id);
    if (!current || current.id !== item.id || sectionFor(current) !== section) {
      showToast('This title is no longer in this section. Search again to refresh the results.');
      return;
    }
    Keyboard.dismiss();
    navigation.navigate('Title', { id: current.id });
  }, [navigation, section, showToast]);
  const renderItem = useCallback<ListRenderItem<Title>>(({ item }) => <CatalogRow title={item} onPress={openTitle} />, [openTitle]);
  const patch = (value: Partial<SearchPreferences>) => setPreferences(current => ({ ...current, ...value }));
  const currentRequest = remote.key === requestKey ? remote : undefined;
  const pending = query.length >= 2 && focused && (!currentRequest || currentRequest.phase === 'waiting' || currentRequest.phase === 'loading');
  const error = currentRequest?.phase === 'error' ? currentRequest.error ?? 'network' : undefined;
  const hasFilters = preferences.kind !== 'all' || !!preferences.genre;

  let emptyState: React.ReactNode;
  if (!query) {
    emptyState = <CatalogNotice title={`Search ${SECTION_LABELS[section]}`} message="Enter a title, genre, or a name from the available credits. Results stay within this section. Source search begins after two characters." />;
  } else if (pending) {
    emptyState = <CatalogNotice title="Searching metadata" message={`Looking for matches in ${SECTION_LABELS[section]}. Playback availability is checked separately.`} busy />;
  } else if (error) {
    emptyState = <CatalogNotice title="Search could not finish" message={catalogErrorMessage(error)} tone={error === 'offline' ? 'offline' : 'error'} actionLabel="Try again" onAction={() => setRetry(value => value + 1)} secondaryLabel="Source settings" onSecondary={() => navigation.navigate('Providers')} />;
  } else if (query.length < 2) {
    emptyState = <CatalogNotice title="Keep typing" message="Enter at least two characters to search configured metadata sources. Local matches appear as you type." />;
  } else {
    emptyState = <CatalogNotice title="No matching titles" message={`No ${SECTION_LABELS[section]} metadata matches this search${hasFilters ? ' and these filters' : ''}. Try another title or search term.`} actionLabel={hasFilters ? 'Clear filters' : undefined} onAction={hasFilters ? () => patch({ kind: 'all', genre: undefined }) : undefined} />;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={[styles.topBar, { paddingLeft: gutter + insets.left - 8, paddingRight: gutter + insets.right }]}>
        <IconButton icon="arrow-back" onPress={() => navigation.goBack()} accessibilityLabel="Close search" />
        <Txt weight="bold" size={22} accessibilityRole="header" style={styles.flex}>Search</Txt>
        <Chip label={SECTION_LABELS[section]} caret onPress={() => { Keyboard.dismiss(); setSectionPicker(true); }} expanded={sectionPicker} accessibilityLabel={`Search section: ${SECTION_LABELS[section]}. Change section`} />
      </View>
      <View style={[styles.searchBox, inputFocused && styles.searchFocused, { marginLeft: gutter + insets.left, marginRight: gutter + insets.right }]}>
        <Ionicons name="search-outline" size={22} color={colors.textMuted} accessible={false} />
        <TextInput
          ref={inputRef}
          value={preferences.query}
          onChangeText={value => patch({ query: value })}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={200}
          placeholder={`Search ${SECTION_LABELS[section]}`}
          placeholderTextColor={colors.textDim}
          selectionColor={colors.accent}
          accessibilityLabel={`Search ${SECTION_LABELS[section]}`}
          accessibilityHint="Searches this section only. Enter at least two characters for online metadata."
          style={styles.input}
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
        />
        {preferences.query ? <IconButton icon="close" accessibilityLabel="Clear search" onPress={() => { patch({ query: '' }); inputRef.current?.focus(); }} /> : null}
      </View>
      <FlatList
        ref={listRef}
        data={results}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingLeft: gutter + insets.left, paddingRight: gutter + insets.right, paddingBottom: insets.bottom + 28, flexGrow: 1 }}
        ItemSeparatorComponent={CatalogSeparator}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <CatalogFilters section={section} titles={pool} kind={preferences.kind} genre={preferences.genre} onKindChange={kind => patch({ kind })} onGenreChange={genre => patch({ genre })} />
            <View style={styles.resultHeading}>
              <Txt size={13} color={colors.textMuted} style={styles.flex} accessibilityLiveRegion="polite">{query ? `${results.length} ${results.length === 1 ? 'result' : 'results'} in ${SECTION_LABELS[section]}` : `${SECTION_LABELS[section]} only`}</Txt>
              <Chip label={SORTS.find(value => value.key === preferences.sort)?.label ?? 'Best match'} icon="swap-vertical-outline" onPress={() => setSortPicker(true)} expanded={sortPicker} accessibilityLabel="Sort search results" />
            </View>
            {results.length > 0 && (pending || error) ? (
              <View style={styles.status}>
                <CatalogNotice title={pending ? 'Searching sources' : 'Showing available matches'} message={pending ? 'Local matches are ready. Source search is still in progress.' : catalogErrorMessage(error)} busy={pending} tone={error === 'offline' ? 'offline' : error ? 'error' : 'neutral'} actionLabel={error ? 'Try again' : undefined} onAction={error ? () => setRetry(value => value + 1) : undefined} />
              </View>
            ) : !query && status.state === 'offline' ? <View style={styles.status}><CatalogNotice title="Offline" message="You can search saved metadata. Online search needs an internet connection." tone="offline" /></View> : null}
          </View>
        }
        ListEmptyComponent={emptyState}
      />
      <CatalogPicker visible={sectionPicker} title="Search section" choices={SECTIONS.map(value => ({ key: value, label: SECTION_LABELS[value] }))} selected={section} onSelect={value => navigation.setParams({ section: value as CatalogSection })} onClose={() => setSectionPicker(false)} />
      <CatalogPicker visible={sortPicker} title="Sort results" choices={SORTS} selected={preferences.sort} onSelect={value => patch({ sort: value as SearchSort })} onClose={() => setSortPicker(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  topBar: { minHeight: layout.headerHeight, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingVertical: 8 },
  searchBox: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingLeft: 14, paddingRight: 4 },
  searchFocused: { borderColor: colors.accent },
  input: { flex: 1, minWidth: 0, minHeight: 54, paddingVertical: 14, color: colors.text, fontFamily: font.regular, fontSize: 16 },
  listHeader: { paddingBottom: 12 },
  resultHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  status: { marginTop: 12 },
});
