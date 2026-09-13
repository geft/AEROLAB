import path from 'path';
import fs from 'fs';
import { getDatabase } from '../src/backend/db/client.js';
import { importRunFile, importDirectory } from '../src/backend/ingestion/importer.js';

function runIngestion() {
  const db = getDatabase();
  const args = process.argv.slice(2);

  const shouldClean = args.includes('--clean');
  const shouldForce = args.includes('--force');

  if (args.length > 0 && args[0] !== '--' && !args[0].startsWith('--')) {
    const targetFile = path.resolve(process.cwd(), args[0]);
    console.log(`\n📥 Ingesting single file: ${targetFile}`);
    const res = importRunFile(db, targetFile, { force: shouldForce });
    console.log(res);
    return;
  }

  const rawDir = path.resolve(process.cwd(), 'data', 'raw');
  if (!fs.existsSync(rawDir)) {
    fs.mkdirSync(rawDir, { recursive: true });
    console.log(`Created directory: ${rawDir}`);
    console.log('Drop Garmin CSV files into data/raw/ and run: npm run ingest');
    return;
  }

  console.log(`\n📂 Scanning folder: ${rawDir}`);
  const results = importDirectory(db, rawDir, { force: shouldForce });

  console.log('\n--- Ingestion Results ---');
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  for (const r of results) {
    if (r.status === 'imported') {
      imported++;
      console.log(`✅ [IMPORTED] ${r.name} (${r.date}) - ${r.distanceKm} km | Type: ${r.runType} | EF: ${r.efficiencyFactor}`);
    } else if (r.status === 'skipped_duplicate') {
      skipped++;
      console.log(`⏭️  [DUPLICATE] ${r.name} (${r.date})`);
    } else {
      errors++;
      console.log(`❌ [ERROR] ${r.error}`);
    }
  }

  // If --clean is passed, remove processed CSVs from data/raw so they don't accumulate
  if (shouldClean) {
    const rawFiles = fs.readdirSync(rawDir).filter(f => f.endsWith('.csv'));
    for (const file of rawFiles) {
      fs.unlinkSync(path.join(rawDir, file));
    }
    console.log(`🧹 Cleaned up ${rawFiles.length} raw CSV file(s) from data/raw/`);
  }

  console.log(`\nSummary: ${imported} imported, ${skipped} duplicates skipped, ${errors} errors.\n`);
}

runIngestion();
