import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { IMPORT_BATCH_SIZE } from '../../shared/import-batch.js';
import type { ImportJobStatus, StagedImportFile } from '../../shared/import-job.js';
import { isMaintenanceRunning } from './maintenance.js';

interface Job { status: ImportJobStatus; directory: string; databasePath: string; force: boolean; files: StagedImportFile[]; worker?: Worker; staging: boolean; stagingDone?: Promise<void>; expiry?: NodeJS.Timeout }
let job: Job | undefined;
const active = (value?: Job) => value && !['complete', 'failed'].includes(value.status.phase);
export const isImportJobRunning = () => Boolean(active(job));
const runFile = promisify(execFile);
let bundles: Promise<{ entry: string; decoderPath: string }> | undefined;

async function workerBundles() {
  return bundles ??= (async () => {
    const sourceDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));
    const production = process.env.NODE_ENV === 'production';
    const root = path.resolve(sourceDir, '..', '..', '..');
    const directory = production ? sourceDir : path.join(root, 'dist-backend');
    const entry = path.join(directory, 'import-worker.cjs');
    const decoderPath = path.join(directory, 'fit-decode-worker.cjs');
    if (!production) {
      await fs.mkdir(directory, { recursive: true });
      for (const name of ['import-worker', 'fit-decode-worker']) {
        await runFile(process.execPath, [path.join(root, 'node_modules/esbuild/bin/esbuild'), path.join(sourceDir, `${name}.ts`),
          '--bundle', '--platform=node', '--format=cjs', '--external:better-sqlite3', '--define:import.meta.url="undefined"',
          '--log-override:empty-import-meta=silent', `--outfile=${path.join(directory, `${name}.cjs`)}`]);
      }
    }
    await fs.access(entry);
    await fs.access(decoderPath);
    return { entry, decoderPath };
  })().catch(error => { bundles = undefined; throw error; });
}

async function cleanup(value: Job) {
  const target = path.resolve(value.directory);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('aerolab-import-')) throw new Error('Unsafe import cleanup path');
  await fs.rm(target, { recursive: true, force: true });
}

function find(id: string): Job {
  if (!job || job.status.jobId !== id) throw new Error('Import job not found');
  return job;
}
export function getImportJob(id: string): ImportJobStatus { return { ...find(id).status }; }

export async function createImportJob(databasePath: string, totalFiles: number, force: boolean): Promise<ImportJobStatus> {
  if (active(job) || isMaintenanceRunning()) throw new Error('Database is busy');
  if (databasePath === ':memory:') throw new Error('Background imports require a file database');
  if (!Number.isInteger(totalFiles) || totalFiles < 1 || totalFiles > 2000) throw new Error('Invalid file count');
  const value: Job = { status: { jobId: randomUUID(), phase: 'uploading', completed: 0, total: totalFiles, uploaded: 0, totalFiles },
    directory: '', databasePath, force, files: [], staging: false };
  // Reserve synchronously before the first await, so two requests cannot start jobs.
  job = value;
  try { value.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aerolab-import-')); }
  catch (error) { value.status.phase = 'failed'; throw error; }
  value.expiry = setTimeout(() => {
    if (job === value && value.status.phase === 'uploading') void cancelImportJob(value.status.jobId).catch(() => {});
  }, 30 * 60 * 1000);
  value.expiry.unref();
  return { ...value.status };
}

export async function stageImportFiles(id: string, files: Array<{ filename: string; content: string }>): Promise<ImportJobStatus> {
  const value = find(id);
  if (value.status.phase !== 'uploading' || value.staging || !value.directory) throw new Error('Import job is not accepting files');
  if (!files.length || files.length > IMPORT_BATCH_SIZE || value.files.length + files.length > value.status.totalFiles ||
      files.some(file => !file || typeof file.filename !== 'string' || !/\.(fit|zip)$/i.test(file.filename) || typeof file.content !== 'string' || !file.content)) throw new Error('Invalid import files');
  value.staging = true;
  let finishStaging!: () => void;
  value.stagingDone = new Promise(resolve => { finishStaging = resolve; });
  try {
    const staged: StagedImportFile[] = [];
    for (const file of files) {
      const index = value.files.length + staged.length;
      const inputPath = path.join(value.directory, `${index}.input`);
      const outputPath = path.join(value.directory, `${index}.decoded`);
      const content = file.content.includes(';base64,') ? file.content.split(';base64,')[1] : file.content;
      await fs.writeFile(inputPath, Buffer.from(content, 'base64'));
      staged.push({ filename: path.basename(file.filename), inputPath, outputPath });
    }
    value.files.push(...staged);
    value.status.uploaded = value.status.completed = value.files.length;
    return { ...value.status };
  } finally { value.staging = false; finishStaging(); }
}

export async function finishImportJob(id: string, totalFiles?: number): Promise<ImportJobStatus> {
  const value = find(id);
  const expected = totalFiles ?? value.status.totalFiles;
  if (value.status.phase !== 'uploading' || value.staging || !Number.isInteger(expected) || expected < 1 || expected > value.status.totalFiles || value.files.length !== expected) throw new Error('Import job has missing files');
  value.status.totalFiles = value.status.total = expected;
  clearTimeout(value.expiry);
  value.status.phase = 'decoding';
  value.status.completed = 0;
  try {
    const { entry, decoderPath } = await workerBundles();
    value.worker = new Worker(entry, { execArgv: [], workerData: { databasePath: value.databasePath, files: value.files, force: value.force, decoderPath } });
    value.worker.on('message', (message: Partial<ImportJobStatus>) => {
      value.status = { ...value.status, ...message };
    });
    value.worker.on('error', error => { value.status = { ...value.status, phase: 'failed', error: error.message }; });
    value.worker.on('exit', () => {
      value.worker = undefined;
      if (active(value)) value.status = { ...value.status, phase: 'failed', error: 'Import worker stopped before completion' };
      void cleanup(value).catch(() => {});
    });
  } catch (error) {
    value.status = { ...value.status, phase: 'failed', error: error instanceof Error ? error.message : String(error) };
    await cleanup(value);
    throw error;
  }
  return { ...value.status };
}

/** Cancellation is allowed while uploading, before any database writes. */
export async function cancelImportJob(id: string): Promise<void> {
  const value = find(id);
  if (value.status.phase !== 'uploading') throw new Error('Import is already processing');
  value.status.phase = 'failed';
  clearTimeout(value.expiry);
  await value.stagingDone;
  await cleanup(value);
}
