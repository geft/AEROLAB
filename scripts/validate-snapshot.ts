import fs from 'node:fs';
import path from 'node:path';
import { validateSnapshot } from './export-snapshot.js';

const snapshotPath = path.resolve('snapshot-data/snapshot.json');
if (!fs.existsSync(snapshotPath)) throw new Error('Snapshot not found. Run npm run snapshot:export first.');
const value: unknown = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
validateSnapshot(value);
console.log(`Snapshot valid: ${snapshotPath}`);
