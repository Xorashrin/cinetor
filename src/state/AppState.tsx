import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import * as ExpoNetwork from 'expo-network';

import { getTitle, type PlaybackSourceRef, type Profile } from '../data/mock';
import { transferPool } from '../engine/coordinator';
import { catalog, resolvePlayback, releasePlaybackSources, cancelEngineSessions } from '../engine/runtime';
import { useEngine } from '../engine/useEngine';
import { cancelDownload, deleteDownload as deleteNativeDownload, deleteLocalFile, downloadKey, downloadVideo, getDownloads, queryDownload, setDownloadPolicy, subscribeDownloadUpdates, type DownloadContainer, type NativeDownload } from '../services/downloads';
import { removeOwnedDownload } from './downloadRemoval';
import { emptyProfileData, exactProfileContent, exportProfiles, freshSnapshot, importProfiles, loadProfiles, PROFILE_STORAGE_KEY, type LocalProfile, type LocalSettings, type ProfileSnapshot, type ProfileData } from './profileStore';

export type { ProfileData } from './profileStore';
export type Rating = 'down' | 'up' | 'love';
export type ProgressEntry = ProfileData['progress'][number];
export type DownloadEntry = ProfileData['downloads'][number];
export interface Settings extends LocalSettings { smartDownloads: boolean; autoplayPreviews: boolean }
interface State extends ProfileSnapshot {
  hydrated: boolean;
  persistenceReady: boolean;
  hydrationError?: string;
  authReady: boolean;
  signedIn: boolean;
  creditSeen: boolean;
  userName: string;
  data: ProfileData;
  settings: Settings;
  catalogVersion: number;
  toast: { id: number; message: string } | null;
}
type Action =
  | { type: 'HYDRATE'; snapshot: ProfileSnapshot; writable: boolean; error?: string }
  | { type: 'DATA'; profileId: string; update: (data: ProfileData) => ProfileData }
  | { type: 'SELECT'; id: string }
  | { type: 'ADD'; profile: LocalProfile }
  | { type: 'EDIT'; id: string; name: string; color?: string }
  | { type: 'SETTING'; key: keyof LocalSettings }
  | { type: 'IMPORT'; snapshot: ProfileSnapshot }
  | { type: 'TOAST'; message: string }
  | { type: 'CLEAR_TOAST'; id: number }
  | { type: 'CATALOG'; version: number };
function normalize(snapshot: ProfileSnapshot): ProfileSnapshot {
  return { ...snapshot, profiles: snapshot.profiles.map(profile => ({ ...profile, settings: profile.settings ?? { ...snapshot.settings } })) };
}
function derived(snapshot: ProfileSnapshot): Pick<State, 'data' | 'userName' | 'settings'> {
  const active = snapshot.profiles.find(row => row.id === snapshot.activeProfileId) ?? snapshot.profiles[0];
  return { data: active.data, userName: active.name, settings: { ...(active.settings ?? snapshot.settings), smartDownloads: false, autoplayPreviews: false } };
}
const initialSnapshot = normalize(freshSnapshot());
const initialState: State = { ...initialSnapshot, ...derived(initialSnapshot), hydrated: false, persistenceReady: false, authReady: true, signedIn: true, creditSeen: true, catalogVersion: 0, toast: null };
function reducer(state: State, action: Action): State {
  if (!['HYDRATE', 'IMPORT', 'TOAST', 'CLEAR_TOAST', 'CATALOG'].includes(action.type) && (!state.hydrated || !state.persistenceReady)) return state;
  let next: Omit<State, 'settings'> & { settings: LocalSettings } = state;
  switch (action.type) {
    case 'HYDRATE': next = { ...state, ...normalize(action.snapshot), hydrated: true, persistenceReady: action.writable, hydrationError: action.error }; break;
    case 'IMPORT': next = { ...state, ...normalize(action.snapshot), hydrated: true, persistenceReady: true, hydrationError: undefined }; break;
    case 'DATA': next = { ...state, profiles: state.profiles.map(profile => profile.id === action.profileId ? { ...profile, data: action.update(profile.data) } : profile) }; break;
    case 'SELECT': if (!state.profiles.some(row => row.id === action.id)) return state; next = { ...state, activeProfileId: action.id }; break;
    case 'ADD': if (state.profiles.length >= 8 || state.profiles.some(row => row.id === action.profile.id)) return state; next = { ...state, profiles: [...state.profiles, action.profile] }; break;
    case 'EDIT': next = { ...state, profiles: state.profiles.map(row => row.id === action.id ? { ...row, name: action.name, ...(action.color ? { color: action.color } : {}) } : row) }; break;
    case 'SETTING': next = { ...state, profiles: state.profiles.map(row => row.id === state.activeProfileId ? { ...row, settings: { ...(row.settings ?? state.settings), [action.key]: !state.settings[action.key] } } : row) }; break;
    case 'TOAST': return { ...state, toast: { id: Date.now(), message: action.message } };
    case 'CLEAR_TOAST': return state.toast?.id === action.id ? { ...state, toast: null } : state;
    case 'CATALOG': return { ...state, catalogVersion: action.version };
  }
  return { ...next, ...derived(next) };
}
const same = (entry: { titleId: string; episodeId?: string }, titleId: string, episodeId?: string) => entry.titleId === titleId && entry.episodeId === episodeId;
const validTitle = (id: string) => /^tmdb:(movie|tv):[1-9]\d*$/.test(id);
const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [id, ...values].slice(0, 5000);
interface AppContextValue {
  state: State; activeProfile: Profile; profiles: Profile[]; profileData: ProfileData; catalogVersion: number;
  setDisplayName: (name: string) => void;
  addProfile: (name: string, color?: string) => void;
  selectProfile: (id: string) => void;
  editProfile: (id: string, name: string, color?: string) => void;
  exportData: () => string;
  importData: (raw: string) => Promise<void>;
  signOut: () => Promise<void>;
  markCreditSeen: () => void;
  toggleMyList: (id: string) => void;
  rate: (id: string, rating: Rating | null) => void;
  toggleReminder: (id: string) => void;
  setProgress: (entry: ProgressEntry, profileId?: string) => void;
  removeProgress: (titleId: string, episodeId?: string) => void;
  startDownload: (titleId: string, sizeMB?: number, episodeId?: string) => void;
  pauseDownload: (titleId: string, episodeId?: string) => void;
  deleteDownload: (titleId: string, episodeId?: string, profileId?: string) => Promise<void>;
  toggleSetting: (key: keyof LocalSettings) => void;
  resetData: () => void;
  showToast: (message: string) => void;
  clearToast: (id: number) => void;
}
const AppContext = createContext<AppContextValue | null>(null);
export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state); stateRef.current = state;
  const operations = useRef(new Map<string, AbortController>());
  const ignoredNative = useRef(new Set<string>());
  const mutationLocked = useRef(false);
  const dataGeneration = useRef(0);
  const transferChanges = useRef(new Map<string, Promise<void>>());
  const persistence = useRef(Promise.resolve());
  const notifyCatalog = useCallback((version: number) => dispatch({ type: 'CATALOG', version }), []);
  useEngine(state.hydrated, notifyCatalog);
  useEffect(() => {
    let mounted = true;
    const generation = dataGeneration.current;
    void loadProfiles(AsyncStorage).then(snapshot => {
      for (const profile of snapshot.profiles) profile.data.downloads = profile.data.downloads.map(row => row.status === 'downloading' || row.status === 'queued' ? { ...row, status: 'paused' } : row);
      if (mounted && generation === dataGeneration.current) dispatch({ type: 'HYDRATE', snapshot, writable: true });
    }).catch(() => { if (mounted && generation === dataGeneration.current) dispatch({ type: 'HYDRATE', snapshot: freshSnapshot(), writable: false, error: 'Your saved data could not be read. It has not been overwritten. Restore an export or restart to try again.' }); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!state.hydrated || !state.persistenceReady || mutationLocked.current) return;
    const snapshot: ProfileSnapshot = { schemaVersion: 2, activeProfileId: state.activeProfileId, profiles: state.profiles, settings: state.settings };
    const raw = JSON.stringify(snapshot);
    const generation = dataGeneration.current;
    persistence.current = persistence.current.catch(() => undefined).then(() => generation === dataGeneration.current ? AsyncStorage.setItem(PROFILE_STORAGE_KEY, raw) : undefined).catch(() => { dispatch({ type: 'TOAST', message: 'Could not save these changes. Export your data before closing the app.' }); });
  }, [state.hydrated, state.persistenceReady, state.activeProfileId, state.profiles, state.settings]);
  const showToast = useCallback((message: string) => dispatch({ type: 'TOAST', message }), []);
  const update = useCallback((fn: (data: ProfileData) => ProfileData, profileId = stateRef.current.activeProfileId) => { if (!mutationLocked.current) dispatch({ type: 'DATA', profileId, update: fn }); }, []);
  const reconcile = useCallback((entry: NativeDownload) => {
    if (mutationLocked.current || ignoredNative.current.has(entry.key) || entry.removed) return;
    const profile = stateRef.current.profiles.find(row => entry.key.startsWith(`${row.id}:tmdb:`));
    if (!profile) return;
    update(data => ({ ...data, downloads: data.downloads.map(row => {
      if (downloadKey(row.titleId, row.episodeId, profile.id) !== entry.key) return row;
      if ((row.updatedAt ?? 0) > entry.updatedAt) return row;
      if (!row.nativeId && !operations.current.has(entry.key) && row.status !== 'paused') return row;
      if (row.nativeId && row.nativeId !== entry.id && !operations.current.has(entry.key)) return row;
      return { ...row, nativeId: entry.id, status: entry.status, progress: entry.progress ?? row.progress, bytesDownloaded: entry.bytesDownloaded, totalBytes: entry.totalBytes, progressKind: entry.progressKind ?? (entry.progress === null ? 'indeterminate' : 'bytes'), sizeMB: entry.sizeMB ?? entry.bytesDownloaded / (1024 * 1024), localUri: entry.status === 'downloaded' ? entry.localUri : undefined, savedToDevice: false, updatedAt: entry.updatedAt };
    }) }), profile.id);
  }, [update]);
  useEffect(() => {
    if (!state.hydrated || !state.persistenceReady) return;
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    try { unsubscribe = subscribeDownloadUpdates(entry => { if (mounted) reconcile(entry); }); } catch { /* Native downloads are unavailable in Expo Go and non-Android builds. */ }
    void getDownloads().then(entries => { if (mounted) entries.forEach(reconcile); }).catch(() => undefined);
    return () => { mounted = false; unsubscribe?.(); };
  }, [state.hydrated, state.persistenceReady, reconcile]);
  useEffect(() => {
    if (state.hydrated) void setDownloadPolicy({ wifiOnly: state.settings.wifiOnly }).catch(() => undefined);
  }, [state.hydrated, state.activeProfileId, state.settings.wifiOnly]);
  const stopTransfer = useCallback((key: string): Promise<void> => {
    const previous = transferChanges.current.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => cancelDownload(key));
    transferChanges.current.set(key, operation);
    void operation.finally(() => { if (transferChanges.current.get(key) === operation) transferChanges.current.delete(key); }).catch(() => undefined);
    return operation;
  }, []);
  const stopOperations = useCallback(() => {
    cancelEngineSessions();
    const keys = new Set<string>();
    for (const [key, controller] of operations.current) { ignoredNative.current.add(key); controller.abort(); keys.add(key); }
    operations.current.clear();
    for (const profile of stateRef.current.profiles) {
      for (const row of profile.data.downloads) if (row.status === 'queued' || row.status === 'downloading') {
        const key = downloadKey(row.titleId, row.episodeId, profile.id); ignoredNative.current.add(key); keys.add(key);
      }
      dispatch({ type: 'DATA', profileId: profile.id, update: data => ({ ...data, downloads: data.downloads.map(row => row.status === 'queued' || row.status === 'downloading' ? { ...row, status: 'paused', localUri: undefined, progress: 0, bytesDownloaded: 0 } : row) }) });
    }
    return Promise.all([...keys].map(stopTransfer)).then(() => undefined);
  }, [stopTransfer]);
  const startDownload = useCallback((titleId: string, _sizeMB = 0, episodeId?: string) => {
    if (!stateRef.current.hydrated || !stateRef.current.persistenceReady || mutationLocked.current) { showToast('Saved data is not ready. Restart or restore an export first.'); return; }
    if (!validTitle(titleId) || (titleId.startsWith('tmdb:tv:') ? !episodeId || !episodeId.startsWith(`${titleId}:`) || !/^tmdb:tv:[1-9]\d*:s\d+e[1-9]\d*$/.test(episodeId) : !!episodeId)) { showToast('Select an exact movie or episode to download.'); return; }
    const profileId = stateRef.current.activeProfileId;
    const wifiOnly = stateRef.current.settings.wifiOnly;
    const key = downloadKey(titleId, episodeId, profileId);
    if (operations.current.has(key) || transferChanges.current.has(key)) { showToast('This download is queued, running, or still stopping. Try again after it stops.'); return; }
    const previous = stateRef.current.data.downloads.find(row => same(row, titleId, episodeId));
    if (previous?.status === 'downloaded') { showToast('Delete the existing offline copy before starting a new download.'); return; }
    ignoredNative.current.delete(key);
    const controller = new AbortController(); operations.current.set(key, controller);
    update(data => ({ ...data, downloads: [...data.downloads.filter(row => !same(row, titleId, episodeId)), { titleId, episodeId, status: 'queued', progress: 0, sizeMB: 0, progressKind: 'indeterminate' }] }), profileId);
    let refs: PlaybackSourceRef[] = [];
    let last = 0;
    void transferPool.run(async () => {
      await setDownloadPolicy({ wifiOnly });
      if (wifiOnly) { const network = await ExpoNetwork.getNetworkStateAsync(); if (network.type !== ExpoNetwork.NetworkStateType.WIFI) throw new Error('Connect to Wi-Fi to download.'); }
      if (controller.signal.aborted) throw new Error('Download paused.');
      if (!catalog.get(titleId)) await catalog.detail(titleId, controller.signal);
      refs = await resolvePlayback(titleId, episodeId, controller.signal, undefined, profileId);
      const source = refs.find(ref => ref.downloadable && ['mp4', 'hls', 'dash'].includes(ref.container ?? ''));
      if (!source) throw new Error('No compatible downloadable source is available for this exact title or episode.');
      if (controller.signal.aborted || operations.current.get(key) !== controller) throw new Error('Download paused.');
      update(data => ({ ...data, downloads: data.downloads.map(row => same(row, titleId, episodeId) ? { ...row, status: 'downloading' } : row) }), profileId);
      return downloadVideo(key, source.url, ratio => {
        if (!controller.signal.aborted && operations.current.get(key) === controller && (ratio - last >= 0.02 || ratio >= 1)) { last = ratio; update(data => ({ ...data, downloads: data.downloads.map(row => same(row, titleId, episodeId) ? { ...row, progress: ratio } : row) }), profileId); }
      }, source.headers, controller.signal, source.container as DownloadContainer, source.headerOrigin);
    }, controller.signal).then(result => {
      if (controller.signal.aborted || operations.current.get(key) !== controller) { void deleteLocalFile(result.localUri).catch(() => undefined); return; }
      update(data => ({ ...data, downloads: data.downloads.map(row => same(row, titleId, episodeId) ? { ...row, status: 'downloaded', progress: 1, ...result } : row) }), profileId);
      if (stateRef.current.activeProfileId === profileId) showToast('Download saved for offline playback.');
    }).catch(async error => {
      if (controller.signal.aborted || operations.current.get(key) !== controller) return;
      const native = await queryDownload(key).catch(() => null);
      if (controller.signal.aborted || operations.current.get(key) !== controller) return;
      if (native?.status === 'paused') reconcile(native);
      else update(data => ({ ...data, downloads: data.downloads.map(row => same(row, titleId, episodeId) ? { ...row, status: 'failed' } : row) }), profileId);
      if (stateRef.current.activeProfileId === profileId) showToast(error instanceof Error ? error.message : 'Download failed.');
    }).finally(() => { void releasePlaybackSources(refs); if (operations.current.get(key) === controller) operations.current.delete(key); });
  }, [showToast, update, reconcile]);
  const pauseDownload = useCallback((titleId: string, episodeId?: string) => {
    if (mutationLocked.current) return;
    const profileId = stateRef.current.activeProfileId;
    const key = downloadKey(titleId, episodeId, profileId); ignoredNative.current.add(key);
    operations.current.get(key)?.abort(); operations.current.delete(key);
    void stopTransfer(key).catch(() => showToast('Could not confirm the native transfer stopped. Check Downloads before disconnecting.'));
    update(data => ({ ...data, downloads: data.downloads.map(row => same(row, titleId, episodeId) ? { ...row, status: 'paused', progress: 0, bytesDownloaded: 0, localUri: undefined } : row) }), profileId);
    showToast('Paused. Restarting uses a fresh file and does not append old source bytes.');
  }, [update, showToast, stopTransfer]);
  const deleteDownload = useCallback(async (titleId: string, episodeId?: string, profileId = stateRef.current.activeProfileId) => {
    if (mutationLocked.current) throw new Error('Another data operation is in progress.');
    const rows = stateRef.current.profiles.find(row => row.id === profileId)?.data.downloads.filter(row => same(row, titleId, episodeId)) ?? [];
    for (const row of rows) {
      const key = downloadKey(row.titleId, row.episodeId, profileId); ignoredNative.current.add(key);
      operations.current.get(key)?.abort(); operations.current.delete(key);
      const previous = transferChanges.current.get(key) ?? Promise.resolve();
      const operation = previous.catch(() => undefined).then(() => removeOwnedDownload(key, row.localUri, {
        query: queryDownload, delete: deleteNativeDownload, deleteLocalFile,
      }));
      transferChanges.current.set(key, operation);
      try {
        await operation;
        update(data => ({ ...data, downloads: data.downloads.filter(value => !same(value, row.titleId, row.episodeId)) }), profileId);
      } finally { if (transferChanges.current.get(key) === operation) transferChanges.current.delete(key); }
    }
  }, [update]);
  const resetData = useCallback(() => { if (mutationLocked.current) return; void stopOperations().catch(() => showToast('Could not confirm every native transfer stopped.')); update(data => ({ ...emptyProfileData(), downloads: data.downloads })); }, [stopOperations, update, showToast]);
  const value = useMemo<AppContextValue>(() => ({
    state, activeProfile: { id: state.activeProfileId, name: state.userName, color: state.profiles.find(row => row.id === state.activeProfileId)!.color },
    profiles: state.profiles.map(({ id, name, color }) => ({ id, name, color })), profileData: state.data, catalogVersion: state.catalogVersion,
    setDisplayName: name => { if (!mutationLocked.current && name.trim()) dispatch({ type: 'EDIT', id: stateRef.current.activeProfileId, name: name.trim().slice(0, 40) }); },
    addProfile: (name, color = '#F56D50') => {
      if (mutationLocked.current || !name.trim() || stateRef.current.profiles.length >= 8 || !/^#[0-9a-fA-F]{6}$/.test(color)) { showToast('Use a name and a valid color. Up to eight profiles are supported.'); return; }
      dispatch({ type: 'ADD', profile: { id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, name: name.trim().slice(0, 40), color, data: emptyProfileData(), settings: freshSnapshot().settings } });
    },
    editProfile: (id, name, color) => { if (!mutationLocked.current && name.trim() && (!color || /^#[0-9a-fA-F]{6}$/.test(color))) dispatch({ type: 'EDIT', id, name: name.trim().slice(0, 40), color }); },
    selectProfile: id => { if (!mutationLocked.current && stateRef.current.profiles.some(row => row.id === id)) { void stopOperations().catch(() => showToast('Could not confirm every native transfer stopped.')); dispatch({ type: 'SELECT', id }); } },
    exportData: () => exportProfiles(stateRef.current),
    importData: async raw => {
      if (mutationLocked.current || !stateRef.current.hydrated) throw new Error('Saved data is still loading or another data operation is in progress.');
      const snapshot = normalize(importProfiles(raw));
      mutationLocked.current = true; dataGeneration.current++;
      try {
        await stopOperations();
        await Promise.all(transferChanges.current.values());
        for (const profile of snapshot.profiles) for (const row of profile.data.downloads) ignoredNative.current.add(downloadKey(row.titleId, row.episodeId, profile.id));
        const operation = persistence.current.catch(() => undefined).then(() => AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(snapshot)));
        persistence.current = operation;
        await operation;
        dispatch({ type: 'IMPORT', snapshot });
      } finally { mutationLocked.current = false; }
    },
    signOut: async () => resetData(), resetData, markCreditSeen: () => undefined,
    toggleMyList: id => { if (validTitle(id)) update(data => ({ ...data, myList: toggle(data.myList, id) })); },
    rate: (id, rating) => { if (validTitle(id)) update(data => { const ratings = { ...data.ratings }; if (rating) ratings[id] = rating; else delete ratings[id]; return { ...data, ratings }; }); },
    toggleReminder: id => { if (validTitle(id)) update(data => ({ ...data, reminders: toggle(data.reminders, id) })); },
    setProgress: (entry, profileId) => {
      if (!exactProfileContent(entry) || !Number.isFinite(entry.position) || !Number.isFinite(entry.duration) || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0 || entry.position < 0 || entry.duration <= 0 || entry.position > entry.duration + 5 || (entry.timelineId !== undefined && (typeof entry.timelineId !== 'string' || entry.timelineId.length > 300))) return;
      update(data => ({ ...data, progress: [entry, ...data.progress.filter(row => !same(row, entry.titleId, entry.episodeId))].slice(0, 5000) }), profileId);
    },
    removeProgress: (titleId, episodeId) => update(data => ({ ...data, progress: data.progress.filter(row => !same(row, titleId, episodeId)) })),
    startDownload, pauseDownload, deleteDownload, toggleSetting: key => { if (!mutationLocked.current) dispatch({ type: 'SETTING', key }); },
    showToast, clearToast: id => dispatch({ type: 'CLEAR_TOAST', id }),
  }), [state, update, startDownload, pauseDownload, deleteDownload, resetData, showToast, stopOperations]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppStateProvider');
  return value;
}
export function progressFor(data: ProfileData, titleId: string, episodeId?: string): ProgressEntry | undefined {
  return data.progress.find(row => same(row, titleId, episodeId));
}
export function downloadFor(data: ProfileData, titleId: string, episodeId?: string): DownloadEntry | undefined {
  return data.downloads.find(row => same(row, titleId, episodeId));
}
