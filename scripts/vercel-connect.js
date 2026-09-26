import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getVercelCliInvocation } from './vercel-cli.js';

const [statusPath, mode] = process.argv.slice(2);
const shouldLogin = mode === 'login-and-link';
const isWindows = process.platform === 'win32';

if (!statusPath || !['login-and-link', 'link'].includes(mode)) {
  console.error('Missing Vercel setup status path or mode.');
  process.exit(2);
}

function setStatus(status) {
  fs.writeFileSync(statusPath, status, 'utf8');
}

function runVercel(args) {
  return new Promise((resolve, reject) => {
    const invocation = getVercelCliInvocation(args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      shell: isWindows && /\.(cmd|bat)$/i.test(invocation.command),
      windowsHide: false,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`npx vercel ${args[0]} exited with code ${code}`)));
  });
}

try {
  if (shouldLogin) {
    setStatus('login');
    console.log('\nAEROLAB is starting Vercel sign-in. Complete the browser/device approval, then return here.\n');
    await runVercel(['login']);
  }

  setStatus('linking');
  console.log('\nLinking this checkout to a Vercel project. Choose the team and existing project to deploy to.\n');
  await runVercel(['link']);
  setStatus('linked');
  console.log('\nVercel setup is complete. Return to AEROLAB; the selected snapshot will deploy automatically.\n');
  await new Promise(resolve => setTimeout(resolve, 5_000));
  fs.rmSync(path.dirname(statusPath), { recursive: true, force: true });
} catch (error) {
  let currentStatus = '';
  try { currentStatus = fs.readFileSync(statusPath, 'utf8'); } catch { /* Preserve the original CLI failure. */ }
  setStatus(shouldLogin && !currentStatus.includes('linking') ? 'login-failed' : 'link-failed');
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  if (process.stdin.isTTY) {
    console.log('Press Enter to close this window.');
    await new Promise(resolve => process.stdin.once('data', resolve));
  }
  fs.rmSync(path.dirname(statusPath), { recursive: true, force: true });
  process.exitCode = 1;
}
