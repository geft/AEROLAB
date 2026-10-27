import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Encrypts a secret at rest with Windows DPAPI.
 *
 * Node has no DPAPI binding and the desktop build deliberately ships no native
 * addon for it, so the packaged `AEROLAB.Secret.exe` helper does the call. The
 * secret crosses a pipe, never a command line or a temporary file.
 */
export interface SecretProtector {
  /** Returns a base64 blob that only this Windows account can decrypt. */
  protect(plaintext: string): string;
  unprotect(blob: string): string;
}

const HOST_NAME = 'AEROLAB.Secret.exe';
const HOST_TIMEOUT_MS = 10_000;

/** `undefined` means "detect", `null` disables protection for the process. */
let override: SecretProtector | null | undefined;

/** Test seam: replace DPAPI without depending on the helper binary. */
export function setSecretProtectorForTests(protector: SecretProtector | null | undefined): void {
  override = protector;
}

function appRoot(): string {
  return process.env.AEROLAB_APP_ROOT?.trim() || process.cwd();
}

/** Absolute path of the helper, or null when this build cannot encrypt. */
export function secretHostPath(): string | null {
  const explicit = process.env.AEROLAB_SECRET_HOST?.trim();
  if (explicit) return fs.existsSync(explicit) ? path.resolve(explicit) : null;
  if (process.platform !== 'win32') return null;
  const candidate = path.join(appRoot(), HOST_NAME);
  return fs.existsSync(candidate) ? candidate : null;
}

function runHost(host: string, command: 'protect' | 'unprotect', input: string): string {
  const output = execFileSync(host, [command], {
    input,
    encoding: 'utf8',
    timeout: HOST_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    // Capture stderr too: a key that cannot be decrypted is an expected state
    // the caller reports in the UI, not console noise.
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const value = output.trim();
  if (!value) throw new Error(`AEROLAB secret host returned no ${command}ed value.`);
  return value;
}

/**
 * The active protector, or null when DPAPI is unavailable (other platforms,
 * development builds without the helper). Callers then fall back to the
 * plaintext file the app has always used.
 */
export function activeSecretProtector(): SecretProtector | null {
  if (override !== undefined) return override;
  // Tests must not depend on whether a helper binary happens to be built.
  if (process.env.NODE_ENV === 'test') return null;
  const host = secretHostPath();
  if (!host) return null;
  return {
    protect: plaintext => runHost(host, 'protect', plaintext),
    unprotect: blob => runHost(host, 'unprotect', blob)
  };
}
