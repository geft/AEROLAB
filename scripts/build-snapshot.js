import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { decode } from '@msgpack/msgpack';

const root = process.cwd();
const snapshotFilename = 'snapshot.msgpack.gz';
const snapshotPath = path.join(root, 'snapshot-data', snapshotFilename);
if (!fs.existsSync(snapshotPath)) {
  console.error('Snapshot data is missing. Run npm run snapshot:export first.');
  process.exit(1);
}
const validate = spawnSync('npx', ['tsx', 'scripts/validate-snapshot.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (validate.status !== 0) process.exit(validate.status ?? 1);
const build = spawnSync('npx', ['vite', 'build', '--mode', 'snapshot'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(build.status ?? 1);

const output = path.join(root, 'dist-snapshot');
fs.copyFileSync(snapshotPath, path.join(output, snapshotFilename));
const forbidden = /\.(db|sqlite|sqlite3|map)$/i;
function audit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) audit(full);
    else if (forbidden.test(entry.name)) throw new Error(`Forbidden deployment artifact: ${full}`);
  }
}
try {
  audit(output);
  const deployedSnapshotPath = path.join(output, snapshotFilename);
  if (!fs.existsSync(deployedSnapshotPath)) throw new Error(`Built site is missing ${snapshotFilename}.`);
  const deployedSnapshot = decode(gunzipSync(fs.readFileSync(deployedSnapshotPath)));
  if (deployedSnapshot.schemaVersion !== 2) throw new Error('Built site has an unsupported snapshot schema.');
  const manifestPath = path.join(output, 'manifest.webmanifest');
  if (!fs.existsSync(manifestPath)) throw new Error('Built site is missing its web app manifest.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.name || !manifest.start_url || !['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'].includes(manifest.display)) {
    throw new Error('Built site has incomplete web app install metadata.');
  }
  for (const size of [192, 512]) {
    const icon = manifest.icons?.find(entry => entry.sizes === `${size}x${size}`);
    if (!icon) throw new Error(`Built site manifest is missing its ${size}x${size} install icon.`);
    const iconPath = path.join(output, icon.src.replace(/^\//, ''));
    if (!fs.existsSync(iconPath)) throw new Error(`Built site is missing its ${size}x${size} install icon.`);
    const image = fs.readFileSync(iconPath);
    if (image.readUInt32BE(16) !== size || image.readUInt32BE(20) !== size) {
      throw new Error(`Built site ${size}x${size} install icon has incorrect dimensions.`);
    }
  }
  const indexHtml = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  if (!indexHtml.includes('service-worker.js')) throw new Error('Built site does not register its service worker.');
  if (!fs.existsSync(path.join(output, 'service-worker.js'))) throw new Error('Built site is missing its service worker.');
  const jsFiles = [];
  function collectJs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectJs(full);
      else if (entry.name.endsWith('.js')) jsFiles.push(full);
    }
  }
  collectJs(output);
  const bundle = jsFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  if (/\/api\/(?:ingest|database|dev)\//.test(bundle) || /\/api\/activities\/[^`"']+\/(?:weather\/refresh)/.test(bundle)) {
    throw new Error('Snapshot bundle contains a write-capable API endpoint.');
  }
  console.log(`Snapshot deployment artifact is ready: ${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
