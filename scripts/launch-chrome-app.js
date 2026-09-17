#!/usr/bin/env node
/**
 * AEROLAB Chrome / Edge App Mode Launcher
 * 
 * Runs AEROLAB in a native standalone app window using the user's
 * installed Chrome or Edge browser with ZERO Chromium bundle overhead (0 MB download).
 * 
 * Features:
 * - Automatically detects Google Chrome, MS Edge, Brave, or Chromium.
 * - Spawns local offline backend and serves static frontend assets.
 * - Launches in isolated App Mode (--app=http://127.0.0.1:PORT) with no URL bar or tabs.
 * - Automatically terminates local backend when the desktop window is closed.
 */

import { spawn, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import process from 'process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('\x1b[36m%s\x1b[0m', '====================================================');
console.log('\x1b[36m%s\x1b[0m', '🏃 AEROLAB — Native App Mode (Chromium-Free)');
console.log('\x1b[36m%s\x1b[0m', '====================================================');

// 1. Detect Installed Browsers
function findBrowserExecutable() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

    const candidates = [
      // Google Chrome
      { name: 'Google Chrome', path: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Google Chrome', path: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { name: 'Google Chrome', path: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      // Microsoft Edge (Standard on 100% of modern Windows)
      { name: 'Microsoft Edge', path: path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'Microsoft Edge', path: path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'Microsoft Edge', path: path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      // Brave Browser
      { name: 'Brave', path: path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') },
      { name: 'Brave', path: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe') }
    ];

    for (const c of candidates) {
      if (fs.existsSync(c.path)) {
        return c;
      }
    }
  } else if (isMac) {
    const macCandidates = [
      { name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { name: 'Brave', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' }
    ];
    for (const c of macCandidates) {
      if (fs.existsSync(c.path)) {
        return c;
      }
    }
  } else {
    // Linux
    const linuxCandidates = [
      { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
      { name: 'Chromium', path: '/usr/bin/chromium-browser' },
      { name: 'Chromium', path: '/usr/bin/chromium' },
      { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' }
    ];
    for (const c of linuxCandidates) {
      if (fs.existsSync(c.path)) {
        return c;
      }
    }
  }

  return null;
}

// 2. Health check helper
function checkHealth(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// 3. Wait for server helper
async function waitForServer(port, maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const healthy = await checkHealth(port, 400);
    if (healthy) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// 4. Main Launch Sequence
async function main() {
  const browser = findBrowserExecutable();
  if (browser) {
    console.log(`\x1b[32m✔ Detected ${browser.name}:\x1b[0m ${browser.path}`);
  } else {
    console.log('\x1b[33m⚠ No Chrome or Edge binary detected. Will launch system default browser.\x1b[0m');
  }

  const port = process.env.PORT || 3001;
  let backendProcess = null;
  let ownsBackend = false;

  // Check if an existing AEROLAB backend is already responding
  const alreadyRunning = await checkHealth(port);
  if (alreadyRunning) {
    console.log(`\x1b[32m✔ Connected to active AEROLAB server on port ${port}.\x1b[0m`);
  } else {
    console.log(`🚀 Starting local AEROLAB engine on port ${port}...`);

    const serverCjsPath = path.join(rootDir, 'dist-backend', 'server.cjs');
    const distHtmlPath = path.join(rootDir, 'dist', 'index.html');

    if (!fs.existsSync(serverCjsPath) || !fs.existsSync(distHtmlPath)) {
      console.log('📦 Production bundle not found. Building project...');
      execSync('node scripts/build-all.js', { cwd: rootDir, stdio: 'inherit' });
    }

    const userDataDir = process.env.APPDATA
      ? path.join(process.env.APPDATA, 'aerolab')
      : path.join(os.homedir(), '.aerolab');
    const dbPath = path.join(userDataDir, 'runs.db');

    backendProcess = spawn(process.execPath, [serverCjsPath], {
      cwd: rootDir,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_PATH: dbPath
      },
      stdio: 'inherit'
    });

    ownsBackend = true;

    const ready = await waitForServer(port);
    if (!ready) {
      console.error('\x1b[31m✖ Failed to connect to local AEROLAB backend.\x1b[0m');
      if (backendProcess) backendProcess.kill();
      process.exit(1);
    }
  }

  const appUrl = `http://127.0.0.1:${port}`;
  console.log(`\x1b[32m✔ AEROLAB engine ready at ${appUrl}\x1b[0m`);

  // Prepare profile directory for isolated app mode
  const profileDir = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'AEROLAB', 'BrowserProfile')
    : path.join(os.homedir(), '.aerolab', 'BrowserProfile');

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  let browserProcess = null;

  if (browser) {
    console.log(`🖥️  Launching AEROLAB Desktop App Mode...`);
    const browserArgs = [
      `--app=${appUrl}`,
      `--user-data-dir=${profileDir}`,
      '--window-size=1440,920',
      '--window-position=center',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--no-first-run',
      '--no-default-browser-check'
    ];

    browserProcess = spawn(browser.path, browserArgs, {
      detached: false,
      stdio: 'ignore'
    });

    browserProcess.on('exit', (code) => {
      console.log(`\n\x1b[33m[AEROLAB] App window closed (code ${code}).\x1b[0m`);
      cleanup();
    });

    browserProcess.on('error', (err) => {
      console.error('Error spawning browser:', err);
      fallbackOpen(appUrl);
    });
  } else {
    fallbackOpen(appUrl);
  }

  function fallbackOpen(url) {
    console.log(`Opening in default browser: ${url}`);
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  }

  function cleanup() {
    console.log('\x1b[33m[AEROLAB] Shutting down services...\x1b[0m');
    if (ownsBackend && backendProcess) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', backendProcess.pid.toString(), '/f', '/t'], { stdio: 'ignore' });
        } else {
          backendProcess.kill('SIGTERM');
        }
      } catch {}
    }
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Launcher error:', err);
  process.exit(1);
});
