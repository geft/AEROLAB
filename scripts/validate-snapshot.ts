import fs from 'node:fs';
import path from 'node:path';
import { validateSnapshot } from './export-snapshot.js';
import { decodeSnapshot, SNAPSHOT_FILENAME } from '../src/shared/snapshot-codec.js';

const snapshotPath = process.argv[2] ? path.resolve(process.argv[2])
  : path.resolve('snapshot-data', SNAPSHOT_FILENAME);
if (!fs.existsSync(snapshotPath)) throw new Error('Snapshot not found. Run npm run snapshot:export first.');
const value: unknown = decodeSnapshot(fs.readFileSync(snapshotPath));
validateSnapshot(value);
console.log(`Snapshot valid: ${snapshotPath}`);
