#!/usr/bin/env node
/**
 * Cross-platform launcher for AEROLAB.
 * Concurrently starts backend API (Express + SQLite) and frontend (Vite).
 * Gracefully terminates both child processes on SIGINT (Ctrl+C).
 */

import { spawn } from 'child_process';
import process from 'process';

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

console.log('\x1b[36m%s\x1b[0m', '====================================================');
console.log('\x1b[36m%s\x1b[0m', '🏃 AEROLAB — Starting Local Backend & Frontend');
console.log('\x1b[36m%s\x1b[0m', '====================================================');

const backend = spawn(npmCmd, ['run', 'dev:backend'], {
  stdio: 'pipe',
  shell: true,
  env: process.env
});

const frontend = spawn(npmCmd, ['run', 'dev:frontend'], {
  stdio: 'pipe',
  shell: true,
  env: process.env
});

function pipeOutput(stream, prefix, colorCode) {
  let buffer = '';
  stream.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep partial line in buffer
    for (const line of lines) {
      if (line.trim().length > 0) {
        console.log(`\x1b[${colorCode}m[${prefix}]\x1b[0m ${line}`);
      }
    }
  });
}

pipeOutput(backend.stdout, 'BACKEND', '33'); // Amber
pipeOutput(backend.stderr, 'BACKEND:ERR', '31'); // Red

pipeOutput(frontend.stdout, 'FRONTEND', '36'); // Cyan
pipeOutput(frontend.stderr, 'FRONTEND:ERR', '31'); // Red

function cleanup() {
  console.log('\n\x1b[33m[AEROLAB] Shutting down services...\x1b[0m');
  try {
    if (isWindows) {
      if (backend.pid) spawn('taskkill', ['/pid', backend.pid.toString(), '/f', '/t']);
      if (frontend.pid) spawn('taskkill', ['/pid', frontend.pid.toString(), '/f', '/t']);
    } else {
      backend.kill('SIGTERM');
      frontend.kill('SIGTERM');
    }
  } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
