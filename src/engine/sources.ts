import { EngineError, SourceSchema, type Source, type Storage } from "./model";
import { authorizedUrl, cleanUrl } from "./security";
export const SOURCE_KEY = "cinetor:engine:sources:v1";
export class SourceRegistry {
  private sources: Source[] = [];
  invalidCount = 0;
  constructor(
    private storage: Storage,
    private bundled: unknown[] = [],
  ) {}
  validate(input: unknown): Source {
    const parsed = SourceSchema.safeParse(input);
    if (!parsed.success) throw new EngineError("configuration");
    const s = parsed.data;
    if (
      cleanUrl(s.endpoint).protocol !== s.protocol + ":" ||
      (s.restricted && (!s.legalContentAttested || s.category !== "adult")) ||
      (!s.restricted && s.category === "adult")
    )
      throw new EngineError("configuration");
    for (const scope of s.scopes) {
      const url = cleanUrl(scope.origin);
      if (
        url.origin !== scope.origin ||
        scope.pathPrefix.includes("..") ||
        scope.pathPrefix.includes("\\") ||
        scope.pathPrefix.includes("%")
      )
        throw new EngineError("configuration");
    }
    authorizedUrl(s.endpoint, s);
    return s;
  }
  async load(): Promise<void> {
    let input: unknown = this.bundled;
    const raw = await this.storage.getItem(SOURCE_KEY);
    if (raw) {
      try {
        const saved: unknown = JSON.parse(raw);
        if (Array.isArray(saved)) input = [...this.bundled, ...saved];
        else this.invalidCount++;
      } catch {
        this.invalidCount++;
      }
    }
    const map = new Map<string, Source>();
    if (Array.isArray(input))
      for (const entry of input.slice(0, 100)) {
        try {
          const s = this.validate(entry);
          map.set(s.id, s);
        } catch {
          this.invalidCount++;
        }
      }
    this.sources = [...map.values()];
  }
  async configure(input: unknown[]): Promise<void> {
    if (input.length > 100) throw new EngineError("configuration");
    const sources = input.map((s) => this.validate(s));
    if (new Set(sources.map((s) => s.id)).size !== sources.length)
      throw new EngineError("configuration");
    await this.storage.setItem(SOURCE_KEY, JSON.stringify(sources));
    this.sources = sources;
  }
  all(): Source[] {
    return this.sources;
  }
  get(id: string): Source | undefined {
    return this.sources.find((s) => s.id === id && s.enabled);
  }
}
