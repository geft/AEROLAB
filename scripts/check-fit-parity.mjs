import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parser = process.argv[2] ?? path.resolve(root, '../fit-parser');
const left = fs.readFileSync(path.join(root, 'src/backend/ingestion/fit-core.mjs'));
const right = fs.readFileSync(path.join(parser, 'lib/fit-core.mjs'));
if (!left.equals(right)) throw new Error('FIT core differs from the optional CSV extension');
const dependencies = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies;
const companion = JSON.parse(fs.readFileSync(path.join(parser, 'package.json'), 'utf8')).dependencies;
for (const name of ['@garmin/fitsdk', 'fflate']) {
  if (dependencies[name] !== companion[name]) throw new Error(`FIT dependency differs: ${name}`);
}
console.log('FIT core and pinned decoding dependencies match the CSV extension.');
