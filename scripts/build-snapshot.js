import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const snapshotPath = path.join(root, 'snapshot-data', 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  console.error('Snapshot data is missing. Run npm run snapshot:export first.');
  process.exit(1);
}
const validate = spawnSync('npx', ['tsx', 'scripts/validate-snapshot.ts'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (validate.status !== 0) process.exit(validate.status ?? 1);
fs.copyFileSync(snapshotPath, path.join(root, 'public', 'snapshot.json'));
const build = spawnSync('npx', ['vite', 'build', '--mode', 'snapshot'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(build.status ?? 1);

const output = path.join(root, 'dist-snapshot');
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
  const deployedSnapshotPath = path.join(output, 'snapshot.json');
  if (!fs.existsSync(deployedSnapshotPath)) throw new Error('Built site is missing snapshot.json.');
  const deployedSnapshot = JSON.parse(fs.readFileSync(deployedSnapshotPath, 'utf8'));
  if (deployedSnapshot.schemaVersion !== 1) throw new Error('Built site has an unsupported snapshot schema.');
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
