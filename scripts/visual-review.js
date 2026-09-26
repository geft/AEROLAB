import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const playwrightCli = path.join(path.dirname(require.resolve('playwright')), 'cli.js');

function runPlaywright(args) {
  const result = spawnSync(process.execPath, [playwrightCli, ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  // Closing the report with Ctrl+C is expected; preserve the test result.
  if (result.signal === 'SIGINT') return 0;
  return result.status ?? 1;
}

const installStatus = runPlaywright(['install', 'chromium']);
if (installStatus !== 0) process.exit(installStatus);

const testStatus = runPlaywright(['test']);
const reportStatus = runPlaywright(['show-report']);
process.exit(testStatus || reportStatus);
