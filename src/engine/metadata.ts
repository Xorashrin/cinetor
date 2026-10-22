import type { Candidate, Source } from "./model";
export const normalizeTitle = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim();
export function extractMetadata(
  candidate: Candidate,
  source: Source,
): Candidate {
  let title = normalizeTitle(candidate.title);
  const filename = /\.(mp4|m3u8)$/i.test(title);
  const coordinate = filename ? title.match(/\bS(\d{1,3})E(\d{1,4})\b/i) : null;
  const year = filename ? title.match(/\b(19\d{2}|20\d{2})\b/) : null;
  if (filename) {
    title = title
      .replace(/\.(mp4|m3u8)$/i, "")
      .replace(/\bS\d{1,3}E\d{1,4}\b/gi, "")
      .replace(/\b(19\d{2}|20\d{2})\b/g, "")
      .replace(
        /\b(480p|720p|1080p|2160p|x264|x265|h264|h265|webrip|web-dl|bluray)\b/gi,
        "",
      )
      .replace(/[._]/g, " ");
  }
  return {
    ...candidate,
    title: normalizeTitle(title),
    year: candidate.year ?? (year ? Number(year[1]) : undefined),
    season:
      candidate.season ?? (coordinate ? Number(coordinate[1]) : undefined),
    episode:
      candidate.episode ?? (coordinate ? Number(coordinate[2]) : undefined),
    kind: candidate.kind ?? (coordinate ? "series" : source.kind),
    category: candidate.category ?? source.category,
    language: candidate.language ?? source.language,
  };
}
export function identity(candidate: Candidate, source: Source): string {
  const group = JSON.stringify([
    candidate.title.toLowerCase(),
    candidate.year ?? "",
    candidate.kind,
    candidate.category,
    candidate.language ?? "",
    candidate.edition ?? "",
  ]);
  if (candidate.canonicalId && candidate.identityNamespace)
    return JSON.stringify([
      candidate.identityNamespace,
      candidate.canonicalId,
      candidate.kind,
      candidate.category,
      candidate.edition ?? "",
      candidate.year ?? "",
    ]);
  // Unknown years/editions never merge unrelated same-name titles across sources.
  return candidate.year && candidate.edition
    ? group
    : JSON.stringify([source.id, group]);
}
/** Full identity encoded losslessly; no truncated hash collisions or crypto/Node dependencies. */
export const contentId = (key: string): string =>
  "catalog:" + encodeURIComponent(key);
