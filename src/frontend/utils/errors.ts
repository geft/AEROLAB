/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Use in `catch (err)` blocks instead of annotating the binding `: any`, so the
 * thrown value stays typed as `unknown` and is narrowed here in one place.
 */
export function errorMessage(err: unknown, fallback = 'Unexpected error'): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return fallback;
}
