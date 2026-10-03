import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());

class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = [];
  constructor(public readonly entry: string, public readonly options: unknown) {
    super();
    FakeWorker.instances.push(this);
  }
}

vi.mock('worker_threads', () => ({ Worker: FakeWorker }));
vi.mock('child_process', () => ({ execFileSync: execMock }));

let tempDir: string;
let originalNodeEnv: string | undefined;
let originalAppData: string | undefined;
const devBundle = path.resolve('dist-backend/maintenance-worker-dev.cjs');
const hadDevBundle = fs.existsSync(devBundle);

async function loadMaintenance() {
  vi.resetModules();
  return import('../../src/backend/jobs/maintenance.js');
}

function statusFile() {
  return path.join(tempDir, 'aerolab', 'development-maintenance-status.json');
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerolab-maintenance-'));
  originalNodeEnv = process.env.NODE_ENV;
  originalAppData = process.env.APPDATA;
  process.env.NODE_ENV = 'test';
  process.env.APPDATA = tempDir;
  execMock.mockReset();
  FakeWorker.instances = [];
  execMock.mockImplementation((_command: string, args: string[]) => {
    const outfile = args.find(arg => arg.startsWith('--outfile='))?.slice('--outfile='.length);
    if (outfile) {
      fs.mkdirSync(path.dirname(outfile), { recursive: true });
      fs.writeFileSync(outfile, '// test bundle');
    }
  });
});

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = originalAppData;
  if (!hadDevBundle && fs.existsSync(devBundle)) fs.unlinkSync(devBundle);
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('background maintenance status', () => {
  it('returns idle when there is no saved status', async () => {
    const maintenance = await loadMaintenance();
    expect(maintenance.getMaintenanceStatus()).toEqual({ status: 'idle' });
  });

  it('reads a saved status and treats persisted running work as interrupted', async () => {
    const maintenance = await loadMaintenance();
    fs.mkdirSync(path.dirname(statusFile()), { recursive: true });
    fs.writeFileSync(statusFile(), JSON.stringify({ status: 'complete', task: 'startup' }));
    expect(maintenance.getMaintenanceStatus()).toEqual({ status: 'complete', task: 'startup' });
    fs.writeFileSync(statusFile(), JSON.stringify({ status: 'running', task: 'profile', startedAt: 'then' }));
    expect(maintenance.getMaintenanceStatus()).toEqual({ status: 'interrupted', task: 'profile', startedAt: 'then' });
  });

  it.each(['not json', '{'])('falls back to idle for invalid status JSON (%s)', async saved => {
    fs.mkdirSync(path.dirname(statusFile()), { recursive: true });
    fs.writeFileSync(statusFile(), saved);
    const maintenance = await loadMaintenance();
    expect(maintenance.getMaintenanceStatus()).toEqual({ status: 'idle' });
  });
});

describe('background maintenance worker lifecycle', () => {
  it('bundles and starts a development worker, then persists completion and calls callback', async () => {
    const maintenance = await loadMaintenance();
    const onComplete = vi.fn();
    maintenance.startMaintenance('temp.db', onComplete);
    expect(execMock).toHaveBeenCalledOnce();
    const worker = FakeWorker.instances[0];
    expect(worker.options).toMatchObject({ workerData: { databasePath: 'temp.db', task: 'startup', baselineChanged: false } });
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'running', task: 'startup' });
    worker.emit('message', { status: 'complete', completedMigrations: 2, syncedActivitiesCount: 4 });
    expect(onComplete).not.toHaveBeenCalled();
    expect(maintenance.getMaintenanceStatus().status).toBe('running');
    worker.emit('exit', 0);
    expect(onComplete).toHaveBeenCalledOnce();
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'complete', completedMigrations: 2, syncedActivitiesCount: 4 });
    expect(maintenance.isMaintenanceRunning()).toBe(false);
  });

  it('persists bundle command failures and missing production bundles', async () => {
    const maintenance = await loadMaintenance();
    execMock.mockImplementationOnce(() => { throw new Error('bundle failed'); });
    maintenance.startMaintenance('temp.db');
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'failed', error: 'Error: bundle failed' });
    expect(FakeWorker.instances).toHaveLength(0);

    process.env.NODE_ENV = 'production';
    maintenance.startMaintenance('temp.db');
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'failed', error: expect.stringContaining('Maintenance worker bundle missing') });
  });

  it('persists worker failed messages and worker errors', async () => {
    const maintenance = await loadMaintenance();
    maintenance.startMaintenance('temp.db');
    FakeWorker.instances[0].emit('message', { status: 'failed', error: 'migration failed' });
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'failed', error: 'migration failed' });
    FakeWorker.instances[0].emit('exit', 1);

    maintenance.startMaintenance('temp.db');
    FakeWorker.instances[1].emit('error', new Error('worker crashed'));
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'failed', error: 'worker crashed' });
    FakeWorker.instances[1].emit('exit', 1);
  });

  it('marks an early worker exit interrupted', async () => {
    const maintenance = await loadMaintenance();
    maintenance.startMaintenance('temp.db');
    FakeWorker.instances[0].emit('exit', 7);
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'interrupted', error: 'Worker exited with code 7' });
  });

  it('coalesces queued profile recomputes and preserves baseline changes through the next start', async () => {
    const maintenance = await loadMaintenance();
    maintenance.startMaintenance('first.db');
    expect(maintenance.isMaintenanceRunning()).toBe(true);
    maintenance.queueProfileRecompute('queued-a.db', false);
    maintenance.queueProfileRecompute('queued-b.db', true);
    maintenance.queueProfileRecompute('queued-c.db', false);
    expect(maintenance.isMaintenanceRunning()).toBe(true);
    expect(FakeWorker.instances).toHaveLength(1);
    FakeWorker.instances[0].emit('message', { status: 'complete' });
    FakeWorker.instances[0].emit('exit', 0);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].options).toMatchObject({ workerData: { databasePath: 'queued-c.db', task: 'profile', baselineChanged: true } });
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'running', task: 'profile' });
    FakeWorker.instances[1].emit('exit', 0);
    expect(maintenance.getMaintenanceStatus()).toMatchObject({ status: 'interrupted' });
  });
});
