import path from 'path';
import fs from 'fs';
import { getDatabase } from '../src/backend/db/client.js';
import { importRunFile } from '../src/backend/ingestion/importer.js';

function runIngestion() {
  const db = getDatabase();
  const args = process.argv.slice(2);

  const shouldClean = args.includes('--clean');
  const shouldForce = args.includes('--force');

  const customDirArg = args.find(a => !a.startsWith('--'));
  const rawDir = customDirArg ? path.resolve(process.cwd(), customDirArg) : path.resolve(process.cwd(), 'data', 'raw');

  if (!fs.existsSync(rawDir)) {
    fs.mkdirSync(rawDir, { recursive: true });
    console.log(`Created directory: ${rawDir}`);
    console.log('Drop Garmin FIT or activity ZIP files into data/raw/ and run: npm run ingest');
    return;
  }

  // Check if target is a single file
  if (fs.statSync(rawDir).isFile()) {
    const targetFile = rawDir;
    console.log(`\n📥 Ingesting single file: ${targetFile}`);
    const res = importRunFile(db, targetFile, { force: shouldForce });
    console.log(res);
    return;
  }

  console.log(`\n📂 Scanning folder for FIT & ZIP files: ${rawDir}`);
  const allFiles = fs.readdirSync(rawDir).filter(f => {
    const l = f.toLowerCase();
    return l.endsWith('.fit') || l.endsWith('.zip');
  });

  console.log(`Found ${allFiles.length} file(s) to process.\n--- Ingestion Results ---`);
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const processedFiles: string[] = [];

  for (const file of allFiles) {
    const fullPath = path.join(rawDir, file);
    try {
      const r = importRunFile(db, fullPath, { force: shouldForce });

      if (r.status === 'imported') {
        imported++;
        processedFiles.push(fullPath);
        console.log(`✅ [IMPORTED] ${r.name} (${r.date}) - ${r.distanceKm} km | Type: ${r.runType} | EF: ${r.efficiencyFactor}`);
      } else if (r.status === 'skipped_duplicate') {
        skipped++;
        processedFiles.push(fullPath);
        console.log(`⏭️  [DUPLICATE] ${r.name} (${r.date})`);
      } else {
        errors++;
        console.log(`❌ [ERROR] ${file}: ${r.error}`);
      }
    } catch (err: any) {
      errors++;
      console.log(`❌ [ERROR] ${file}: ${err.message}`);
    }
  }

  // If --clean is passed, remove processed files from folder so they don't accumulate
  if (shouldClean && processedFiles.length > 0) {
    for (const p of processedFiles) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
    console.log(`\n🧹 Cleaned up ${processedFiles.length} raw file(s) from ${rawDir}`);
  }

  console.log(`\nSummary: ${imported} imported, ${skipped} duplicates skipped, ${errors} errors.\n`);
}

runIngestion();
