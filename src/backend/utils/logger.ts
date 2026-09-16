import { Request, Response, NextFunction } from 'express';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  context?: Record<string, any>;
  durationMs?: number;
  statusCode?: number;
  error?: {
    name?: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40
};

class StructuredLogger {
  private buffer: LogEntry[] = [];
  private maxBufferSize: number = 200;
  private minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'INFO';

  constructor(maxBufferSize: number = 200) {
    this.maxBufferSize = maxBufferSize;
  }

  public setMinLevel(level: LogLevel) {
    this.minLevel = level;
  }

  public getRecentLogs(limit: number = 100): LogEntry[] {
    return this.buffer.slice(-limit).reverse();
  }

  public clear(): void {
    this.buffer = [];
  }

  private pushEntry(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer.shift();
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[this.minLevel];
  }

  public log(
    level: LogLevel,
    category: string,
    message: string,
    context?: Record<string, any>,
    err?: any
  ): LogEntry {
    const timestamp = new Date().toISOString();
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const errorObj = err ? {
      name: err.name,
      message: err.message || String(err),
      stack: err.stack,
      code: err.code || err.statusCode
    } : undefined;

    const entry: LogEntry = {
      id,
      timestamp,
      level,
      category,
      message,
      context,
      error: errorObj
    };

    this.pushEntry(entry);

    if (this.shouldLog(level) && process.env.NODE_ENV !== 'test') {
      const prefix = `[${timestamp}] [${level}] [${category}]`;
      if (level === 'ERROR') {
        console.error(`${prefix} ${message}`, context || '', err || '');
      } else if (level === 'WARN') {
        console.warn(`${prefix} ${message}`, context || '');
      } else if (level === 'DEBUG') {
        console.debug(`${prefix} ${message}`, context || '');
      } else {
        console.log(`${prefix} ${message}`, context || '');
      }
    }

    return entry;
  }

  public debug(category: string, message: string, context?: Record<string, any>): LogEntry {
    return this.log('DEBUG', category, message, context);
  }

  public info(category: string, message: string, context?: Record<string, any>): LogEntry {
    return this.log('INFO', category, message, context);
  }

  public warn(category: string, message: string, context?: Record<string, any>): LogEntry {
    return this.log('WARN', category, message, context);
  }

  public error(category: string, message: string, err?: any, context?: Record<string, any>): LogEntry {
    return this.log('ERROR', category, message, context, err);
  }
}

export const logger = new StructuredLogger();

/**
 * Express middleware to automatically log all incoming HTTP requests and responses
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const path = req.originalUrl || req.url;
  const method = req.method;

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;
    const level: LogLevel = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';

    logger.log(
      level,
      'HTTP',
      `${method} ${path} -> ${statusCode} (${durationMs}ms)`,
      {
        method,
        path,
        statusCode,
        durationMs,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
    );
  });

  next();
}

/**
 * Global structured error handler for Express
 */
export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const statusCode = err.status || err.statusCode || 500;
  const errorCode = err.code || (statusCode === 404 ? 'ERR_NOT_FOUND' : 'ERR_INTERNAL_SERVER_ERROR');

  logger.error('SERVER_ERROR', `Unhandled error on ${req.method} ${req.originalUrl}: ${err.message}`, err, {
    url: req.originalUrl,
    method: req.method,
    statusCode,
    code: errorCode
  });

  if (res.headersSent) {
    return next(err);
  }

  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    code: errorCode,
    details: err.details || null,
    timestamp: new Date().toISOString(),
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
  });
}
