import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';

import { MAIN_PROFILE_ID, PROFILE_COLOR, findEpisode, getTitle, type Profile } from '../data/mock';
import { useEngine } from '../engine/useEngine';
import { cancelDownload, deleteLocalFile, downloadKey, downloadVideo } from '../services/downloads';

export type Rating = 'down' | 'up' | 'love';

export interface ProgressEntry {
  titleId: string;
  episodeId?: string;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface DownloadEntry {
  titleId: string;
  episodeId?: string;
  status: 'downloading' | 'downloaded' | 'failed';
  progress: number;
  sizeMB: number;
  localUri?: string;
  savedToDevice?: boolean;
}

export interface ProfileData {
  myList: string[];
  ratings: Record<string, Rating>;
  reminders: string[];
  progress: ProgressEntry[];
  downloads: DownloadEntry[];
}

export interface Settings {
  wifiOnly: boolean;
  smartDownloads: boolean;
  notifications: boolean;
  autoplayNext: boolean;
  autoplayPreviews: boolean;
}

interface State {
  hydrated: boolean;
  authReady: boolean;
  signedIn: boolean;
  userName: string;
  email: string;
  creditSeen: boolean;
  data: ProfileData;
  settings: Settings;
  toast: { id: number; message: string } | null;
  catalogVersion: number;
}

type Action =
  | { type: 'HYDRATE'; saved: Partial<State> | null }
  | { type: 'SET_NAME'; name: string }
  | { type: 'CREDIT_SEEN' }
  | { type: 'TOGGLE_MY_LIST'; id: string }
  | { type: 'RATE'; id: string; rating: Rating | null }
  | { type: 'TOGGLE_REMINDER'; id: string }
  | { type: 'SET_PROGRESS'; entry: ProgressEntry }
  | { type: 'REMOVE_PROGRESS'; titleId: string }
  | { type: 'DOWNLOAD_START'; titleId: string; episodeId?: string; sizeMB: number }
  | { type: 'DOWNLOAD_PROGRESS'; titleId: string; episodeId?: string; progress: number }
  | { type: 'DOWNLOAD_DONE'; titleId: string; episodeId?: string; localUri: string; sizeMB: number; savedToDevice: boolean }
  | { type: 'DOWNLOAD_FAILED'; titleId: string; episodeId?: string }
  | { type: 'DOWNLOAD_REMOVE'; titleId: string; episodeId?: string }
  | { type: 'TOGGLE_SETTING'; key: keyof Settings }
  | { type: 'RESET_DATA' }
  | { type: 'TOAST'; message: string }
  | { type: 'CLEAR_TOAST'; id: number }
  | { type: 'CATALOG_UPDATED'; version: number };

const STORAGE_KEY = 'cinator:v1';

const starterData: ProfileData = {
  myList: [],
  ratings: {},
  reminders: [],
  progress: [],
  downloads: [],
};

const initialState: State = {
  hydrated: false,
  authReady: true,
  signedIn: true,
  userName: 'Cinator User',
  email: 'user@cinator.app',
  creditSeen: true,
  data: starterData,
  settings: { wifiOnly: true, smartDownloads: true, notifications: true, autoplayNext: true, autoplayPreviews: true },
  toast: null,
  catalogVersion: 0,
};

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [id, ...list]);
const same = (d: DownloadEntry, titleId: string, episodeId?: string) => d.titleId === titleId && d.episodeId === episodeId;

function withData(state: State, fn: (d: ProfileData) => ProfileData): State {
  return { ...state, data: fn(state.data) };
}

function patchDownload(state: State, titleId: string, episodeId: string | undefined, patch: Partial<DownloadEntry>): State {
  return withData(state, (d) => ({ ...d, downloads: d.downloads.map((x) => (same(x, titleId, episodeId) ? { ...x, ...patch } : x)) }));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'HYDRATE': {
      const saved = action.saved ?? {};
      const merged: State = {
        ...state,
        ...saved,
        signedIn: true,
        authReady: true,
        userName: saved.userName || state.userName,
        toast: null,
        hydrated: true,
      };
      merged.data = {
        myList: saved.data?.myList ?? [],
        ratings: saved.data?.ratings ?? {},
        reminders: saved.data?.reminders ?? [],
        progress: saved.data?.progress ?? [],
        downloads: (saved.data?.downloads ?? []).map((x): DownloadEntry => (x.status === 'downloading' ? { ...x, status: 'failed' } : x)),
      };
      return merged;
    }
    case 'SET_NAME':
      return { ...state, userName: action.name };
    case 'CREDIT_SEEN':
      return { ...state, creditSeen: true };
    case 'TOGGLE_MY_LIST':
      return withData(state, (d) => ({ ...d, myList: toggle(d.myList, action.id) }));
    case 'RATE':
      return withData(state, (d) => {
        const ratings = { ...d.ratings };
        if (action.rating) ratings[action.id] = action.rating;
        else delete ratings[action.id];
        return { ...d, ratings };
      });
    case 'TOGGLE_REMINDER':
      return withData(state, (d) => ({ ...d, reminders: toggle(d.reminders, action.id) }));
    case 'SET_PROGRESS':
      return withData(state, (d) => ({ ...d, progress: [action.entry, ...d.progress.filter((p) => p.titleId !== action.entry.titleId)] }));
    case 'REMOVE_PROGRESS':
      return withData(state, (d) => ({ ...d, progress: d.progress.filter((p) => p.titleId !== action.titleId) }));
    case 'DOWNLOAD_START':
      return withData(state, (d) => ({
        ...d,
        downloads: [
          ...d.downloads.filter((x) => !same(x, action.titleId, action.episodeId)),
          { titleId: action.titleId, episodeId: action.episodeId, status: 'downloading', progress: 0, sizeMB: action.sizeMB },
        ],
      }));
    case 'DOWNLOAD_PROGRESS':
      return patchDownload(state, action.titleId, action.episodeId, { progress: action.progress });
    case 'DOWNLOAD_DONE':
      return patchDownload(state, action.titleId, action.episodeId, {
        status: 'downloaded',
        progress: 1,
        localUri: action.localUri,
        sizeMB: action.sizeMB,
        savedToDevice: action.savedToDevice,
      });
    case 'DOWNLOAD_FAILED':
      return patchDownload(state, action.titleId, action.episodeId, { status: 'failed' });
    case 'DOWNLOAD_REMOVE':
      return withData(state, (d) => ({
        ...d,
        downloads: d.downloads.filter((x) => (action.episodeId === undefined ? x.titleId !== action.titleId : !same(x, action.titleId, action.episodeId))),
      }));
    case 'TOGGLE_SETTING':
      return { ...state, settings: { ...state.settings, [action.key]: !state.settings[action.key] } };
    case 'RESET_DATA':
      return { ...state, data: starterData };
    case 'TOAST':
      return { ...state, toast: { id: Date.now(), message: action.message } };
    case 'CLEAR_TOAST':
      return state.toast?.id === action.id ? { ...state, toast: null } : state;
    case 'CATALOG_UPDATED':
      return { ...state, catalogVersion: action.version };
    default:
      return state;
  }
}

interface AppContextValue {
  state: State;
  activeProfile: Profile | null;
  profileData: ProfileData;
  catalogVersion: number;
  setDisplayName: (name: string) => void;
  signOut: () => Promise<void>;
  markCreditSeen: () => void;
  toggleMyList: (id: string) => void;
  rate: (id: string, rating: Rating | null) => void;
  toggleReminder: (id: string) => void;
  setProgress: (entry: ProgressEntry) => void;
  removeProgress: (titleId: string) => void;
  startDownload: (titleId: string, sizeMB: number, episodeId?: string) => void;
  deleteDownload: (titleId: string, episodeId?: string) => void;
  toggleSetting: (key: keyof Settings) => void;
  resetData: () => void;
  showToast: (message: string) => void;
  clearToast: (id: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const notifyCatalog = useCallback((version: number) => dispatch({type: "CATALOG_UPDATED", version}), []);
  useEngine(state.hydrated, notifyCatalog);

  useEffect(() => {
    let hydrated = false;

    // Race timeout: if AsyncStorage takes longer than 350ms, mark hydrated immediately
    const hydrationTimeout = setTimeout(() => {
      if (!hydrated) {
        hydrated = true;
        dispatch({ type: 'HYDRATE', saved: null });
      }
    }, 350);

    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!hydrated) {
          hydrated = true;
          clearTimeout(hydrationTimeout);
          dispatch({ type: 'HYDRATE', saved: raw ? (JSON.parse(raw) as Partial<State>) : null });
        }
      })
      .catch(() => {
        if (!hydrated) {
          hydrated = true;
          clearTimeout(hydrationTimeout);
          dispatch({ type: 'HYDRATE', saved: null });
        }
      });

    return () => {
      clearTimeout(hydrationTimeout);
    };
  }, []);

  useEffect(() => {
    if (!state.hydrated) return;
    const { creditSeen, data, settings, userName } = state;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ creditSeen, data, settings, userName })).catch(() => undefined);
  }, [state]);

  const showToast = useCallback((message: string) => dispatch({ type: 'TOAST', message }), []);

  const startDownload = useCallback(
    (titleId: string, sizeMB: number, episodeId?: string) => {
      const title = getTitle(titleId);
      const url = episodeId ? findEpisode(title, episodeId)?.episode.video ?? title.video : title.video;
      if (!url) {
        showToast('No video available to download');
        return;
      }
      dispatch({ type: 'DOWNLOAD_START', titleId, episodeId, sizeMB });
      let last = 0;
      downloadVideo(downloadKey(titleId, episodeId), url, (ratio) => {
        if (ratio - last >= 0.02 || ratio >= 1) {
          last = ratio;
          dispatch({ type: 'DOWNLOAD_PROGRESS', titleId, episodeId, progress: ratio });
        }
      })
        .then((r) => {
          const stillWanted = stateRef.current.data.downloads.some((x: DownloadEntry) => same(x, titleId, episodeId));
          if (!stillWanted) {
            deleteLocalFile(r.localUri);
            return;
          }
          dispatch({ type: 'DOWNLOAD_DONE', titleId, episodeId, localUri: r.localUri, sizeMB: r.sizeMB, savedToDevice: r.savedToDevice });
          showToast(r.savedToDevice ? `${title.name} saved to device storage` : `${title.name} downloaded`);
        })
        .catch(() => {
          if (stateRef.current.data.downloads.some((x: DownloadEntry) => same(x, titleId, episodeId))) {
            dispatch({ type: 'DOWNLOAD_FAILED', titleId, episodeId });
            showToast('Download failed. Check connection.');
          }
        });
    },
    [showToast],
  );

  const deleteDownload = useCallback((titleId: string, episodeId?: string) => {
    const targets = stateRef.current.data.downloads.filter((x: DownloadEntry) => (episodeId === undefined ? x.titleId === titleId : same(x, titleId, episodeId)));
    targets.forEach((x: DownloadEntry) => {
      cancelDownload(downloadKey(x.titleId, x.episodeId));
      deleteLocalFile(x.localUri);
    });
    dispatch({ type: 'DOWNLOAD_REMOVE', titleId, episodeId });
  }, []);

  const resetData = useCallback(() => {
    dispatch({ type: 'RESET_DATA' });
  }, []);

  const signOut = useCallback(async () => {
    dispatch({ type: 'RESET_DATA' });
  }, []);

  const value = useMemo<AppContextValue>(() => {
    const activeProfile: Profile = { id: MAIN_PROFILE_ID, name: state.userName || 'Cinator User', color: PROFILE_COLOR };
    return {
      state,
      activeProfile,
      profileData: state.data,
      catalogVersion: state.catalogVersion,
      setDisplayName: (name: string) => dispatch({ type: 'SET_NAME', name }),
      signOut,
      resetData,
      markCreditSeen: () => dispatch({ type: 'CREDIT_SEEN' }),
      toggleMyList: (id: string) => dispatch({ type: 'TOGGLE_MY_LIST', id }),
      rate: (id: string, rating: Rating | null) => dispatch({ type: 'RATE', id, rating }),
      toggleReminder: (id: string) => dispatch({ type: 'TOGGLE_REMINDER', id }),
      setProgress: (entry: ProgressEntry) => dispatch({ type: 'SET_PROGRESS', entry }),
      removeProgress: (titleId: string) => dispatch({ type: 'REMOVE_PROGRESS', titleId }),
      startDownload,
      deleteDownload,
      toggleSetting: (key: keyof Settings) => dispatch({ type: 'TOGGLE_SETTING', key }),
      showToast,
      clearToast: (id: number) => dispatch({ type: 'CLEAR_TOAST', id }),
    };
  }, [state, startDownload, deleteDownload, resetData, signOut, showToast]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}

export function progressFor(data: ProfileData, titleId: string): ProgressEntry | undefined {
  return data.progress.find((p) => p.titleId === titleId);
}

export function downloadFor(data: ProfileData, titleId: string, episodeId?: string): DownloadEntry | undefined {
  return data.downloads.find((d) => same(d, titleId, episodeId));
}
