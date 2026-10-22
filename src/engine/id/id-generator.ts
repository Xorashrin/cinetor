/**
 * Stable, deterministic identifier generator for content items, episodes, and sources.
 *
 * Guarantees that rescanning the same content or directories produces identical IDs,
 * preserving user progress, ratings, bookmarks, and downloads.
 */

/**
 * 32-bit FNV-1a non-cryptographic hash for fast, uniform, deterministic hashing.
 */
function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // 32-bit FNV prime: 16777619
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Normalizes title string by removing punctuation, extra spaces, and converting to lowercase.
 */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Generates a stable, deterministic ID for a Movie or Series.
 *
 * Example: generateContentId('movie', 'Interstellar', 2014) -> "cin_m_interstellar_2014_a8f3b20c"
 */
export function generateContentId(kind: 'movie' | 'series', name: string, year?: number): string {
  const normalized = normalizeTitleKey(name);
  const prefix = kind === 'movie' ? 'cin_m' : 'cin_s';
  const yearPart = year && year > 1900 && year < 2100 ? `_${year}` : '';
  const hash = fnv1a32(`${kind}:${normalized}:${year ?? ''}`);
  const slug = normalized.replace(/\s+/g, '_').slice(0, 24);
  return `${prefix}_${slug}${yearPart}_${hash}`;
}

/**
 * Generates a stable, deterministic ID for an Episode.
 *
 * Example: generateEpisodeId("cin_s_breaking_bad_2008_abc123", 1, 2) -> "cin_s_breaking_bad_2008_abc123_s01e02"
 */
export function generateEpisodeId(seriesId: string, seasonNumber: number, episodeNumber: number): string {
  const s = String(Math.max(0, seasonNumber)).padStart(2, '0');
  const e = String(Math.max(0, episodeNumber)).padStart(2, '0');
  return `${seriesId}_s${s}e${e}`;
}

/**
 * Generates a stable, deterministic ID for a MediaSource.
 *
 * Example: generateSourceId("http://bdix.local/movies") -> "src_bdix_local_movies_0b431730"
 */
export function generateSourceId(baseUrl: string): string {
  const normalizedUrl = baseUrl.trim().toLowerCase().replace(/\/+$/, '');
  const cleaned = normalizedUrl.replace(/^https?:\/\//, '');
  const slug = cleaned.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 24);
  const hash = fnv1a32(normalizedUrl);
  return `src_${slug}_${hash}`;
}

/**
 * Generates a unique scan job ID.
 */
export function generateScanJobId(sourceId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `job_${sourceId.slice(0, 12)}_${timestamp}_${random}`;
}
