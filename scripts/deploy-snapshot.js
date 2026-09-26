import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const projectLinkPath = path.join(projectRoot, '.vercel', 'project.json');
const selectedDatabasePath = process.env.AEROLAB_SNAPSHOT_DATABASE_PATH;
const isWindows = process.platform === 'win32';

if (!selectedDatabasePath || !fs.existsSync(selectedDatabasePath)) {
  console.error('Choose an existing local snapshot row before deploying.');
  process.exit(2);
}

if (!fs.existsSync(projectLinkPath)) {
  console.error('Link this checkout to aerolab-snapshot first with: npx vercel link --project aerolab-snapshot');
  process.exit(2);
}

try {
  const link = JSON.parse(fs.readFileSync(projectLinkPath, 'utf8'));
  if (typeof link.projectId !== 'string' || typeof link.orgId !== 'string') throw new Error('missing project identifiers');
  if (link.projectName !== 'aerolab-snapshot') {
    throw new Error(`This checkout is linked to "${String(link.projectName || 'an unknown project')}", not aerolab-snapshot.`);
  }
} catch {
  console.error('The local Vercel link is invalid or points to another project. Run `npx vercel link --project aerolab-snapshot` and retry.');
  process.exit(2);
}

function run(command, args, label, { quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      windowsHide: true,
      shell: isWindows,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const collect = (target, chunk) => {
      const value = chunk.toString('utf8');
      if (target === 'stdout') stdout = `${stdout}${value}`.slice(-16_000);
      else stderr = `${stderr}${value}`.slice(-16_000);
      if (!quiet) (target === 'stdout' ? process.stdout : process.stderr).write(value);
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', error => reject(new Error(`${label} could not start: ${error.message}`)));
    child.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      const detail = `${stderr}\n${stdout}`.replace(/\u001b\[[0-9;]*m/g, '').trim().slice(-2_000);
      reject(new Error(`${label} failed${detail ? `:\n${detail}` : ` with exit code ${code}`}`));
    });
  });
}

const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';

try {
  console.log('Checking Vercel CLI login…');
  try {
    await run(npx, ['--yes', 'vercel', 'whoami'], 'Vercel login', { quiet: true });
  } catch {
    throw new Error('Vercel CLI is not logged in. Run `npx vercel login`, link this checkout to aerolab-snapshot, then retry.');
  }

  console.log('Exporting the selected local snapshot…');
  await run(npm, ['run', 'snapshot:export'], 'Snapshot export');
  console.log('Validating snapshot…');
  await run(npm, ['run', 'snapshot:validate'], 'Snapshot validation');
  console.log('Building static viewer…');
  await run(npm, ['run', 'build:snapshot'], 'Snapshot build');
  console.log('Deploying dist-snapshot to Vercel production…');
  const deployment = await run(npx, ['--yes', 'vercel', 'deploy', 'dist-snapshot', '--prod', '--yes'], 'Vercel deployment');
  const deploymentUrl = `${deployment.stdout}\n${deployment.stderr}`.match(/https?:\/\/[^\s"'<>]+\.vercel\.app/i)?.[0];
  if (!deploymentUrl) throw new Error('Vercel deployment succeeded but did not return a deployment URL. Check the Vercel CLI output.');
  console.log(`SNAPSHOT_DEPLOYMENT_URL=${deploymentUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
