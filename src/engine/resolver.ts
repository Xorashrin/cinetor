import type { CatalogRepository } from "./catalog";
import type { SourceRegistry } from "./sources";
import type { Playback } from "./model";
export class SourceResolver {
  constructor(
    private catalog: CatalogRepository,
    private registry: SourceRegistry,
    private now = Date.now,
  ) {}
  alternatives(
    id: string,
    season?: number,
    episode?: number,
    failed = new Set<string>(),
    adultAccess = false,
  ): Playback[] {
    const record = this.catalog.get(id);
    if (!record || (record.category === "adult" && !adultAccess)) return [];
    return record.sources
      .filter(
        (s) =>
          s.season === season &&
          s.episode === episode &&
          s.failedUntil <= this.now() &&
          !failed.has(s.url) &&
          !!this.registry.get(s.sourceId),
      )
      .sort(
        (a, b) =>
          Number(b.decoder === "verified") - Number(a.decoder === "verified") ||
          b.verifiedAt - a.verifiedAt,
      );
  }
}
