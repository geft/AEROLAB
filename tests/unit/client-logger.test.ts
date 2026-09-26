// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientLogger } from '../../src/frontend/utils/clientLogger.js';

beforeEach(() => clientLogger.clear());
afterEach(() => vi.restoreAllMocks());

describe('client logger', () => {
  it('notifies subscribers, isolates listener failures, reverses the buffer, and clears it', () => {
    const listener = vi.fn();
    const unsubscribe = clientLogger.subscribe(listener);
    const brokenListener = vi.fn(() => { throw new Error('listener failure'); });
    const removeBroken = clientLogger.subscribe(brokenListener);
    const first = clientLogger.info('TEST', 'first');
    clientLogger.warn('TEST', 'second');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(clientLogger.getLogs().map(entry => entry.message)).toEqual(['second', 'first']);
    expect(first.data).toBeUndefined();

    unsubscribe();
    removeBroken();
    clientLogger.clear();
    expect(clientLogger.getLogs()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps error details only for truthy thrown values and records API levels by status', () => {
    const error = Object.assign(new Error('disk failed'), { code: 'EIO' });
    const errorEntry = clientLogger.error('DB', 'save failed', error, { retry: true });
    expect(errorEntry.error).toMatchObject({ message: 'disk failed', code: 'EIO', stack: expect.any(String) });
    expect(errorEntry.data).toEqual({ retry: true });
    expect(clientLogger.error('DB', 'empty failure', 0).error).toBeUndefined();

    clientLogger.recordApiCall('/ok', 'GET', 200, 4);
    clientLogger.recordApiCall('/missing', 'GET', 404, 5, 'missing');
    clientLogger.recordApiCall('/crash', 'POST', 500, 6, 'crash');
    expect(clientLogger.getLogs().slice(0, 3).map(entry => entry.level)).toEqual(['ERROR', 'WARN', 'INFO']);
    expect(clientLogger.getLogs()[0].data).toMatchObject({ endpoint: '/crash', errorMsg: 'crash' });
  });

  it('bounds the buffer at 150 entries', () => {
    for (let index = 0; index < 151; index++) clientLogger.debug('TEST', `item ${index}`);
    expect(clientLogger.getLogs()).toHaveLength(150);
    expect(clientLogger.getLogs()[0].message).toBe('item 150');
    expect(clientLogger.getLogs()[149].message).toBe('item 1');
  });

  it('captures uncaught errors and unhandled promise rejections from the window', () => {
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'uncaught', filename: 'app.js', lineno: 2, colno: 4, error: new Error('uncaught')
    }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: new Error('rejected') });
    window.dispatchEvent(rejection);
    const logs = clientLogger.getLogs();
    expect(logs.map(entry => entry.category)).toEqual(['UNHANDLED_REJECTION', 'UNCAUGHT_EXCEPTION']);
    expect(logs[0].message).toBe('rejected');
    expect(logs[1].data).toMatchObject({ filename: 'app.js', lineno: 2, colno: 4 });
  });
});
