/**
 * Structured error codes for the BDIX content parser engine.
 */
export const EngineErrorCode = {
  UNKNOWN: 'ENGINE_UNKNOWN',
  NETWORK_ERROR: 'ENGINE_NETWORK_ERROR',
  TIMEOUT: 'ENGINE_TIMEOUT',
  CANCELLED: 'ENGINE_CANCELLED',
  PARSE_ERROR: 'ENGINE_PARSE_ERROR',
  SOURCE_UNREACHABLE: 'ENGINE_SOURCE_UNREACHABLE',
  SOURCE_NOT_FOUND: 'ENGINE_SOURCE_NOT_FOUND',
  UNSUPPORTED_PROTOCOL: 'ENGINE_UNSUPPORTED_PROTOCOL',
  LIMIT_EXCEEDED: 'ENGINE_LIMIT_EXCEEDED',
  STORAGE_ERROR: 'ENGINE_STORAGE_ERROR',
  INVALID_ARGUMENT: 'ENGINE_INVALID_ARGUMENT',
  SECURITY_ERROR: 'ENGINE_SECURITY_ERROR',
  VERIFICATION_FAILED: 'ENGINE_VERIFICATION_FAILED',
} as const;

export type EngineErrorCode = (typeof EngineErrorCode)[keyof typeof EngineErrorCode];

/**
 * Base error class for all engine-specific exceptions.
 */
export class EngineError extends Error {
  public readonly code: EngineErrorCode;
  public readonly timestamp: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: EngineErrorCode = EngineErrorCode.UNKNOWN,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.timestamp = Date.now();
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      details: this.details,
    };
  }
}

export class NetworkError extends EngineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, EngineErrorCode.NETWORK_ERROR, details);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends EngineError {
  constructor(message: string = 'Operation timed out', details?: Record<string, unknown>) {
    super(message, EngineErrorCode.TIMEOUT, details);
    this.name = 'TimeoutError';
  }
}

export class CancellationError extends EngineError {
  constructor(message: string = 'Operation was cancelled', details?: Record<string, unknown>) {
    super(message, EngineErrorCode.CANCELLED, details);
    this.name = 'CancellationError';
  }
}

export class ParseError extends EngineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, EngineErrorCode.PARSE_ERROR, details);
    this.name = 'ParseError';
  }
}

export class LimitExceededError extends EngineError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, EngineErrorCode.LIMIT_EXCEEDED, details);
    this.name = 'LimitExceededError';
  }
}
