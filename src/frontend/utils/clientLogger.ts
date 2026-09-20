import { errorMessage } from './errors.js';

export type ClientLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface ClientLogEntry {
  id: string;
  timestamp: string;
  level: ClientLogLevel;
  category: string;
  message: string;
  data?: unknown;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

class ClientLogger {
  private buffer: ClientLogEntry[] = [];
  private maxBufferSize = 150;
  private listeners: Array<() => void> = [];
  private initialized = false;

  constructor() {
    if (typeof window !== 'undefined' && !this.initialized) {
      this.initGlobalErrorHandlers();
      this.initialized = true;
    }
  }

  private initGlobalErrorHandlers() {
    window.addEventListener('error', (event) => {
      this.error('UNCAUGHT_EXCEPTION', event.message, event.error, {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const message = reason?.message || String(reason);
      this.error('UNHANDLED_REJECTION', message, reason);
    });
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch { /* intentionally ignored: non-fatal */ }
    }
  }

  public getLogs(): ClientLogEntry[] {
    return [...this.buffer].reverse();
  }

  public clear(): void {
    this.buffer = [];
    this.notify();
  }

  public log(level: ClientLogLevel, category: string, message: string, data?: unknown, err?: unknown): ClientLogEntry {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timestamp = new Date().toISOString();

    const errorObj = err ? {
      message: errorMessage(err, String(err)),
      stack: err instanceof Error ? err.stack : undefined,
      code: (err as { code?: string } | undefined)?.code
    } : undefined;

    const entry: ClientLogEntry = {
      id,
      timestamp,
      level,
      category,
      message,
      data,
      error: errorObj
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }

    this.notify();
    return entry;
  }

  public debug(category: string, message: string, data?: unknown): ClientLogEntry {
    return this.log('DEBUG', category, message, data);
  }

  public info(category: string, message: string, data?: unknown): ClientLogEntry {
    return this.log('INFO', category, message, data);
  }

  public warn(category: string, message: string, data?: unknown): ClientLogEntry {
    return this.log('WARN', category, message, data);
  }

  public error(category: string, message: string, err?: unknown, data?: unknown): ClientLogEntry {
    return this.log('ERROR', category, message, data, err);
  }

  public recordApiCall(endpoint: string, method: string, status: number, durationMs: number, errorMsg?: string) {
    const level: ClientLogLevel = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    this.log(level, 'API_FETCH', `${method} ${endpoint} -> HTTP ${status} (${durationMs}ms)`, {
      endpoint,
      method,
      status,
      durationMs,
      errorMsg
    });
  }
}

export const clientLogger = new ClientLogger();
