import type { Badge, Kind, Maturity } from '../../data/mock';
import type { ClassificationResult, ContentClassifier } from '../interfaces/content-classifier';
import type { ParsedMediaInfo } from '../interfaces/filename-parser';

const ANIME_KEYWORDS = /\b(anime|shonen|shounen|seinen|isekai|naruto|one[.\s_]piece|bleach|jujutsu|demon[.\s_]slayer|attack[.\s_]on[.\s_]titan|my[.\s_]hero|chainsaw[.\s_]man|dragon[.\s_]ball|death[.\s_]note|haikyuu|gintama|tokyo[.\s_]ghoul|evangelion)\b/i;

const CARTOON_KEYWORDS = /\b(cartoon|kids|animation|disney|pixar|nickelodeon|dreamworks|barbie|pokemon|peppa|doraemon|ben[.\s_]?10|tom[.\s_]and[.\s_]jerry|motu[.\s_]patlu|chhota[.\s_]bheem|looney[.\s_]tunes|spongebob|scooby|mickey[.\s_]mouse|oggy)\b/i;

const KDRAMA_KEYWORDS = /\b(k[.\s_-]?drama|korean|hangul|squid[.\s_]game|crash[.\s_]landing|itaewon|vincenzo|glory|all[.\s_]of[.\s_]us[.\s_]are[.\s_]dead|goblin|descendants[.\s_]of[.\s_]the[.\s_]sun|hotel[.\s_]del[.\s_]luna|penthouse|queen[.\s_]of[.\s_]tears)\b/i;

const ADULT_KEYWORDS = /\b(18\+|xxx|erotic|uncensored|adult)\b/i;

const GENRE_RULES: Array<{ genre: string; regex: RegExp }> = [
  { genre: 'Action', regex: /\b(action|fight|war|battle|avengers|mission[.\s_]impossible|fast[.\s_]and[.\s_]furious|john[.\s_]wick|titan|attack|hunter)\b/i },
  { genre: 'Sci-Fi', regex: /\b(sci-?fi|science[.\s_]fiction|space|alien|interstellar|matrix|star[.\s_]wars|trek)\b/i },
  { genre: 'Fantasy', regex: /\b(fantasy|magic|dragon|lord[.\s_]of[.\s_]the[.\s_]rings|hobbit|harry[.\s_]potter|witcher)\b/i },
  { genre: 'Horror', regex: /\b(horror|zombie|ghost|paranormal|conjuring|evil[.\s_]dead|saw|halloween)\b/i },
  { genre: 'Thriller', regex: /\b(thriller|suspense|mystery|detective|sherlock|heist|crime)\b/i },
  { genre: 'Romance', regex: /\b(romance|romantic|love|wedding|valentine|crash[.\s_]landing)\b/i },
  { genre: 'Comedy', regex: /\b(comedy|funny|hilarious|sitcom)\b/i },
  { genre: 'Drama', regex: /\b(drama|emotional|tragedy|biography)\b/i },
  { genre: 'Crime', regex: /\b(crime|gangster|mafia|godfather|fbi|police)\b/i },
  { genre: 'Sports', regex: /\b(sports|football|soccer|cricket|basketball|boxing|racing|f1)\b/i },
];

/**
 * Intelligent rule-based classifier distinguishing Anime, Cartoons, K-Drama, Movies, and Series.
 */
export class RuleBasedContentClassifier implements ContentClassifier {
  public classify(info: ParsedMediaInfo, directorySegments: string[] = []): ClassificationResult {
    const kind: Kind = info.isEpisodic ? 'series' : 'movie';
    const textToScan = [
      info.title,
      ...directorySegments,
    ].join(' ').toLowerCase();

    const genres: string[] = [];
    const moods: string[] = [];
    let maturity: Maturity = '13+';
    let badge: Badge | undefined;
    let confidence = 0.75;

    // 1. Explicit Category Identification
    const isAnime = ANIME_KEYWORDS.test(textToScan) || directorySegments.some((s) => /anime/i.test(s));
    const isCartoon = CARTOON_KEYWORDS.test(textToScan) || directorySegments.some((s) => /cartoon|kids|animation/i.test(s));
    const isKDrama = KDRAMA_KEYWORDS.test(textToScan) || directorySegments.some((s) => /k[.\s_-]?drama|korean/i.test(s));

    if (isAnime) {
      genres.push('Anime');
      moods.push('Exciting', 'Imaginative');
      confidence = 0.95;
    }

    if (isCartoon && !isAnime) {
      genres.push('Kids');
      moods.push('Fun', 'Feel-Good');
      maturity = 'ALL';
      confidence = 0.95;
    }

    if (isKDrama) {
      genres.push('K-Drama');
      moods.push('Heartfelt', 'Emotional');
      confidence = 0.95;
    }

    // 2. Scan standard genre keywords
    for (const rule of GENRE_RULES) {
      if (rule.regex.test(textToScan) && !genres.includes(rule.genre)) {
        genres.push(rule.genre);
      }
    }

    // Baseline fallback genres if none detected
    if (genres.length === 0) {
      if (kind === 'series') {
        genres.push('Drama');
        moods.push('Binge-Worthy', 'Compelling');
      } else {
        genres.push('Action');
        moods.push('Exciting', 'Entertaining');
      }
      confidence = 0.65;
    }

    // Default moods if sparse
    if (moods.length === 0) {
      if (genres.includes('Action') || genres.includes('Sci-Fi')) {
        moods.push('Exciting', 'Mind-Bending');
      } else if (genres.includes('Romance')) {
        moods.push('Romantic', 'Intimate');
      } else if (genres.includes('Horror') || genres.includes('Thriller')) {
        moods.push('Ominous', 'Suspenseful');
      } else {
        moods.push('Popular', 'Engaging');
      }
    }

    // 3. Maturity Rating Determination
    if (ADULT_KEYWORDS.test(textToScan)) {
      maturity = '18+';
    } else if (genres.includes('Horror') || genres.includes('Crime')) {
      maturity = '16+';
    } else if (isCartoon && !isAnime) {
      maturity = 'ALL';
    } else {
      maturity = '13+';
    }

    // 4. Badges (e.g. recent year)
    const currentYear = new Date().getFullYear();
    if (info.year && info.year >= currentYear - 1) {
      badge = info.isEpisodic ? 'new-episode' : 'recently-added';
    }

    return {
      kind,
      genres,
      moods: moods.slice(0, 3),
      maturity,
      badge,
      confidence,
    };
  }
}
