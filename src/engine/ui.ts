import type { Title, Episode, Season, PlaybackSourceRef } from "../data/mock";
import type { Channel } from "../data/channels";
import type { ContentRecord } from "./model";
import type { CatalogRepository } from "./catalog";
export function toTitle(record: ContentRecord): Title {
  const refs = (season?: number, episode?: number): PlaybackSourceRef[] =>
    record.sources
      .filter((s) => s.season === season && s.episode === episode)
      .map((s) => ({
        url: s.url,
        sourceId: s.sourceId,
        verificationState: s.verification,
      }));
  const seasons: Season[] = [];
  if (record.kind === "series") {
    const grouped = new Map<number, Map<number, Episode>>();
    for (const p of record.sources) {
      if (!p.season || !p.episode) continue;
      let episodes = grouped.get(p.season);
      if (!episodes) {
        episodes = new Map();
        grouped.set(p.season, episodes);
      }
      episodes.set(p.episode, {
        id: `${record.id}:s${p.season}e${p.episode}`,
        number: p.episode,
        name: `Episode ${p.episode}`,
        runtime: record.runtime ?? 0,
        synopsis: "",
        seed: record.id,
        video: p.url,
        sources: refs(p.season, p.episode),
      });
    }
    for (const [number, episodes] of grouped)
      seasons.push({
        number,
        episodes: [...episodes.values()].sort((a, b) => a.number - b.number),
      });
    seasons.sort((a, b) => a.number - b.number);
  }
  const genres = [
    ...record.genres.filter(
      (g) => !["Anime", "K-Drama", "Adult (18+)"].includes(g),
    ),
  ];
  if (record.category === "anime") genres.push("Anime");
  if (record.category === "kdrama") genres.push("K-Drama");
  if (record.category === "adult") genres.push("Adult (18+)");
  return {
    id: record.id,
    name: record.title,
    kind: record.kind === "series" ? "series" : "movie",
    year: record.year ?? 0,
    maturity: record.category === "adult" ? "18+" : "UNRATED",
    runtime: record.runtime ?? 0,
    seasons,
    genres,
    moods: [],
    synopsis: record.synopsis ?? "",
    cast: [],
    creators: [],
    original: false,
    seed: record.id,
    tint: "#E50914",
    video: seasons[0]?.episodes[0]?.video ?? refs()[0]?.url ?? "",
    quality: [],
    posterUrl: record.poster,
    backdropUrl: record.backdrop,
    sources: refs(),
  };
}
export function toChannel(record: ContentRecord): Channel {
  const sources = record.sources.filter(
    (p) => p.season === undefined && p.episode === undefined,
  );
  return {
    id: record.id,
    name: record.title,
    logo: record.poster ?? "",
    url: sources[0]?.url ?? "",
    fallbacks: sources.slice(1).map((p) => p.url),
    country: record.country ?? "",
    category: record.genres[0] ?? "General",
    quality: "",
  };
}
export function feedTitles(
  catalog: CatalogRepository,
  category: "home" | "anime" | "kdrama",
): Title[] {
  return catalog
    .query(category)
    .filter((r) => r.kind !== "channel")
    .map(toTitle);
}
