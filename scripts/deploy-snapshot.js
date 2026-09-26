import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLinkedVercelProjectId, getVercelCliInvocation, getVercelDeployArgs } from './vercel-cli.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const deploymentRoot = process.env.AEROLAB_DEPLOYMENT_HOME || appRoot;
const selectedDatabasePath = process.env.AEROLAB_SNAPSHOT_DATABASE_PATH;
const projectLinkPath = path.join(deploymentRoot, '.vercel', 'project.json');
const viewerTemplatePath = path.join(appRoot, 'dist-snapshot-template');
const exporterBundlePath = path.join(appRoot, 'dist-backend', 'export-snapshot.cjs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!selectedDatabasePath || !fs.existsSync(selectedDatabasePath)) {
  console.error('Choose an existing local snapshot row before deploying.');
  process.exit(2);
}

let vercelProjectId;
try {
  vercelProjectId = getLinkedVercelProjectId(projectLinkPath);
} catch {
  console.error('The local Vercel project link is invalid. Start deployment from the app again to choose a project.');
  process.exit(2);
}

function run(command, args, label, { cwd = appRoot, env = process.env, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
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

async function runVercel(args, label, options = {}) {
  const invocation = getVercelCliInvocation(args);
  return run(invocation.command, invocation.args, label, options);
}

const tempDeploymentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-vercel-deploy-'));
try {
  console.log('Checking Vercel CLI login…');
  try {
    await runVercel(['whoami'], 'Vercel login', { cwd: deploymentRoot, quiet: true });
  } catch {
    throw new Error('Vercel CLI sign-in expired. Start deployment from the app again to sign in and reconnect.');
  }

  console.log('SNAPSHOT_PHASE=exporting');
  console.log('Exporting the selected local snapshot…');
  if (fs.existsSync(exporterBundlePath)) {
    await run(process.execPath, [exporterBundlePath, '--database', selectedDatabasePath, '--output', path.join(tempDeploymentDir, 'snapshot.json')], 'Snapshot export', {
      env: { ...process.env, AEROLAB_EXPORT_SNAPSHOT_CLI: '1' }
    });
  } else {
    await run(npm, ['run', 'snapshot:export', '--', '--database', selectedDatabasePath, '--output', path.join(tempDeploymentDir, 'snapshot.json')], 'Snapshot export');
  }

  console.log('SNAPSHOT_PHASE=validating');
  console.log('Validating snapshot…');
  if (!fs.existsSync(path.join(tempDeploymentDir, 'snapshot.json'))) throw new Error('Snapshot export did not create snapshot.json.');

  console.log('SNAPSHOT_PHASE=building');
  console.log('Preparing the static viewer…');
  if (!fs.existsSync(path.join(viewerTemplatePath, 'index.html'))) {
    if (process.env.NODE_ENV === 'production') throw new Error('The packaged snapshot viewer is missing. Update AEROLAB to a release that includes snapshot deployment.');
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    await run(npx, ['vite', 'build', '--mode', 'snapshot-template'], 'Snapshot viewer build');
  }
  fs.cpSync(viewerTemplatePath, tempDeploymentDir, { recursive: true, force: true });
  if (!fs.existsSync(path.join(tempDeploymentDir, 'snapshot.json'))) throw new Error('Prepared viewer is missing the selected snapshot.');

  console.log('SNAPSHOT_PHASE=deploying');
  console.log('Deploying the selected snapshot to the linked Vercel project…');
  const deployment = await runVercel(
    getVercelDeployArgs(tempDeploymentDir, vercelProjectId),
    'Vercel deployment',
    { cwd: deploymentRoot }
  );
  const deploymentUrls = [...`${deployment.stdout}\n${deployment.stderr}`.matchAll(/https?:\/\/[^\s"'<>]+\.vercel\.app/gi)];
  const deploymentUrl = deploymentUrls.at(-1)?.[0];
  if (!deploymentUrl) throw new Error('Vercel deployment succeeded but did not return a deployment URL. Check the Vercel CLI output.');
  console.log(`SNAPSHOT_DEPLOYMENT_URL=${deploymentUrl}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  fs.rmSync(tempDeploymentDir, { recursive: true, force: true });
}
