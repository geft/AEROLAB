#!/usr/bin/env node
/**
 * Package Chromium-Free AEROLAB Distribution for Windows.
 * 
 * Generates an ultra-lightweight release zip containing:
 * - AEROLAB.exe (Native Windows GUI launcher, zero terminal)
 * - AEROLAB.vbs (Silent launcher)
 * - Create-Desktop-Shortcut.vbs (1-click desktop shortcut installer)
 * - Built frontend & backend assets
 * - Essential production node modules
 * 
 * Resulting zip has 0 MB of bundled Chromium!
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('🚀 Packaging Chromium-Free AEROLAB Distribution...');

// 1. Ensure fresh build
execSync('node scripts/build-all.js', { cwd: rootDir, stdio: 'inherit' });

const targetDir = path.join(rootDir, 'release', 'AEROLAB-ChromiumFree');
const zipFile = path.join(rootDir, 'release', 'AEROLAB-ChromiumFree-Windows.zip');

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    const parent = path.dirname(dest);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// 2. Copy Launchers & Manifest
const rootFiles = [
  'AEROLAB.exe',
  'AEROLAB.vbs',
  'AEROLAB.bat',
  'Create-Desktop-Shortcut.vbs',
  'package.json'
];

for (const file of rootFiles) {
  const src = path.join(rootDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(targetDir, file));
  }
}

// 3. Copy dist, dist-backend, scripts
copyRecursive(path.join(rootDir, 'dist'), path.join(targetDir, 'dist'));
copyRecursive(path.join(rootDir, 'dist-backend'), path.join(targetDir, 'dist-backend'));

const scriptsDest = path.join(targetDir, 'scripts');
fs.mkdirSync(scriptsDest, { recursive: true });
fs.copyFileSync(
  path.join(rootDir, 'scripts', 'launch-chrome-app.js'),
  path.join(scriptsDest, 'launch-chrome-app.js')
);

// 4. Copy essential production node_modules
const prodModules = ['better-sqlite3', 'express', 'cors', 'dotenv'];
const nodeModulesDest = path.join(targetDir, 'node_modules');

for (const mod of prodModules) {
  const srcMod = path.join(rootDir, 'node_modules', mod);
  if (fs.existsSync(srcMod)) {
    console.log(`📦 Copying module: ${mod}...`);
    copyRecursive(srcMod, path.join(nodeModulesDest, mod));
  }
}

// Also copy dependencies of dependencies needed for better-sqlite3 and express
const extraDependencies = [
  'bindings', 'file-uri-to-path', 'prebuild-install',
  'accepts', 'array-flatten', 'body-parser', 'content-disposition',
  'content-type', 'cookie', 'cookie-signature', 'debug', 'depd',
  'encodeurl', 'escape-html', 'etag', 'finalhandler', 'fresh',
  'http-errors', 'merge-descriptors', 'methods', 'on-finished',
  'parseurl', 'path-to-regexp', 'proxy-addr', 'qs', 'range-parser',
  'safe-buffer', 'send', 'serve-static', 'setprototypeof', 'statuses',
  'type-is', 'utils-merge', 'vary', 'ms', 'mime-types', 'mime-db',
  'raw-body', 'unpipe', 'iconv-lite', 'bytes', 'inherits', 'toidentifier',
  'media-typer', 'destroy', 'ee-first', 'forwarded', 'ipaddr.js', 'safer-buffer'
];

for (const extra of extraDependencies) {
  const srcExtra = path.join(rootDir, 'node_modules', extra);
  if (fs.existsSync(srcExtra)) {
    copyRecursive(srcExtra, path.join(nodeModulesDest, extra));
  }
}

// 5. Create README.txt for end users
const readmeContent = `===========================================================
  AEROLAB — Physiological Running Analytics
  Chromium-Free Windows Edition (Zero Terminal Mode)
===========================================================

HOW TO RUN:
1. Double-click "AEROLAB.exe" to launch immediately.
   (No command prompt or terminal window will appear!)

OPTIONAL:
- Double-click "Create-Desktop-Shortcut.vbs" to place an AEROLAB
  shortcut directly onto your Windows Desktop.

REQUIREMENTS:
- Google Chrome or Microsoft Edge (pre-installed on Windows).
- Node.js (https://nodejs.org).

ZERO CHROMIUM FOOTPRINT:
This version leverages your existing browser in standalone
app mode, saving ~90 MB of bundled browser downloads!
`;
fs.writeFileSync(path.join(targetDir, 'README.txt'), readmeContent, 'utf8');

// 6. Compress Archive
if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

console.log('🗜️  Compressing to AEROLAB-ChromiumFree-Windows.zip...');
if (process.platform === 'win32') {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${targetDir}\\*' -DestinationPath '${zipFile}' -CompressionLevel Optimal"`, { stdio: 'inherit' });
} else {
  execSync(`cd "${rootDir}/release" && zip -r "${zipFile}" AEROLAB-ChromiumFree`, { stdio: 'inherit' });
}

if (fs.existsSync(zipFile)) {
  const stat = fs.statSync(zipFile);
  const sizeMb = (stat.size / 1024 / 1024).toFixed(2);
  console.log(`\x1b[32m✔ Package complete: ${zipFile} (${sizeMb} MB)\x1b[0m`);
}
