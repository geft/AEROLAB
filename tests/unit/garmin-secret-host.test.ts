import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The packaged build ships `AEROLAB.Secret.exe` and the backend calls it to
 * encrypt the Garmin key with Windows DPAPI. CI runs the suite before the
 * build, so this test only runs where the helper has been compiled.
 */
const host = path.resolve('AEROLAB.Secret.exe');
const available = process.platform === 'win32' && fs.existsSync(host);

function run(command: 'protect' | 'unprotect', input: string): string {
  return execFileSync(host, [command], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}

describe.skipIf(!available)('AEROLAB.Secret.exe', () => {
  it('round-trips a key through DPAPI', () => {
    const apiKey = 'GCDC_01234567-89ab-cdef-0123-456789abcdef.test-only';
    const blob = run('protect', apiKey);

    expect(blob).not.toContain(apiKey);
    expect(run('unprotect', blob)).toBe(apiKey);
  });

  it('refuses a blob that DPAPI did not produce for this account', () => {
    expect(() => run('unprotect', Buffer.from('not-dpapi').toString('base64'))).toThrow();
  });

  it('refuses to run without a command or input', () => {
    expect(() => run('protect', '')).toThrow();
    expect(() => execFileSync(host, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })).toThrow();
  });
});
