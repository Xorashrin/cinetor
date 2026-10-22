import { z } from "zod";

export const Category = z.enum(["home", "anime", "kdrama", "live", "adult"]);
export const Kind = z.enum(["movie", "series", "channel"]);
export const Scope = z.object({
  origin: z.string().url(),
  pathPrefix: z.string().startsWith("/"),
});
export const SourceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  enabled: z.boolean(),
  authorized: z.literal(true),
  protocol: z.enum(["http", "https"]),
  endpoint: z.string().url(),
  adapter: z.enum(["json", "html-directory", "m3u", "direct"]),
  scopes: z.array(Scope).min(1).max(20),
  allowPrivateNetwork: z.boolean().default(false),
  authRef: z
    .string()
    .regex(/^[\w.-]{1,100}$/)
    .optional(),
  timeoutMs: z.number().int().min(500).max(15000).default(8000),
  retries: z.number().int().min(0).max(3).default(1),
  minRequestIntervalMs: z.number().int().min(100).max(30000).default(500),
  refreshMs: z.number().int().min(900000).default(21600000),
  maxResponseBytes: z.number().int().min(1024).max(2097152).default(524288),
  expectedContentTypes: z.array(z.string().max(100)).min(1),
  category: Category.optional(),
  kind: Kind.optional(),
  language: z.string().max(100).optional(),
  maxDepth: z.number().int().min(0).max(4).default(2),
  maxPages: z.number().int().min(1).max(40).default(20),
  restricted: z.boolean().default(false),
  legalContentAttested: z.boolean().default(false),
  directMetadata: z.record(z.string(), z.unknown()).optional(),
});
export type Source = z.infer<typeof SourceSchema>;
export const CandidateSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().min(1).max(4096),
  kind: Kind.optional(),
  category: Category.optional(),
  canonicalId: z.string().max(150).optional(),
  identityNamespace: z.string().max(100).optional(),
  edition: z.string().max(100).optional(),
  year: z.number().int().min(1880).max(2200).optional(),
  language: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  genres: z.array(z.string().max(80)).max(30).default([]),
  synopsis: z.string().max(5000).optional(),
  rating: z.number().min(0).max(10).optional(),
  poster: z.string().max(4096).optional(),
  backdrop: z.string().max(4096).optional(),
  season: z.number().int().min(1).max(1000).optional(),
  episode: z.number().int().min(1).max(10000).optional(),
  runtime: z.number().min(0).max(2000).optional(),
  adult: z.boolean().default(false),
});
export type Candidate = z.infer<typeof CandidateSchema>;
export const PlaybackSchema = z.object({
  sourceId: z.string(),
  url: z.string().url(),
  verification: z.literal("transport-verified"),
  method: z.enum(["mp4-range", "hls-segment"]),
  decoder: z.enum(["unverified", "verified"]).default("unverified"),
  verifiedAt: z.number(),
  failedUntil: z.number().default(0),
  season: z.number().optional(),
  episode: z.number().optional(),
});
export type Playback = z.infer<typeof PlaybackSchema>;
export const RecordSchema = z.object({
  id: z.string(),
  identity: z.string(),
  title: z.string().min(1),
  normalizedTitle: z.string(),
  kind: Kind,
  category: Category,
  edition: z.string().optional(),
  year: z.number().optional(),
  language: z.string().optional(),
  country: z.string().optional(),
  genres: z.array(z.string()),
  synopsis: z.string().optional(),
  rating: z.number().optional(),
  poster: z.string().optional(),
  backdrop: z.string().optional(),
  runtime: z.number().optional(),
  confidence: z.enum(["explicit", "source-convention"]),
  metadata: z.enum(["complete", "incomplete"]),
  sources: z.array(PlaybackSchema).min(1),
  lastSeen: z.number(),
  updatedAt: z.number(),
  provenance: z
    .array(
      z.object({ sourceId: z.string(), originalTitle: z.string().max(300) }),
    )
    .max(50),
  stage: z.literal("published"),
});
export type ContentRecord = z.infer<typeof RecordSchema>;
export type ErrorCode =
  | "configuration"
  | "offline"
  | "timeout"
  | "cancelled"
  | "network"
  | "authentication"
  | "permission"
  | "http"
  | "rate-limit"
  | "size"
  | "malformed"
  | "unsupported"
  | "scope"
  | "storage";
export class EngineError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}
export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export interface ParsedPage {
  candidates: Candidate[];
  directories: string[];
  rejected: number;
}
export interface PageJob {
  url: string;
  depth: number;
}
export interface SourceState {
  status: "idle" | "running" | "completed" | "failed";
  lastSuccess?: number;
  lastError?: ErrorCode;
  nextEligible: number;
  failures: number;
  etag?: string;
  modified?: string;
  queue?: PageJob[];
  pages?: number;
}
