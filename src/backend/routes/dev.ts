import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { getDatabase } from '../db/client.js';
import { getBackupSettings, listBackups } from './database.js';
import { logger } from '../utils/logger.js';

export const devRouter = Router();
export const snapshotDeploymentRouter = Router();

type SnapshotDeploymentPhase = 'checking' | 'login' | 'linking' | 'exporting' | 'validating' | 'building' | 'deploying' | 'complete' | 'failed';

interface SnapshotDeploymentJob {
  id: string;
  phase: SnapshotDeploymentPhase;
  deploymentUrl: string | null;
  error: string | null;
}

let snapshotDeploymentJob: SnapshotDeploymentJob | null = null;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isVercelProjectLinked(linkPath: string): boolean {
  try {
    const link = JSON.parse(fs.readFileSync(linkPath, 'utf8')) as { projectId?: unknown; orgId?: unknown };
    return typeof link.projectId === 'string' && link.projectId.length > 0
      && typeof link.orgId === 'string' && link.orgId.length > 0;
  } catch {
    return false;
  }
}

function runVercelCli(args: string[], cwd: string, timeoutMs = 20_000): Promise<{ code: number | null; output: string }> {
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const useBundledNpm = fs.existsSync(npmCli);
  const command = useBundledNpm ? process.execPath : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const commandArgs = useBundledNpm
    ? [npmCli, 'exec', '--yes', '--package=vercel', '--', 'vercel', ...args]
    : ['--yes', 'vercel', ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const collect = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-4_000); };
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function vercelTerminalEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'ComSpec', 'USERPROFILE', 'APPDATA',
    'LOCALAPPDATA', 'TEMP', 'TMP', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USERDOMAIN',
    'PROCESSOR_ARCHITECTURE', 'PSModulePath', 'NPM_CONFIG_PREFIX', 'VERCEL_TELEMETRY_DISABLED'
  ];
  return Object.fromEntries(allowed.flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
}

async function launchVercelSetupTerminal(appRoot: string, deploymentRoot: string, statusPath: string, needsLogin: boolean): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Automatic Vercel sign-in currently opens a Windows terminal. Run Vercel setup in the deployment terminal, then retry.');
  }
  const scriptPath = path.join(appRoot, 'scripts', 'vercel-connect.js');
  const mode = needsLogin ? 'login-and-link' : 'link';
  const argumentLine = `"${scriptPath}" "${statusPath}" ${mode}`;
  const powershell = `Start-Process -FilePath ${quotePowerShell(process.execPath)} -ArgumentList ${quotePowerShell(argumentLine)} -WorkingDirectory ${quotePowerShell(deploymentRoot)}`;
  const encoded = Buffer.from(powershell, 'utf16le').toString('base64');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: 'ignore',
      env: vercelTerminalEnvironment()
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Could not open the Vercel setup terminal.')));
  });
}

async function waitForVercelSetup(job: SnapshotDeploymentJob, statusPath: string, linkPath: string): Promise<void> {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    let marker = '';
    try { marker = fs.readFileSync(statusPath, 'utf8').trim(); } catch { /* The terminal has not written its first status yet. */ }
    if (marker === 'login') job.phase = 'login';
    else if (marker === 'linking') job.phase = 'linking';
    else if (marker === 'login-failed') throw new Error('Vercel sign-in did not finish successfully. Check the Vercel terminal window, then retry.');
    else if (marker === 'link-failed') throw new Error('The project could not be linked. Check the Vercel terminal window and choose the intended Vercel project.');
    else if (marker === 'linked') {
      if (!isVercelProjectLinked(linkPath)) throw new Error('Vercel finished linking, but no valid project link was saved.');
      return;
    }
    await sleep(900);
  }
  throw new Error('Vercel setup timed out. Finish or close the Vercel terminal window, then retry.');
}

async function startSnapshotDeployment(job: SnapshotDeploymentJob, databasePath: string, appRoot: string, deploymentRoot: string): Promise<void> {
  try {
    fs.mkdirSync(deploymentRoot, { recursive: true });
    job.phase = 'checking';
    const whoami = await runVercelCli(['whoami'], deploymentRoot, 120_000);
    const linkPath = path.join(deploymentRoot, '.vercel', 'project.json');
    const needsLogin = whoami.code !== 0;
    if (needsLogin || !isVercelProjectLinked(linkPath)) {
      job.phase = needsLogin ? 'login' : 'linking';
      const setupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-vercel-setup-'));
      const statusPath = path.join(setupDir, 'status.txt');
      let terminalLaunched = false;
      try {
        await launchVercelSetupTerminal(appRoot, deploymentRoot, statusPath, needsLogin);
        terminalLaunched = true;
        await waitForVercelSetup(job, statusPath, linkPath);
      } finally {
        let marker = '';
        try { marker = fs.readFileSync(statusPath, 'utf8').trim(); } catch { /* Setup may not have started. */ }
        if (!terminalLaunched || ['linked', 'login-failed', 'link-failed'].includes(marker)) {
          fs.rmSync(setupDir, { recursive: true, force: true });
        }
      }
    }

    const child = spawn(process.execPath, [path.join(appRoot, 'scripts', 'deploy-snapshot.js')], {
      cwd: deploymentRoot,
      env: { ...process.env, AEROLAB_APP_ROOT: appRoot, AEROLAB_DEPLOYMENT_HOME: deploymentRoot, AEROLAB_SNAPSHOT_DATABASE_PATH: databasePath },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const appendOutput = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      output = `${output}${text}`.slice(-16_000);
      const phase = output.match(/SNAPSHOT_PHASE=(exporting|validating|building|deploying)/g)?.at(-1)?.split('=')[1] as SnapshotDeploymentPhase | undefined;
      if (phase) job.phase = phase;
    };
    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);
    child.on('error', error => {
      job.phase = 'failed';
      job.error = error.message;
      logger.error('SNAPSHOT_DEPLOY', `Unable to start snapshot deployment: ${error.message}`);
    });
    await new Promise<void>(resolve => child.on('close', code => {
      const deploymentUrl = [...output.matchAll(/https?:\/\/[^\s"'<>]+\.vercel\.app/gi)].at(-1)?.[0] ?? null;
      if (code !== 0 || !deploymentUrl) {
        const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
        const details = output.replace(ansiEscape, '').trim().slice(-2_000);
        job.phase = 'failed';
        job.error = details || 'Snapshot deployment failed without additional output.';
        logger.error('SNAPSHOT_DEPLOY', job.error);
      } else {
        job.phase = 'complete';
        job.deploymentUrl = deploymentUrl;
        logger.info('SNAPSHOT_DEPLOY', `Snapshot deployed to ${deploymentUrl}`);
      }
      resolve();
    }));
  } catch (error) {
    job.phase = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    logger.error('SNAPSHOT_DEPLOY', job.error);
  }
}

snapshotDeploymentRouter.post('/', async (req: Request, res: Response) => {
  if (snapshotDeploymentJob && !['complete', 'failed'].includes(snapshotDeploymentJob.phase)) {
    return res.status(409).json({ error: 'A snapshot deployment is already running.', code: 'ERR_SNAPSHOT_DEPLOY_IN_PROGRESS' });
  }

  const appRoot = process.env.AEROLAB_APP_ROOT || process.cwd();
  const deploymentRoot = process.env.AEROLAB_DEPLOYMENT_HOME || process.cwd();
  const filename = req.body?.filename;
  if (typeof filename !== 'string' || path.basename(filename) !== filename
    || !/^runs-[a-zA-Z0-9._-]+\.db$/.test(filename)) {
    return res.status(400).json({ error: 'Choose a valid local snapshot row.', code: 'ERR_INVALID_SNAPSHOT' });
  }
  let selectedSnapshot: ReturnType<typeof listBackups>[number] | undefined;
  try {
    const backupDirectory = getBackupSettings(getDatabase()).backupDirectory;
    selectedSnapshot = listBackups(backupDirectory).find(snapshot => snapshot.filename === filename);
  } catch {
    return res.status(500).json({ error: 'Could not read the local snapshot directory.', code: 'ERR_SNAPSHOT_DIRECTORY' });
  }
  if (!selectedSnapshot) {
    return res.status(404).json({ error: 'That local snapshot no longer exists. Refresh the list and retry.', code: 'ERR_SNAPSHOT_NOT_FOUND' });
  }

  const job: SnapshotDeploymentJob = { id: randomUUID(), phase: 'checking', deploymentUrl: null, error: null };
  snapshotDeploymentJob = job;
  res.status(202).json({ jobId: job.id });
  void startSnapshotDeployment(job, selectedSnapshot.filePath, appRoot, deploymentRoot);
});

snapshotDeploymentRouter.get('/:jobId', (req: Request, res: Response) => {
  if (!snapshotDeploymentJob || snapshotDeploymentJob.id !== req.params.jobId) {
    return res.status(404).json({ error: 'Snapshot deployment job not found.', code: 'ERR_SNAPSHOT_DEPLOY_JOB_NOT_FOUND' });
  }
  const { id, phase, deploymentUrl, error } = snapshotDeploymentJob;
  res.json({ jobId: id, phase, deploymentUrl, error });
});

devRouter.get('/diagnostics', (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    // 1. Table Counts
    let activityCount = 0;
    let intervalCount = 0;
    let splitCount = 0;
    let recordCount = 0;
    let profileData: any = null;
    let latestLt1: any = null;
    let latestLt2: any = null;

    try {
      const actRow = db.prepare('SELECT COUNT(*) as count FROM activities').get() as any;
      activityCount = actRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      const intRow = db.prepare('SELECT COUNT(*) as count FROM activity_intervals').get() as any;
      intervalCount = intRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      const splitRow = db.prepare('SELECT COUNT(*) as count FROM activity_splits').get() as any;
      splitCount = splitRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      const recRow = db.prepare('SELECT COUNT(*) as count FROM activity_records').get() as any;
      recordCount = recRow?.count ?? 0;
    } catch { /* optional query: schema may predate this table */ }

    try {
      profileData = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
    } catch { /* optional query: schema may predate this table */ }

    try {
      latestLt1 = db.prepare('SELECT * FROM physiological_thresholds WHERE lt1_hr IS NOT NULL ORDER BY effective_date DESC LIMIT 1').get() as any;
      latestLt2 = db.prepare('SELECT * FROM physiological_thresholds WHERE lt2_hr IS NOT NULL ORDER BY effective_date DESC LIMIT 1').get() as any;
    } catch { /* optional query: schema may predate this table */ }

    // Database file stats
    const dbPath = db.name;
    let dbSizeBytes = 0;
    if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
      try {
        const stat = fs.statSync(dbPath);
        dbSizeBytes = stat.size;
      } catch { /* best-effort cleanup: safe to ignore */ }
    }

    const mem = process.memoryUsage();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: {
          heapUsed: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
          heapTotal: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
          rss: Number((mem.rss / (1024 * 1024)).toFixed(1))
        }
      },
      db: {
        path: dbPath,
        sizeMb: Number((dbSizeBytes / (1024 * 1024)).toFixed(2)),
        activityCount,
        intervalCount,
        splitCount,
        recordCount
      },
      athlete: {
        configured: Boolean(profileData?.is_configured),
        dob: profileData?.dob,
        restingHr: profileData?.resting_hr,
        maxHr: profileData?.max_hr,
        lt1Hr: profileData?.lt1_hr ?? latestLt1?.lt1_hr,
        lt2Hr: profileData?.lt2_hr ?? latestLt2?.lt2_hr,
        baselineEconomyEf: latestLt1?.baseline_economy_ef
      },
      logs: logger.getRecentLogs(60)
    });
  } catch (err: any) {
    logger.error('DEV_DIAGNOSTICS', `Failed to generate diagnostics: ${err.message}`, err);
    res.status(500).json({
      error: 'Failed to retrieve diagnostics',
      code: 'ERR_DEV_DIAGNOSTICS_FAILED',
      message: err.message
    });
  }
});

// Endpoint to simulate an error for Dev Mode verification
devRouter.post('/test-error', (req: Request, res: Response) => {
  const { code = 'ERR_TEST_SIMULATED', message = 'Simulated diagnostic test error' } = req.body || {};
  logger.warn('DEV_TEST', `Simulated test error triggered: ${message}`, { code });
  res.status(400).json({
    error: message,
    code,
    details: {
      simulated: true,
      timestamp: new Date().toISOString()
    }
  });
});
