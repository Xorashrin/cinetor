import { z } from 'zod';
import { EngineError, type Storage } from '../engine/model';

export interface ProfileData {
  myList: string[];
  ratings: Record<string, 'down' | 'up' | 'love'>;
  reminders: string[];
  progress: { titleId: string; episodeId?: string; position: number; duration: number; updatedAt: number; timelineId?: string }[];
  downloads: { titleId: string; episodeId?: string; status: 'queued' | 'downloading' | 'paused' | 'downloaded' | 'failed'; progress: number; sizeMB: number; localUri?: string; savedToDevice?: boolean; bytesDownloaded?: number; totalBytes?: number | null; progressKind?: 'bytes' | 'segments' | 'indeterminate'; nativeId?: string; updatedAt?: number }[];
}
export interface LocalProfile { id: string; name: string; color: string; data: ProfileData; settings?: LocalSettings }
export interface LocalSettings { wifiOnly: boolean; autoplayNext: boolean; notifications: boolean; reducedMotion: boolean }
export interface ProfileSnapshot { schemaVersion: 2; activeProfileId: string; profiles: LocalProfile[]; settings: LocalSettings }
export const PROFILE_STORAGE_KEY = 'cinetor:profiles:v2';
export const LEGACY_STORAGE_KEY = 'cinator:v1';
export const emptyProfileData = (): ProfileData => ({ myList: [], ratings: {}, reminders: [], progress: [], downloads: [] });
const titleId = z.string().regex(/^tmdb:(movie|tv):[1-9]\d*$/).max(100);
const episodeId = z.string().regex(/^tmdb:tv:[1-9]\d*:s\d+e[1-9]\d*$/).max(160);
export function exactProfileContent(row: { titleId: string; episodeId?: string }): boolean {
  return /^tmdb:movie:[1-9]\d*$/.test(row.titleId) ? !row.episodeId : /^tmdb:tv:[1-9]\d*$/.test(row.titleId) && !!row.episodeId && /^tmdb:tv:[1-9]\d*:s\d+e[1-9]\d*$/.test(row.episodeId) && row.episodeId.startsWith(`${row.titleId}:`);
}
const Progress = z.object({ titleId, episodeId: episodeId.optional(), position: z.number().finite().min(0), duration: z.number().finite().min(0), updatedAt: z.number().finite().min(0), timelineId: z.string().max(300).optional() }).refine(row => row.position <= row.duration + 5 && exactProfileContent(row));
const Download = z.object({ titleId, episodeId: episodeId.optional(), status: z.enum(['queued', 'downloading', 'paused', 'downloaded', 'failed']), progress: z.number().min(0).max(1), sizeMB: z.number().finite().min(0), localUri: z.string().max(4096).optional(), savedToDevice: z.boolean().optional(), bytesDownloaded: z.number().finite().min(0).optional(), totalBytes: z.number().finite().min(0).nullable().optional(), progressKind: z.enum(['bytes', 'segments', 'indeterminate']).optional(), nativeId: z.string().max(100).optional(), updatedAt: z.number().finite().min(0).optional() }).refine(exactProfileContent);
const Data = z.object({ myList: z.array(titleId).max(5000), ratings: z.record(titleId, z.enum(['down', 'up', 'love'])).refine(rows => Object.keys(rows).length <= 5000), reminders: z.array(titleId).max(5000), progress: z.array(Progress).max(5000), downloads: z.array(Download).max(1000) }).refine(data => new Set(data.myList).size === data.myList.length && new Set(data.reminders).size === data.reminders.length && new Set(data.progress.map(row => row.episodeId ?? row.titleId)).size === data.progress.length && new Set(data.downloads.map(row => row.episodeId ?? row.titleId)).size === data.downloads.length);
const Settings = z.object({ wifiOnly: z.boolean(), autoplayNext: z.boolean(), notifications: z.boolean(), reducedMotion: z.boolean() });
const Profile = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), data: Data, settings: Settings.optional() });
const Snapshot = z.object({ schemaVersion: z.literal(2), activeProfileId: z.string().max(80), profiles: z.array(Profile).min(1).max(8), settings: Settings }).refine(row => new Set(row.profiles.map(p => p.id)).size === row.profiles.length && row.profiles.some(p => p.id === row.activeProfileId));

export function freshSnapshot(): ProfileSnapshot {
  return { schemaVersion: 2, activeProfileId: 'main', profiles: [{ id: 'main', name: 'My Profile', color: '#F56D50', data: emptyProfileData() }], settings: { wifiOnly: true, autoplayNext: true, notifications: true, reducedMotion: false } };
}
function parseJson(raw: string): unknown {
  if (raw.length > 2 * 1024 * 1024) throw new EngineError('size');
  try { return JSON.parse(raw); } catch { throw new EngineError('malformed'); }
}
export function parseSnapshot(raw: string): ProfileSnapshot {
  const result = Snapshot.safeParse(parseJson(raw));
  if (!result.success) throw new EngineError('malformed');
  return result.data;
}
function migrateLegacy(raw: string): ProfileSnapshot {
  const row = parseJson(raw) as Record<string, unknown> | null;
  if (!row || typeof row !== 'object') throw new EngineError('malformed');
  const next = freshSnapshot();
  if (typeof row.userName === 'string' && row.userName.trim()) next.profiles[0].name = row.userName.trim().slice(0, 40);
  const previous = row.data as Record<string, unknown> | undefined;
  if (previous && typeof previous === 'object') {
    const data = next.profiles[0].data;
    data.myList = Array.isArray(previous.myList) ? [...new Set(previous.myList.filter(id => titleId.safeParse(id).success))].slice(0, 5000) as string[] : [];
    data.reminders = Array.isArray(previous.reminders) ? [...new Set(previous.reminders.filter(id => titleId.safeParse(id).success))].slice(0, 5000) as string[] : [];
    data.progress = Array.isArray(previous.progress) ? previous.progress.flatMap(value => { const parsed = Progress.safeParse(value); return parsed.success ? [parsed.data] : []; }).slice(0, 5000) : [];
    data.downloads = Array.isArray(previous.downloads) ? previous.downloads.flatMap(value => { const parsed = Download.safeParse(value); return parsed.success ? [{ ...parsed.data, status: parsed.data.status === 'downloading' ? 'paused' as const : parsed.data.status }] : []; }).slice(0, 1000) : [];
    const progressKeys = new Set<string>(), downloadKeys = new Set<string>();
    data.progress = data.progress.filter(value => { const key = value.episodeId ?? value.titleId; if (progressKeys.has(key)) return false; progressKeys.add(key); return true; });
    data.downloads = data.downloads.filter(value => { const key = value.episodeId ?? value.titleId; if (downloadKeys.has(key)) return false; downloadKeys.add(key); return true; });
    const ratings = z.record(titleId, z.enum(['down', 'up', 'love'])).safeParse(previous.ratings);
    if (ratings.success) data.ratings = Object.fromEntries(Object.entries(ratings.data).slice(0, 5000));
  }
  const settings = row.settings as Record<string, unknown> | undefined;
  for (const key of ['wifiOnly', 'autoplayNext', 'notifications'] as const) if (typeof settings?.[key] === 'boolean') next.settings[key] = settings[key];
  return next;
}
export async function loadProfiles(storage: Storage): Promise<ProfileSnapshot> {
  const current = await storage.getItem(PROFILE_STORAGE_KEY);
  if (current) return parseSnapshot(current);
  const legacy = await storage.getItem(LEGACY_STORAGE_KEY);
  return legacy ? migrateLegacy(legacy) : freshSnapshot();
}
export function exportProfiles(snapshot: ProfileSnapshot): string {
  const safe = parseSnapshot(JSON.stringify(snapshot));
  for (const profile of safe.profiles) {
    profile.data.progress = profile.data.progress.map(({ timelineId: _timeline, ...row }) => row);
    profile.data.downloads = profile.data.downloads.filter(row => row.status === 'downloaded').map(({ localUri: _path, nativeId: _nativeId, bytesDownloaded: _bytes, totalBytes: _total, savedToDevice: _saved, ...row }) => ({ ...row, status: 'failed', progress: 0, sizeMB: 0, progressKind: 'indeterminate' }));
  }
  return JSON.stringify({ ...safe, exportedAt: new Date().toISOString() }, null, 2);
}
export function importProfiles(raw: string): ProfileSnapshot {
  const next = parseSnapshot(raw);
  for (const profile of next.profiles) {
    profile.data.progress = profile.data.progress.map(({ timelineId: _timeline, ...row }) => row);
    profile.data.downloads = profile.data.downloads.map(({ localUri: _path, nativeId: _nativeId, bytesDownloaded: _bytes, totalBytes: _total, savedToDevice: _saved, ...row }) => ({ ...row, status: 'failed', progress: 0, sizeMB: 0, progressKind: 'indeterminate' }));
  }
  return next;
}
