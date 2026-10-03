import { checkpointWal, configureWal } from '../db/wal.js';
import fs from 'node:fs';
import { deserialize } from 'node:v8';
import { availableParallelism } from 'node:os';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { importPreparedRuns, type PreparedRun } from '../ingestion/importer.js';
import type { StagedImportFile, DecodedImportFile, ImportJobStatus, ImportJobResult } from '../../shared/import-job.js';

const { databasePath, files, force, decoderPath } = workerData as
  { databasePath: string; files: StagedImportFile[]; force: boolean; decoderPath: string };
const report = (phase: ImportJobStatus['phase'], completed: number, total: number) => parentPort?.postMessage({ phase, completed, total });

async function decodeFiles(): Promise<DecodedImportFile[]> {
  const workers: Worker[] = [];
  try {
    return await new Promise((resolve, reject) => {
      const results: DecodedImportFile[] = new Array(files.length);
      let next = 0, completed = 0;
      for (let index = 0; index < Math.min(files.length, Math.max(1, Math.min(4, availableParallelism() - 1))); index++) {
        const worker = new Worker(decoderPath, { execArgv: [] });
        workers.push(worker);
        const dispatch = () => {
          if (next < files.length) {
            const fileIndex = next++;
            worker.postMessage({ file: files[fileIndex], index: fileIndex });
          }
        };
        worker.on('message', (message: DecodedImportFile) => {
          results[message.index] = message;
          report('decoding', ++completed, files.length);
          if (completed === files.length) resolve(results);
          else dispatch();
        });
        worker.on('error', reject);
        worker.on('exit', code => { if (completed < files.length) reject(new Error(`FIT decoder exited (${code})`)); });
        dispatch();
      }
    });
  } finally {
    await Promise.all(workers.map(worker => worker.terminate()));
  }
}

async function run() {
  let db: Database.Database | undefined;
  try {
    report('decoding', 0, files.length);
    const decoded = await decodeFiles();
    const results: ImportJobResult[] = new Array(files.length);
    const prepared = decoded.filter(item => {
      if (item.result) results[item.index] = item.result;
      return item.date !== undefined;
    });
    if (prepared.length) {
      // Schema is initialized by the server; this worker never runs migrations.
      db = new Database(databasePath, { fileMustExist: true });
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      configureWal(db);
      const imported = importPreparedRuns(db, prepared.map(item => ({
        filename: files[item.index].filename, date: item.date!,
        load: () => deserialize(fs.readFileSync(files[item.index].outputPath)) as PreparedRun
      })), { force, onProgress: report });
      prepared.forEach((item, index) => { results[item.index] = imported[index]; });
    }
    // Completion is sent only after the transaction has committed.
    parentPort?.postMessage({ phase: 'complete', completed: files.length, total: files.length, results });
  } catch (error) {
    parentPort?.postMessage({ phase: 'failed', error: error instanceof Error ? error.message : String(error) });
  } finally { if (db) { checkpointWal(db); db.close(); } }
}
void run();
