import { z } from 'zod';
import { EngineError, type Storage } from '../engine/model';
import { publicUrl } from './request';

export type RepositoryEngine = 'nuvio' | 'cloudstream';
export interface RepositoryDocument { url: string; bodyText: string; byteLength: number; sha256: string }
export interface RepositoryEntry {
  id: string;
  name: string;
  version?: string;
  artifactUrl?: string;
  claimedSha256?: string;
  status: 'quarantined' | 'publisher-disabled' | 'invalid';
  reason: string;
  documentSha256: string;
}
export interface RepositoryRecord {
  id: string;
  name: string;
  engine: RepositoryEngine;
  url: string;
  state: 'not-checked' | 'quarantined' | 'error';
  checkedAt?: number;
  lastError?: string;
  entries: RepositoryEntry[];
  documents: { url: string; sha256: string; byteLength: number }[];
  changes?: { added: number; changed: number; removed: number };
}
export interface RepositorySnapshot { schemaVersion: 1; repositories: RepositoryRecord[] }
export type ReadRepository = (url: string, signal: AbortSignal, remainingMs: number) => Promise<RepositoryDocument>;
const KEY = 'cinetor:repository-intake:v1';
const MAX_BYTES = 2 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const text = (value: unknown, max = 180): string | undefined => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : undefined;
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Intake stores public metadata only; URL query strings can contain private access tokens. */
export function repositoryUrl(value: string, base?: string): string {
  const parsed = new URL(publicUrl(value, base));
  if (parsed.search || parsed.port || new URL(value, base).hash) throw new EngineError('scope');
  return parsed.toString();
}
const SafeUrl = z.string().max(4096).refine(value => { try { return repositoryUrl(value) === value; } catch { return false; } });
const Entry = z.object({ id: z.string().min(1).max(220), name: z.string().min(1).max(180), version: z.string().max(100).optional(), artifactUrl: SafeUrl.optional(), claimedSha256: z.string().regex(HASH).optional(), status: z.enum(['quarantined', 'publisher-disabled', 'invalid']), reason: z.string().max(300), documentSha256: z.string().regex(HASH) });
const Document = z.object({ url: SafeUrl, sha256: z.string().regex(HASH), byteLength: z.number().int().min(1).max(1048576) });
const RecordSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: z.string().min(1).max(80), engine: z.enum(['nuvio', 'cloudstream']), url: SafeUrl, state: z.enum(['not-checked', 'quarantined', 'error']), checkedAt: z.number().finite().min(0).optional(), lastError: z.string().max(180).optional(), entries: z.array(Entry).max(1000), documents: z.array(Document).max(5), changes: z.object({ added: z.number().int().min(0), changed: z.number().int().min(0), removed: z.number().int().min(0) }).optional() });
const Snapshot = z.object({ schemaVersion: z.literal(1), repositories: z.array(RecordSchema).max(16) }).refine(row => new Set(row.repositories.map(repo => repo.id)).size === row.repositories.length && new Set(row.repositories.map(repo => `${repo.engine}:${repo.url}`)).size === row.repositories.length && row.repositories.reduce((count, repo) => count + repo.entries.length, 0) <= 4000);
export function parseRepositorySnapshot(raw: string): RepositorySnapshot {
  if (raw.length > MAX_BYTES) throw new EngineError('size');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new EngineError('malformed'); }
  const checked = Snapshot.safeParse(parsed);
  if (!checked.success) throw new EngineError('malformed');
  return checked.data;
}
export function parseRepositoryDocument(engine: RepositoryEngine, document: RepositoryDocument): { entries: RepositoryEntry[]; indexes: string[] } {
  if (!document || typeof document.bodyText !== 'string' || document.bodyText.length > 1048576 || !Number.isInteger(document.byteLength) || document.byteLength < 1 || document.byteLength > 1048576 || !HASH.test(document.sha256)) throw new EngineError('malformed');
  const url = repositoryUrl(document.url);
  let input: unknown;
  try { input = JSON.parse(document.bodyText); } catch { throw new EngineError('malformed'); }
  const descriptor = object(input);
  if (engine === 'cloudstream' && Array.isArray(descriptor?.pluginLists)) {
    if (descriptor.pluginLists.length > 4 || descriptor.pluginLists.some(value => typeof value !== 'string')) throw new EngineError('size');
    const indexes = [...new Set((descriptor.pluginLists as string[]).map(value => repositoryUrl(value, url)))];
    return { entries: [], indexes };
  }
  const rows = Array.isArray(input) ? input : engine === 'nuvio' ? descriptor?.providers ?? descriptor?.plugins : descriptor?.plugins;
  if (!Array.isArray(rows)) throw new EngineError('unsupported');
  if (rows.length > 1000) throw new EngineError('size');
  const seen = new Set<string>();
  const entries = rows.map((value, index): RepositoryEntry => {
    const row = object(value);
    const name = text(row?.name) ?? `Unnamed entry ${index + 1}`;
    const claimedId = text(row?.id) ?? text(row?.internalName) ?? name;
    const id = `${index}:${claimedId}`;
    const version = text(row?.version, 100) ?? (typeof row?.version === 'number' && Number.isSafeInteger(row.version) ? String(row.version) : undefined);
    const claim = row?.sha256 ?? row?.hash;
    const claimedSha256 = typeof claim === 'string' && HASH.test(claim.toLowerCase()) ? claim.toLowerCase() : undefined;
    let artifactUrl: string | undefined;
    let status: RepositoryEntry['status'] = 'quarantined';
    let reason = 'Metadata only. Source review and a pinned build are required before installation.';
    const path = text(row?.url, 4096) ?? text(row?.filename, 4096) ?? text(row?.file, 4096);
    try { if (path) artifactUrl = repositoryUrl(path, url); } catch { status = 'invalid'; reason = 'Artifact URL is not public HTTPS without credentials, a query, or a fragment.'; }
    if (!row || !path) { status = 'invalid'; reason = 'No explicit artifact URL was supplied. No filename or path was guessed.'; }
    if (claim !== undefined && !claimedSha256) { status = 'invalid'; reason = 'The declared SHA-256 value is malformed.'; }
    if (seen.has(claimedId)) { status = 'invalid'; reason = 'Duplicate declared identity in this document; no artifact was admitted.'; }
    seen.add(claimedId);
    if (status !== 'invalid' && (row?.status === 0 || row?.disabled === true)) { status = 'publisher-disabled'; reason = 'Publisher marks this entry disabled. The claim is not independent compatibility evidence.'; }
    return { id, name, version, artifactUrl, claimedSha256, status, reason, documentSha256: document.sha256 };
  });
  return { entries, indexes: [] };
}

/** Repository declarations never enter ProviderRegistry or the native executable-artifact allowlist. */
export class RepositoryStore {
  private value: RepositorySnapshot = { schemaVersion: 1, repositories: [] };
  private writable = false;
  private listeners = new Set<() => void>();
  private pending: Promise<void> = Promise.resolve();
  private active = new Map<string, AbortController>();
  constructor(private storage: Storage, private read: ReadRepository) {}
  getSnapshot = (): RepositorySnapshot => this.value;
  get ready(): boolean { return this.writable; }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  async load(): Promise<void> {
    const raw = await this.storage.getItem(KEY);
    this.value = raw ? parseRepositorySnapshot(raw) : { schemaVersion: 1, repositories: [] };
    this.writable = true;
    for (const listener of this.listeners) listener();
  }
  private mutate(update: (value: RepositorySnapshot) => RepositorySnapshot): Promise<void> {
    if (!this.writable) return Promise.reject(new EngineError('storage'));
    const operation = this.pending.catch(() => undefined).then(async () => {
      const next = parseRepositorySnapshot(JSON.stringify(update(this.value)));
      await this.storage.setItem(KEY, JSON.stringify(next));
      this.value = next;
      for (const listener of this.listeners) listener();
    });
    this.pending = operation;
    return operation;
  }
  add(input: Pick<RepositoryRecord, 'name' | 'engine' | 'url'>): Promise<void> {
    const record: RepositoryRecord = { ...input, name: input.name.trim(), url: repositoryUrl(input.url.trim()), id: `repo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, state: 'not-checked', entries: [], documents: [] };
    return this.mutate(value => ({ ...value, repositories: [...value.repositories, record] }));
  }
  remove(id: string): Promise<void> {
    this.active.get(id)?.abort();
    return this.mutate(value => ({ ...value, repositories: value.repositories.filter(row => row.id !== id) }));
  }
  async refresh(id: string, signal?: AbortSignal): Promise<void> {
    if (!this.writable) throw new EngineError('storage');
    if (signal?.aborted) throw new EngineError('cancelled');
    if (this.active.has(id) || this.active.size >= 2) throw new EngineError('rate-limit');
    const repository = this.value.repositories.find(row => row.id === id);
    if (!repository) throw new EngineError('configuration');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.active.set(id, controller);
    const deadline = Date.now() + 45000;
    const timer = setTimeout(abort, 45000);
    try {
      let bytes = 0;
      const documents: RepositoryRecord['documents'] = [];
      const fetchDocument = async (url: string) => {
        if (controller.signal.aborted) throw new EngineError('cancelled');
        const document = await this.read(url, controller.signal, Math.max(1, deadline - Date.now()));
        if (controller.signal.aborted) throw new EngineError('cancelled');
        const parsed = parseRepositoryDocument(repository.engine, document);
        bytes += document.byteLength;
        if (bytes > MAX_BYTES) throw new EngineError('size');
        documents.push({ url: repositoryUrl(document.url), sha256: document.sha256, byteLength: document.byteLength });
        return parsed;
      };
      const root = await fetchDocument(repository.url);
      let entries = root.entries;
      for (const [index, url] of root.indexes.entries()) {
        const child = await fetchDocument(url);
        if (child.indexes.length) throw new EngineError('scope');
        entries = [...entries, ...child.entries.map(row => ({ ...row, id: `${index}:${row.id}` }))];
        if (entries.length > 1000) throw new EngineError('size');
      }
      const identity = (entry: RepositoryEntry) => `${entry.name}:${entry.artifactUrl ?? entry.id}`;
      const previous = new Map(repository.entries.map(row => [identity(row), row]));
      const incoming = new Set(entries.map(identity));
      const changes = { added: entries.filter(row => !previous.has(identity(row))).length, changed: entries.filter(row => { const old = previous.get(identity(row)); return old && (old.version !== row.version || old.claimedSha256 !== row.claimedSha256 || old.status !== row.status); }).length, removed: repository.entries.filter(row => !incoming.has(identity(row))).length };
      await this.mutate(value => {
        if (controller.signal.aborted) throw new EngineError('cancelled');
        return { ...value, repositories: value.repositories.map(row => row.id === id ? { ...row, entries, documents, changes, state: 'quarantined', checkedAt: Date.now(), lastError: undefined } : row) };
      });
    } catch (error) {
      if (!controller.signal.aborted) await this.mutate(value => ({ ...value, repositories: value.repositories.map(row => row.id === id ? { ...row, state: 'error', lastError: error instanceof EngineError ? error.code : 'network' } : row) }));
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (this.active.get(id) === controller) this.active.delete(id);
    }
  }
}
