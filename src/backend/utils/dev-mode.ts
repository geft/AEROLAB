/**
 * Developer tooling (diagnostics drawer, error sandbox, /api/dev/* routes) is a
 * development-only surface. It must never be reachable from a packaged release.
 *
 * Resolution order:
 *   1. AEROLAB_DEV_TOOLS=1|true   -> force enabled (explicit opt-in)
 *   2. AEROLAB_DEV_TOOLS=0|false  -> force disabled (hard kill switch)
 *   3. Otherwise default to enabled unless this is a production build.
 *
 * The packaged desktop launcher (scripts/launch-chrome-app.js) starts the engine
 * with NODE_ENV=production, so released installers always resolve to disabled.
 */
export function isDevToolsEnabled(): boolean {
  const override = (process.env.AEROLAB_DEV_TOOLS || '').trim().toLowerCase();
  if (override === '1' || override === 'true') return true;
  if (override === '0' || override === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}
