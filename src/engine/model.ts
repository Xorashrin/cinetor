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
