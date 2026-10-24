#!/usr/bin/env node
import { execSync } from 'child_process';
import fs from 'fs';

console.log('🏷️ Generating Build Info & Version Metadata...');
execSync('node scripts/generate-build-info.js', { stdio: 'inherit' });

console.log('📦 Building AEROLAB Frontend (Vite)...');
execSync('npm run build', { stdio: 'inherit' });

console.log('⚙️ Bundling AEROLAB Backend (esbuild)...');
if (!fs.existsSync('dist-backend')) {
  fs.mkdirSync('dist-backend', { recursive: true });
}
execSync('npx esbuild src/backend/server.ts --bundle --platform=node --format=cjs --external:better-sqlite3 --define:import.meta.url="undefined" --log-override:empty-import-meta=silent --outfile=dist-backend/server.cjs', { stdio: 'inherit' });
execSync('npx esbuild src/backend/jobs/maintenance-worker.ts --bundle --platform=node --format=cjs --external:better-sqlite3 --outfile=dist-backend/maintenance-worker.cjs', { stdio: 'inherit' });
execSync('npx esbuild scripts/export-snapshot.ts --bundle --platform=node --format=cjs --external:better-sqlite3 --define:import.meta.url="undefined" --log-override:empty-import-meta=silent --outfile=dist-backend/export-snapshot.cjs', { stdio: 'inherit' });

console.log('📋 Copying Database Schema...');
fs.copyFileSync('src/backend/db/schema.sql', 'dist-backend/schema.sql');

console.log('🖼️ Building static snapshot viewer template...');
execSync('npx vite build --mode snapshot-template', { stdio: 'inherit' });

if (process.platform === 'win32') {
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if (fs.existsSync(cscPath) && fs.existsSync('launcher.cs')) {
    console.log('🔨 Compiling AEROLAB.exe Native Windows GUI Launcher (Zero Terminal + Icon)...');
    const icoArg = fs.existsSync('aerolab.ico') ? ' /win32icon:aerolab.ico' : '';
    execSync(`"${cscPath}" /nologo /target:winexe${icoArg} /out:AEROLAB.exe /r:System.Windows.Forms.dll launcher.cs`, { stdio: 'inherit' });
  }
}

console.log('✅ AEROLAB Build Complete (Frontend, Backend & Native Launcher)!');
