#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';

const devMode = process.argv.includes('--dev');
const bundle = path.resolve(devMode ? 'src/backend/server.ts' : 'dist-backend/server.cjs');
if (!fs.existsSync(bundle)) throw new Error('Backend entry is missing');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-packaged-smoke-'));
const token = randomBytes(32).toString('hex');
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('No local port'));
    server.close(() => resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, devMode ? ['--import', 'tsx', bundle] : [bundle], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    APPDATA: root,
    DATABASE_PATH: path.join(root, 'runs.db'),
    AEROLAB_SESSION_TOKEN: token,
    NODE_ENV: devMode ? 'development' : 'production',
    PORT: String(port)
  },
  stdio: 'ignore',
  windowsHide: true
});

async function waitUntilReady() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Packaged backend exited early (${child.exitCode})`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Packaged backend did not start');
}

try {
  await waitUntilReady();
  const denied = await fetch(`${base}/api/database/status`);
  if (denied.status !== 401) throw new Error(`Unauthenticated API returned ${denied.status}`);

  const bootstrap = await fetch(`${base}/bootstrap/${token}`, { redirect: 'manual' });
  const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0];
  if (bootstrap.status !== 302 || !cookie) throw new Error('Session bootstrap failed');
  const headers = { Cookie: cookie };
  const status = await fetch(`${base}/api/database/status`, { headers });
  if (!status.ok) throw new Error(`Authenticated database status returned ${status.status}`);
  const info = await status.json();
  if (info.dbPath !== path.join(root, 'runs.db')) throw new Error('Packaged backend opened the wrong database');

  let maintenanceComplete = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/api/system/maintenance`, { headers });
    const maintenance = await response.json();
    if (maintenance.status === 'complete') { maintenanceComplete = true; break; }
    if (maintenance.status === 'failed' || maintenance.status === 'interrupted') {
      throw new Error(`Packaged maintenance failed: ${maintenance.error}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!maintenanceComplete) throw new Error('Packaged maintenance did not complete');

  // Write routes are blocked while startup maintenance owns the database.
  const deployRoute = await fetch(`${base}/api/snapshot-deploy`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'invalid-name.db' })
  });
  if (deployRoute.status !== 400) throw new Error(`Snapshot deployment route returned ${deployRoute.status} in the packaged backend`);

  const profileUpdate = await fetch(`${base}/api/profile`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dob: '1990-01-01', resting_hr: 55, max_hr: 185, gender: 'Male' })
  });
  const profileResult = await profileUpdate.json();
  if (!profileUpdate.ok || !profileResult.syncScheduled) throw new Error('Profile recomputation was not scheduled');
  let profileJobComplete = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/api/system/maintenance`, { headers });
    const maintenance = await response.json();
    if (maintenance.task === 'profile' && maintenance.status === 'complete') { profileJobComplete = true; break; }
    if (maintenance.task === 'profile' && (maintenance.status === 'failed' || maintenance.status === 'interrupted')) {
      throw new Error(`Profile recomputation failed: ${maintenance.error}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!profileJobComplete) throw new Error('Profile recomputation did not complete');

  if (!devMode) {
    const devRoute = await fetch(`${base}/api/dev/diagnostics`, { headers });
    if (devRoute.status !== 404) throw new Error(`Developer route returned ${devRoute.status} in production`);
  }
  const shutdown = await fetch(`${base}/api/system/shutdown`, { method: 'POST', headers });
  if (!shutdown.ok) throw new Error(`Packaged backend shutdown returned ${shutdown.status}`);
  console.log(`${devMode ? 'Development' : 'Packaged'} backend smoke passed.`);
} finally {
  if (child.exitCode === null) child.kill();
  const resolvedRoot = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolvedRoot.startsWith(tempRoot)) throw new Error('Refusing to remove a path outside the temporary directory');
  fs.rmSync(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
