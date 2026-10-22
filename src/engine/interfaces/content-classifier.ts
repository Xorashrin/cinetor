import type { Badge, Kind, Maturity } from '../../data/mock';
import type { ParsedMediaInfo } from './filename-parser';

/**
 * Result of classifying media into Cinator categories, kind, maturity, and genres.
 */
export interface ClassificationResult {
  kind: Kind;
  genres: string[];
  moods: string[];
  maturity: Maturity;
  badge?: Badge;
  confidence: number; // 0.0 to 1.0
}

/**
 * Classifier interface responsible for identifying media genres (Anime, K-Drama, Action, etc.),
 * content kind (movie vs. series), and maturity ratings using metadata, directory context, and keywords.
 */
export interface ContentClassifier {
  /**
   * Classifies parsed media information along with its directory hierarchy context.
   *
   * @param info Parsed metadata from the filename parser
   * @param directorySegments Path hierarchy segments (e.g., ['Anime', 'Attack on Titan', 'Season 4'])
   */
  classify(info: ParsedMediaInfo, directorySegments?: string[]): ClassificationResult;
}
