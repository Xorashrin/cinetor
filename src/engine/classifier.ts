import type { Candidate, Source } from "./model";
export function classify(
  candidate: Candidate,
  source: Source,
): {
  confidence: "explicit" | "source-convention";
  metadata: "complete" | "incomplete";
} | null {
  if (
    !candidate.title ||
    /[\x00-\x1f]/.test(candidate.title) ||
    candidate.title.length > 300 ||
    !candidate.kind ||
    !candidate.category
  )
    return null;
  const adultLike =
    candidate.adult ||
    candidate.category === "adult" ||
    [candidate.title, ...candidate.genres].some((g) =>
      /\b(adult|xxx|porn|erotic|pornography)\b|\(18\+\)/i.test(g),
    );
  if (source.restricted) {
    if (!source.legalContentAttested || candidate.category !== "adult")
      return null;
  } else if (adultLike) return null;
  if (
    candidate.kind === "channel" &&
    !["live", "adult"].includes(candidate.category)
  )
    return null;
  if (candidate.kind !== "channel" && candidate.category === "live")
    return null;
  if (
    candidate.category === "kdrama" &&
    (candidate.kind !== "series" ||
      !/^(ko|kor|korean)$/i.test(candidate.language ?? ""))
  )
    return null;
  if (candidate.kind === "series" && (!candidate.season || !candidate.episode))
    return null;
  // Anime needs explicit category or authorized source convention, never animation/filename guessing.
  return {
    confidence:
      source.category === candidate.category ? "source-convention" : "explicit",
    metadata: candidate.year && candidate.language ? "complete" : "incomplete",
  };
}
