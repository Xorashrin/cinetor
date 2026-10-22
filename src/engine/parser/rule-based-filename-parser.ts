import type { Quality } from '../../data/mock';
import type { FilenameParser, ParsedMediaInfo } from '../interfaces/filename-parser';

// Patterns for episodic notation supporting both Latin and Unicode/Bengali
const SEASON_EPISODE_REGEX = /(?:^|[.\s_(\[-])[sS](\d{1,2})[eE](\d{1,3})(?:-[eE]?(\d{1,3}))?(?:$|[.\s_)\]-])/;
const X_EPISODE_REGEX = /(?:^|[.\s_(\[-])(\d{1,2})x(\d{1,3})(?:$|[.\s_)\]-])/;
const EP_STANDALONE_REGEX = /(?:^|[.\s_(\[-])(?:ep|episode|পর্ব)[.\s_-]*(\d{1,3})(?:$|[.\s_)\]-])/i;
const SEASON_FOLDER_REGEX = /(?:^|[.\s_(\[-])(?:season|s|সিজন)[.\s_-]*(\d{1,2})(?:$|[.\s_)\]-])/i;

// Release year regex (1900 - 2099)
const YEAR_REGEX = /\b(19\d\d|20\d\d)\b/;
const BRACKETED_YEAR_REGEX = /[\(\[]\s*(19\d\d|20\d\d)\s*[\)\]]/;
const DOTTED_YEAR_REGEX = /[._](19\d\d|20\d\d)[._]/;

// Video & Audio tags
const RESOLUTION_REGEX = /\b(2160p|4k|uhd|1080p|1080i|720p|576p|480p)\b/i;
const HDR_REGEX = /\b(hdr(?:10(?:\+)?)?|dolby[.\s-]?vision|dv)\b/i;
const SURROUND_REGEX = /\b(5\.1|7\.1|dd5\.1|dts(?:-hd)?|atmos)\b/i;

const VIDEO_CODEC_REGEX = /\b(x264|h\.?264|avc|x265|h\.?265|hevc|av1|xvid)\b/i;
const AUDIO_CODEC_REGEX = /\b(aac|ac3|eac3|dts|flac|mp3)\b/i;
const SOURCE_TYPE_REGEX = /\b(bluray|bdrip|web-?dl|webrip|hdtv|dvdrip|cam|telesync)\b/i;

// Language tags
const LANGUAGE_RULES: Array<{ language: string; regex: RegExp }> = [
  { language: 'Bangla', regex: /\b(bangla|bengali|বাংলা)\b/i },
  { language: 'Hindi', regex: /\b(hindi|হিন্দি)\b/i },
  { language: 'English', regex: /\b(english|eng)\b/i },
  { language: 'Tamil', regex: /\b(tamil)\b/i },
  { language: 'Telugu', regex: /\b(telugu)\b/i },
  { language: 'Korean', regex: /\b(korean|kor)\b/i },
  { language: 'Japanese', regex: /\b(japanese|jap)\b/i },
  { language: 'Dual Audio', regex: /\b(dual[.\s_-]?audio|multi[.\s_-]?audio)\b/i },
];

const STRIP_TOKENS_REGEX = new RegExp(
  [
    RESOLUTION_REGEX.source,
    HDR_REGEX.source,
    SURROUND_REGEX.source,
    VIDEO_CODEC_REGEX.source,
    AUDIO_CODEC_REGEX.source,
    SOURCE_TYPE_REGEX.source,
    /\b(repack|proper|remux|extended|unrated|multi|dubbed|subbed|esub|esubs)\b/i.source,
  ].join('|'),
  'gi',
);

/**
 * Robust rule-based filename parser.
 * Supports Unicode, Bengali titles, episodic extraction, codecs, and language indicators.
 */
export class RuleBasedFilenameParser implements FilenameParser {
  public parse(
    filenameOrPath: string,
    parentDirectory?: string,
    metadata?: { sizeBytes?: number; lastModified?: number },
  ): ParsedMediaInfo {
    const normalized = filenameOrPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    const basename = parts.pop() ?? filenameOrPath;
    const parent = parentDirectory || (parts.length > 0 ? parts[parts.length - 1] : '');
    const grandparent = parts.length > 1 ? parts[parts.length - 2] : undefined;

    const dotIndex = basename.lastIndexOf('.');
    const container = dotIndex > 0 ? basename.slice(dotIndex + 1).toLowerCase() : undefined;
    const nameWithoutExt = dotIndex > 0 ? basename.slice(0, dotIndex) : basename;

    // Detect Year
    let year: number | undefined;
    const bracketedMatch = nameWithoutExt.match(BRACKETED_YEAR_REGEX) || parent.match(BRACKETED_YEAR_REGEX);
    if (bracketedMatch) {
      year = parseInt(bracketedMatch[1], 10);
    } else {
      const yearMatch = nameWithoutExt.match(YEAR_REGEX) || parent.match(YEAR_REGEX);
      if (yearMatch) {
        const parsedYear = parseInt(yearMatch[1], 10);
        if (parsedYear >= 1900 && parsedYear <= 2100) {
          year = parsedYear;
        }
      }
    }

    // Detect Season & Episode
    let seasonNumber: number | undefined;
    let episodeNumber: number | undefined;
    let episodeNumbers: number[] | undefined;
    let isEpisodic = false;

    const seMatch = nameWithoutExt.match(SEASON_EPISODE_REGEX);
    if (seMatch) {
      seasonNumber = parseInt(seMatch[1], 10);
      episodeNumber = parseInt(seMatch[2], 10);
      isEpisodic = true;
      if (seMatch[3]) {
        const endEp = parseInt(seMatch[3], 10);
        episodeNumbers = [];
        for (let ep = episodeNumber; ep <= endEp; ep++) {
          episodeNumbers.push(ep);
        }
      }
    } else {
      const xMatch = nameWithoutExt.match(X_EPISODE_REGEX);
      if (xMatch) {
        seasonNumber = parseInt(xMatch[1], 10);
        episodeNumber = parseInt(xMatch[2], 10);
        isEpisodic = true;
      } else {
        const epMatch = nameWithoutExt.match(EP_STANDALONE_REGEX);
        if (epMatch) {
          episodeNumber = parseInt(epMatch[1], 10);
          isEpisodic = true;
          const seasonFolderMatch = parent.match(SEASON_FOLDER_REGEX);
          seasonNumber = seasonFolderMatch ? parseInt(seasonFolderMatch[1], 10) : 1;
        }
      }
    }

    if (!isEpisodic && parent) {
      const seasonFolderMatch = parent.match(SEASON_FOLDER_REGEX);
      if (seasonFolderMatch) {
        seasonNumber = parseInt(seasonFolderMatch[1], 10);
        isEpisodic = true;
      }
    }

    // Detect Resolution & Quality Tags
    let resolution: string | undefined;
    const quality: Quality[] = ['CC'];

    const resMatch = nameWithoutExt.match(RESOLUTION_REGEX);
    if (resMatch) {
      const tag = resMatch[1].toLowerCase();
      if (tag === '2160p' || tag === '4k' || tag === 'uhd') {
        resolution = '4K';
        quality.push('4K');
      } else if (tag === '1080p' || tag === '1080i') {
        resolution = '1080p';
        quality.push('HD');
      } else if (tag === '720p') {
        resolution = '720p';
        quality.push('HD');
      } else {
        resolution = '480p';
      }
    } else {
      quality.push('HD');
    }

    if (HDR_REGEX.test(nameWithoutExt)) {
      quality.push('HDR');
    }
    if (SURROUND_REGEX.test(nameWithoutExt)) {
      quality.push('5.1');
    }

    // Codecs
    const videoCodecMatch = nameWithoutExt.match(VIDEO_CODEC_REGEX);
    const videoCodec = videoCodecMatch ? videoCodecMatch[1].toLowerCase().replace('.', '') : undefined;

    const audioCodecMatch = nameWithoutExt.match(AUDIO_CODEC_REGEX);
    const audioCodec = audioCodecMatch ? audioCodecMatch[1].toLowerCase() : undefined;

    const sourceMatch = nameWithoutExt.match(SOURCE_TYPE_REGEX);
    const sourceType = sourceMatch ? sourceMatch[1].toUpperCase() : undefined;

    // Detect Languages
    const languages: string[] = [];
    for (const rule of LANGUAGE_RULES) {
      if (rule.regex.test(nameWithoutExt) || rule.regex.test(parent)) {
        languages.push(rule.language);
      }
    }

    // Clean title extraction
    // If year is bracketed e.g. "(2022)", remove "(2022)" and split only at technical release tags
    let rawTitle = nameWithoutExt;
    if (bracketedMatch) {
      rawTitle = rawTitle.replace(BRACKETED_YEAR_REGEX, ' ');
    }

    const splitIndex = this.findTechnicalTokenIndex(rawTitle);
    if (splitIndex >= 0) {
      rawTitle = rawTitle.slice(0, splitIndex);
    }

    let title = rawTitle
      .replace(SEASON_EPISODE_REGEX, ' ')
      .replace(X_EPISODE_REGEX, ' ')
      .replace(EP_STANDALONE_REGEX, ' ')
      .replace(DOTTED_YEAR_REGEX, ' ')
      .replace(YEAR_REGEX, ' ')
      .replace(/[._]/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(STRIP_TOKENS_REGEX, ' ')
      .replace(/[\(\[\{\-–—\s]+$/, '')
      .replace(/^\s*[\)\]\}\-–—]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Fallback if empty
    if (!title || title.length < 2) {
      const fallbackFolder = parent.match(SEASON_FOLDER_REGEX) ? grandparent : parent;
      const fallbackName = fallbackFolder || nameWithoutExt;
      title = fallbackName
        .replace(/[._]/g, ' ')
        .replace(/\b(19\d\d|20\d\d)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return {
      title,
      originalFilename: basename,
      year,
      seasonNumber,
      episodeNumber,
      episodeNumbers,
      isEpisodic,
      resolution,
      quality: Array.from(new Set(quality)),
      container,
      videoCodec,
      audioCodec,
      sourceType,
      languages: languages.length > 0 ? languages : undefined,
      fileSizeBytes: metadata?.sizeBytes,
      lastModified: metadata?.lastModified,
    };
  }

  private findTechnicalTokenIndex(str: string): number {
    const patterns = [
      SEASON_EPISODE_REGEX,
      X_EPISODE_REGEX,
      DOTTED_YEAR_REGEX,
      RESOLUTION_REGEX,
      VIDEO_CODEC_REGEX,
      SOURCE_TYPE_REGEX,
    ];
    let minIndex = str.length;
    for (const pat of patterns) {
      const match = str.match(pat);
      if (match && match.index !== undefined && match.index < minIndex) {
        minIndex = match.index;
      }
    }
    return minIndex === str.length ? -1 : minIndex;
  }
}
