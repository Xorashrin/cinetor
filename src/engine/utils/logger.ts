import { maskUrl } from '../security/url-validator';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

export class Logger {
  constructor(private readonly component: string, private readonly enabled: boolean = true) {}

  public debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  public info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  public warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  public error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;

    const sanitizedData = data ? this.sanitizeData(data) : undefined;
    const entry: StructuredLog = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message: this.sanitizeString(message),
      data: sanitizedData,
    };

    if (level === 'error') {
      console.error(`[${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}`, entry.data ?? '');
    } else if (level === 'warn') {
      console.warn(`[${entry.level.toUpperCase()}] [${entry.component}] ${entry.message}`, entry.data ?? '');
    }
  }

  private sanitizeString(str: string): string {
    return maskUrl(str);
  }

  private sanitizeData(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const keyLower = k.toLowerCase();
      if (keyLower.includes('password') || keyLower.includes('token') || keyLower.includes('auth') || keyLower.includes('secret')) {
        out[k] = '***';
      } else if (typeof v === 'string') {
        out[k] = this.sanitizeString(v);
      } else if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = this.sanitizeData(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
