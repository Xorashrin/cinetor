import type { PlaybackSourceRef } from '../data/mock';
import { EngineError, type Storage } from './model';

const KEY = 'cinetor:playback-evidence:v2';
const TTL = 24 * 60 * 60 * 1000;
const LIMIT = 200;
const CONTENT = /^tmdb:(?:movie:[1-9]\d*|tv:[1-9]\d*:s\d+e[1-9]\d*)$/;
const REPRESENTATION = /^(?:[a-f0-9]{64}|bdix-spool:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
export interface PlaybackEvidence {
  contentKey: string;
  engine: 'bdix' | 'nuvio' | 'cloudstream';
  providerId: string;
  providerVersion: string;
  providerHash: string;
  representationId: string;
  networkContext: string;
  accessContext: string;
  deviceContext: string;
  at: number;
  expiresAt: number;
  event: 'rendered-first-frame';
}
function sameContext(row: PlaybackEvidence, source: PlaybackSourceRef): boolean {
  return row.contentKey === source.contentKey && row.engine === source.engine &&
    row.providerId === source.providerId && row.providerVersion === source.providerVersion &&
    row.providerHash === source.providerHash && row.representationId === source.representationId &&
    row.networkContext === source.networkContext && row.accessContext === source.accessContext;
}
export class PlaybackEvidenceStore {
  private rows: PlaybackEvidence[] = [];
  private pending: Promise<void> = Promise.resolve();
  constructor(private storage: Storage, private deviceContext: string, private now = Date.now) {}
  async load(): Promise<void> {
    const raw = await this.storage.getItem(KEY);
    if (!raw || raw.length > 262144) return;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(data)) return;
    this.rows = data.slice(0, LIMIT).filter((value): value is PlaybackEvidence => {
      if (!value || typeof value !== 'object') return false;
      const row = value as PlaybackEvidence;
      return row.event === 'rendered-first-frame' && CONTENT.test(row.contentKey) &&
        ['bdix', 'nuvio', 'cloudstream'].includes(row.engine) && /^[a-f0-9]{64}$/.test(row.providerHash) &&
        REPRESENTATION.test(row.representationId) &&
        [row.providerId, row.providerVersion, row.networkContext, row.accessContext, row.deviceContext].every(text => typeof text === 'string' && text.length > 0 && text.length <= 300) &&
        Number.isFinite(row.at) && row.at >= 0 && row.at <= this.now() &&
        Number.isFinite(row.expiresAt) && row.expiresAt > this.now() && row.expiresAt <= row.at + TTL;
    });
  }
  recent(source: PlaybackSourceRef): PlaybackEvidence | undefined {
    if (!source.representationId || !REPRESENTATION.test(source.representationId)) return undefined;
    return this.rows.find(row => sameContext(row, source) && row.deviceContext === this.deviceContext && row.expiresAt > this.now());
  }
  record(source: PlaybackSourceRef): Promise<void> {
    if (!source.engine || !source.contentKey || !CONTENT.test(source.contentKey) || !source.providerId || !source.providerVersion ||
        !source.providerHash || !/^[a-f0-9]{64}$/.test(source.providerHash) || !source.networkContext || !source.accessContext ||
        !source.representationId || !REPRESENTATION.test(source.representationId)) return Promise.reject(new EngineError('configuration'));
    const at = this.now();
    const row: PlaybackEvidence = { contentKey: source.contentKey, engine: source.engine, providerId: source.providerId,
      providerVersion: source.providerVersion, providerHash: source.providerHash, representationId: source.representationId,
      networkContext: source.networkContext, accessContext: source.accessContext, deviceContext: this.deviceContext,
      at, expiresAt: at + TTL, event: 'rendered-first-frame' };
    this.rows = [row, ...this.rows.filter(previous => !sameContext(previous, source) && previous.expiresAt > at)].slice(0, LIMIT);
    const raw = JSON.stringify(this.rows);
    this.pending = this.pending.catch(() => undefined).then(() => this.storage.setItem(KEY, raw));
    return this.pending;
  }
  revoke(source: PlaybackSourceRef): void {
    this.rows = this.rows.filter(row => !sameContext(row, source));
    const raw = JSON.stringify(this.rows);
    this.pending = this.pending.catch(() => undefined).then(() => this.storage.setItem(KEY, raw));
    void this.pending.catch(() => undefined);
  }
  get count(): number { return this.rows.filter(row => row.deviceContext === this.deviceContext && row.expiresAt > this.now()).length; }
}
