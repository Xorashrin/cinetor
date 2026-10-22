import type { Quality } from '../../data/mock';

/**
 * Parsed media metadata extracted from filenames, folder paths, and file tokens.
 */
export interface ParsedMediaInfo {
  /** Clean normalized title of the media */
  title: string;
  /** Original filename before parsing */
  originalFilename?: string;
  /** Extracted release year (e.g., 2024) */
  year?: number;
  /** Season number if episodic (e.g., 1 for S01) */
  seasonNumber?: number;
  /** Primary episode number if episodic (e.g., 5 for E05) */
  episodeNumber?: number;
  /** All episode numbers if multi-episode file (e.g., [1, 2] for S01E01-E02) */
  episodeNumbers?: number[];
  /** Whether the media represents episodic series content */
  isEpisodic: boolean;
  /** Clean subtitle / episode name if included in the filename */
  episodeTitle?: string;
  /** Video resolution tag (e.g., '4K', '1080p', '720p', '480p') */
  resolution?: string;
  /** Mapped Netflix-style quality indicators ('HD', '4K', 'HDR', '5.1', etc.) */
  quality: Quality[];
  /** File container extension without dot (e.g., 'mkv', 'mp4') */
  container?: string;
  /** Detected video codec (e.g., 'hevc', 'h264', 'av1') */
  videoCodec?: string;
  /** Detected audio codec (e.g., 'aac', 'ac3', 'dts') */
  audioCodec?: string;
  /** Release group or source token (e.g., 'BluRay', 'WEB-DL', 'HDTV') */
  sourceType?: string;
  /** Detected language tracks or audio dubs (e.g., ['Bangla', 'Hindi', 'English']) */
  languages?: string[];
  /** File size in bytes if provided by the source */
  fileSizeBytes?: number;
  /** File last modification timestamp in ms if provided by the source */
  lastModified?: number;
}

/**
 * Parser interface for extracting structured media metadata from raw file paths and filenames.
 */
export interface FilenameParser {
  /**
   * Parses a filename or relative file path into structured media information.
   *
   * @param filenameOrPath The filename (e.g., 'Breaking.Bad.S01E02.720p.mkv') or full path
   * @param parentDirectory Optional parent folder name to assist contextual recognition
   * @param metadata Optional file size or timestamp metadata from the source
   */
  parse(
    filenameOrPath: string,
    parentDirectory?: string,
    metadata?: { sizeBytes?: number; lastModified?: number },
  ): ParsedMediaInfo;
}
