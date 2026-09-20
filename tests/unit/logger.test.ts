import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logger, requestLogger, globalErrorHandler } from '../../src/backend/utils/logger.js';

describe('Structured Logger Unit Tests', () => {
  beforeEach(() => {
    logger.clear();
    logger.setMinLevel('DEBUG');
  });

  it('records logs with timestamp, level, category, and message', () => {
    const entry = logger.info('INGEST', 'Ingestion completed successfully', { activityId: 'act-001' });
    expect(entry).toBeDefined();
    expect(entry.level).toBe('INFO');
    expect(entry.category).toBe('INGEST');
    expect(entry.message).toBe('Ingestion completed successfully');
    expect(entry.context?.activityId).toBe('act-001');
    expect(entry.timestamp).toBeTruthy();
  });

  it('captures errors with message, code, and stack trace in error logs', () => {
    const customErr = new Error('Database locked');
    (customErr as any).code = 'SQLITE_BUSY';

    const entry = logger.error('DB', 'Failed to execute query', customErr, { query: 'SELECT 1' });
    expect(entry.level).toBe('ERROR');
    expect(entry.error).toBeDefined();
    expect(entry.error?.message).toBe('Database locked');
    expect(entry.error?.code).toBe('SQLITE_BUSY');
    expect(entry.error?.stack).toBeDefined();
  });

  it('buffers recent logs and respects ring buffer limit', () => {
    for (let i = 1; i <= 250; i++) {
      logger.info('LOOP', `Log message ${i}`);
    }

    const recent = logger.getRecentLogs(50);
    expect(recent).toHaveLength(50);
    // Most recent is first
    expect(recent[0].message).toBe('Log message 250');
    expect(recent[49].message).toBe('Log message 201');
  });

  it('clears buffered logs when clear() is called', () => {
    logger.info('TEST', 'Sample entry');
    expect(logger.getRecentLogs(10)).toHaveLength(1);

    logger.clear();
    expect(logger.getRecentLogs(10)).toHaveLength(0);
  });

  it('filters log console output according to minLevel setting', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.setMinLevel('WARN');

    logger.debug('TEST', 'This is a debug trace');
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('requestLogger middleware measures duration and logs on response finish', () => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    const req: any = { originalUrl: '/api/activities', method: 'GET', ip: '127.0.0.1', headers: {} };
    const res: any = {
      statusCode: 200,
      on: (event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = cb;
      }
    };
    const next = vi.fn();

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Simulate response finish
    if (listeners['finish']) {
      listeners['finish']();
    }

    const recent = logger.getRecentLogs(1);
    expect(recent).toHaveLength(1);
    expect(recent[0].category).toBe('HTTP');
    expect(recent[0].message).toContain('GET /api/activities -> 200');
  });

  it('globalErrorHandler formats structured error JSON response', () => {
    const err: any = new Error('Activity payload malformed');
    err.status = 400;
    err.code = 'ERR_INVALID_PAYLOAD';
    err.details = { field: 'distance_meters' };

    const req: any = { method: 'POST', originalUrl: '/api/ingest/upload' };
    const res: any = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    const next = vi.fn();

    globalErrorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Activity payload malformed',
        code: 'ERR_INVALID_PAYLOAD',
        details: { field: 'distance_meters' },
        timestamp: expect.any(String)
      })
    );
  });
});
