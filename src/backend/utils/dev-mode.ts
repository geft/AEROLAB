/**
 * Developer tooling (diagnostics drawer, error sandbox, /api/dev/* routes) is a
 * development-only surface. It must never be reachable from a packaged release.
 *
 * Production builds never expose developer tooling. In development,
 * AEROLAB_DEV_TOOLS=0|false disables it.
 *
 * The packaged desktop launcher (scripts/launch-chrome-app.js) starts the engine
 * with NODE_ENV=production, so released installers always resolve to disabled.
 */
export function isDevToolsEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  const override = (process.env.AEROLAB_DEV_TOOLS || '').trim().toLowerCase();
  if (override === '0' || override === 'false') return false;
  return true;
}
