import fs from 'node:fs';
import { serialize } from 'node:v8';
import { parentPort } from 'node:worker_threads';
import { parseRunFit } from '../ingestion/fit-parser.js';
import { calculateEconomy, calculateKmSplits } from '../physiology/economy.js';
import type { PreparedRun } from '../ingestion/importer.js';
import type { StagedImportFile, DecodedImportFile } from '../../shared/import-job.js';

parentPort?.on('message', ({ file, index }: { file: StagedImportFile; index: number }) => {
  let response: DecodedImportFile;
  try {
    const parsed: PreparedRun | null = parseRunFit(fs.readFileSync(file.inputPath), file.filename);
    if (parsed) {
      parsed.precomputed = { economy: calculateEconomy(parsed.records), splits: calculateKmSplits(parsed.records) };
      fs.writeFileSync(file.outputPath, serialize(parsed));
      response = { index, date: parsed.metadata.date };
    } else response = { index, result: { status: 'skipped_non_running', reason: 'non_run' } };
  } catch (error) {
    response = { index, result: { status: 'error', error: error instanceof Error ? error.message : String(error) } };
  }
  parentPort?.postMessage(response);
});
