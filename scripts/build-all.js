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

console.log('📋 Copying Database Schema...');
fs.copyFileSync('src/backend/db/schema.sql', 'dist-backend/schema.sql');

console.log('✅ AEROLAB Build Complete (Frontend & Backend)!');
