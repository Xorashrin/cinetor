import { z } from "zod";
import {
  RecordSchema,
  EngineError,
  type Candidate,
  type ContentRecord,
  type Playback,
  type Source,
  type Storage,
} from "./model";
import { artwork, authorizedUrl } from "./security";
import { classify } from "./classifier";
import { identity, contentId } from "./metadata";
import type { SourceRegistry } from "./sources";
export const CATALOG_KEY = "cinetor:engine:catalog:v2";
const Snapshot = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  records: z.array(z.unknown()).max(5000),
});
export class CatalogRepository {
  private records = new Map<string, ContentRecord>();
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  version = 0;
  recovery: "clean" | "backup" | "corrupt" = "clean";
  constructor(
    private storage: Storage,
    private registry: SourceRegistry,
    private now = Date.now,
  ) {}
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private validRecord(input: unknown): ContentRecord | null {
    const parsed = RecordSchema.safeParse(input);
    if (!parsed.success) return null;
    const r = parsed.data;
    const sources = r.sources.filter((p) => {
      const s = this.registry.get(p.sourceId);
      if (!s || s.restricted !== (r.category === "adult")) return false;
      try {
        return authorizedUrl(p.url, s) === p.url;
      } catch {
        return false;
      }
    });
    if (
      !sources.length ||
      (r.kind === "channel" && !["live", "adult"].includes(r.category)) ||
      (r.category === "live" && r.kind !== "channel") ||
      (r.kind === "series" && sources.some((s) => !s.season || !s.episode))
    )
      return null;
    const primary = this.registry.get(sources[0].sourceId);
    if (
      !primary ||
      !classify(
        {
          title: r.title,
          url: sources[0].url,
          kind: r.kind,
          category: r.category,
          year: r.year,
          language: r.language,
          genres: r.genres,
          adult: r.category === "adult",
          season: sources[0].season,
          episode: sources[0].episode,
        },
        primary,
      )
    )
      return null;
    return {
      ...r,
      sources,
      poster: primary ? artwork(r.poster, primary) : undefined,
      backdrop: primary ? artwork(r.backdrop, primary) : undefined,
    };
  }
  async load(): Promise<void> {
    for (const [index, key] of [
      CATALOG_KEY,
      CATALOG_KEY + ":backup",
    ].entries()) {
      const raw = await this.storage.getItem(key);
      if (!raw) continue;
      try {
        const snapshot = Snapshot.parse(JSON.parse(raw));
        const rows: ContentRecord[] = [];
        for (const input of snapshot.records) {
          // Additive v1 -> v2 migration only for records with existing evidence, never legacy engine caches.
          const migrated =
            snapshot.schemaVersion === 1 &&
            typeof input === "object" &&
            input !== null
              ? { ...input, stage: "published" }
              : input;
          const valid = this.validRecord(migrated);
          if (valid) rows.push(valid);
        }
        this.records = new Map(rows.map((r) => [r.id, r]));
        if (index) this.recovery = "backup";
        this.publish();
        return;
      } catch {
        this.recovery = "corrupt";
      }
    }
  }
  private publish(): void {
    this.version++;
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }
  all(): ContentRecord[] {
    return [...this.records.values()];
  }
  get(id: string): ContentRecord | undefined {
    return this.records.get(id);
  }
  query(
    category: ContentRecord["category"],
    adultAccess = false,
  ): ContentRecord[] {
    if (category === "adult" && !adultAccess) return [];
    return this.all().filter(
      (r) =>
        r.category === category &&
        r.sources.some((p) => !!this.registry.get(p.sourceId)),
    );
  }
  private mutate(
    fn: (records: Map<string, ContentRecord>) => void,
  ): Promise<void> {
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        const records = new Map(this.records);
        fn(records);
        const raw = JSON.stringify({
          schemaVersion: 2,
          records: [...records.values()],
        });
        if (raw.length > 8 * 1024 * 1024) throw new EngineError("storage");
        try {
          const previous = await this.storage.getItem(CATALOG_KEY);
          if (previous && this.recovery === "clean")
            await this.storage.setItem(CATALOG_KEY + ":backup", previous);
          await this.storage.setItem(CATALOG_KEY, raw);
        } catch {
          throw new EngineError("storage");
        }
        this.records = records;
        this.recovery = "clean";
        this.publish();
      });
    this.queue = operation;
    return operation;
  }
  upsert(
    candidate: Candidate,
    source: Source,
    playback: Playback,
    classification: {
      confidence: ContentRecord["confidence"];
      metadata: ContentRecord["metadata"];
    },
    originalTitle = candidate.title,
  ): Promise<void> {
    return this.mutate((records) => {
      if (
        !candidate.kind ||
        !candidate.category ||
        playback.verification !== "transport-verified"
      )
        throw new EngineError("unsupported");
      if (!classify(candidate, source)) throw new EngineError("unsupported");
      if (!RecordSchema.shape.sources.element.safeParse(playback).success)
        throw new EngineError("unsupported");
      if (
        playback.sourceId !== source.id ||
        playback.season !== candidate.season ||
        playback.episode !== candidate.episode ||
        authorizedUrl(playback.url, source) !==
          authorizedUrl(candidate.url, source)
      )
        throw new EngineError("unsupported");
      const key = identity(candidate, source),
        id = contentId(key),
        previous = records.get(id),
        now = this.now();
      if (!previous && records.size >= 5000) throw new EngineError("size");
      const sources = [
        ...(previous?.sources ?? []).filter(
          (p) =>
            !(
              p.sourceId === playback.sourceId &&
              p.url === playback.url &&
              p.season === playback.season &&
              p.episode === playback.episode
            ),
        ),
        playback,
      ].slice(-50);
      const provenance = [
        ...(previous?.provenance ?? []).filter((p) => p.sourceId !== source.id),
        { sourceId: source.id, originalTitle: originalTitle.slice(0, 300) },
      ].slice(-50);
      records.set(id, {
        id,
        identity: key,
        title: candidate.title,
        normalizedTitle: candidate.title.toLowerCase(),
        kind: candidate.kind,
        category: candidate.category,
        edition: candidate.edition,
        year: candidate.year,
        language: candidate.language,
        country: candidate.country,
        genres: candidate.genres,
        synopsis: candidate.synopsis ?? previous?.synopsis,
        rating: candidate.rating ?? previous?.rating,
        runtime: candidate.runtime,
        poster: artwork(candidate.poster, source) ?? previous?.poster,
        backdrop: artwork(candidate.backdrop, source) ?? previous?.backdrop,
        ...classification,
        sources,
        provenance,
        lastSeen: now,
        updatedAt: now,
        stage: "published",
      });
    });
  }
  reportPlayback(id: string, url: string, decoded: boolean): Promise<void> {
    return this.mutate((records) => {
      const r = records.get(id);
      if (!r) return;
      records.set(id, {
        ...r,
        sources: r.sources.map((p) =>
          p.url === url
            ? {
                ...p,
                decoder: decoded ? "verified" : p.decoder,
                failedUntil: decoded ? 0 : this.now() + 15 * 60 * 1000,
              }
            : p,
        ),
        updatedAt: this.now(),
      });
    });
  }
}
