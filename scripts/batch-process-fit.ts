import fs from 'fs';
import path from 'path';
import { getDatabase } from '../src/backend/db/client.js';
import { convertFitToCsv } from '../src/backend/ingestion/fit-parser.js';
import { importRunContent } from '../src/backend/ingestion/importer.js';

interface BatchOptions {
  force?: boolean;
  dryRun?: boolean;
  keepFiles?: boolean;
}

export function runBatchProcessing(options: BatchOptions = {}) {
  const args = process.argv.slice(2);
  const force = options.force ?? args.includes('--force');
  const dryRun = options.dryRun ?? args.includes('--dry-run');
  const keepFiles = options.keepFiles ?? args.includes('--keep-files');

  const fitDir = path.resolve(process.cwd(), 'fit');
  const csvDir = path.resolve(process.cwd(), 'csv');

  console.log('====================================================');
  console.log('🏃 AEROLAB — Batch FIT to CSV & Database Ingestion');
  console.log('====================================================');
  if (force) console.log('⚡ Mode: FORCE (re-import and overwrite matching activities)');
  if (dryRun) console.log('🔍 Mode: DRY RUN (no database writes, no files deleted)');
  if (keepFiles) console.log('💾 Mode: KEEP FILES (fit/ and csv/ will not be deleted)');
  console.log('');

  if (!fs.existsSync(fitDir)) {
    console.error(`❌ Error: FIT directory not found: ${fitDir}`);
    process.exit(1);
  }

  const fitFiles = fs
    .readdirSync(fitDir)
    .filter(f => f.toLowerCase().endsWith('.fit'))
    .sort();

  console.log(`📂 Found ${fitFiles.length} .fit files in ${fitDir}\n`);
  if (fitFiles.length === 0) {
    console.log('No .fit files to process.');
    return;
  }

  // Ensure csv directory exists
  if (!fs.existsSync(csvDir) && !dryRun) {
    fs.mkdirSync(csvDir, { recursive: true });
  }

  const db = getDatabase();

  // Index existing activities in DB by normalized timestamp digits (YYYYMMDDHHmmss)
  const existingRows = db
    .prepare('SELECT id, name, start_time, source_filename FROM activities')
    .all() as Array<{ id: string; name: string; start_time: string; source_filename: string }>;

  const existingByDigits = new Map<string, { id: string; name: string }>();
  for (const row of existingRows) {
    if (row.start_time) {
      const digits = row.start_time.replace(/[- :.T]/g, '').slice(0, 14);
      existingByDigits.set(digits, { id: row.id, name: row.name });
    }
  }

  console.log(`ℹ️ Existing activities in database: ${existingRows.length}\n`);

  let convertedCount = 0;
  let nonRunningCount = 0;
  let parseErrorCount = 0;

  const runningWorkouts: Array<{
    fitFile: string;
    csvFile: string;
    csvContent: string;
    dateStr: string;
    distanceKm: number;
    durationMin: number;
    existingId?: string;
    existingName?: string;
  }> = [];

  console.log('--- Step 1: Converting FIT files to CSV (Running only) ---');

  for (let i = 0; i < fitFiles.length; i++) {
    const file = fitFiles[i];
    const filePath = path.join(fitDir, file);

    try {
      const buffer = fs.readFileSync(filePath);

      // Check if this workout matches an existing run in the DB by date digits
      // Filename format: YYYY-MM-DD-HH-mm-ss.fit
      const fDigits = file.replace(/[- :.T]/g, '').slice(0, 14);
      const matchInfo = existingByDigits.get(fDigits);

      const parsed = convertFitToCsv(buffer, file, matchInfo?.id, matchInfo?.name);

      if (!parsed.isRunning) {
        nonRunningCount++;
        const sportName =
          parsed.sport === 2 ? 'Cycling' : parsed.sport === 10 ? 'Strength/Training' : `Sport ${parsed.sport}`;
        console.log(`  ⏭️  [EXCLUDED] ${file} (${sportName} — ${parsed.recordCount} records)`);
        continue;
      }

      convertedCount++;
      const csvFileName = file.replace(/\.fit$/i, '.csv');
      const csvFilePath = path.join(csvDir, csvFileName);

      if (!dryRun && parsed.csv) {
        fs.writeFileSync(csvFilePath, parsed.csv, 'utf8');
      }

      runningWorkouts.push({
        fitFile: file,
        csvFile: csvFileName,
        csvContent: parsed.csv!,
        dateStr: parsed.dateStr,
        distanceKm: Number((parsed.distanceM / 1000).toFixed(2)),
        durationMin: Number((parsed.durationS / 60).toFixed(1)),
        existingId: matchInfo?.id,
        existingName: matchInfo?.name,
      });

      if (convertedCount % 25 === 0 || i === fitFiles.length - 1) {
        console.log(`  Processed ${i + 1}/${fitFiles.length} files (${convertedCount} running converted)...`);
      }
    } catch (err: any) {
      parseErrorCount++;
      console.error(`  ❌ [PARSE ERROR] ${file}: ${err.message}`);
    }
  }

  console.log(`\nConversion summary:`);
  console.log(`  🏃 Running workouts converted to CSV: ${convertedCount}`);
  console.log(`  🚲 Non-running activities excluded:    ${nonRunningCount}`);
  if (parseErrorCount > 0) console.log(`  ⚠️ Parse errors:                      ${parseErrorCount}`);
  console.log('');

  if (dryRun) {
    console.log('🔍 [DRY RUN] Skipping database ingestion and file cleanup.');
    return;
  }

  // Step 2: Database Ingestion
  console.log('--- Step 2: Ingesting into Database ---');

  let importedCount = 0;
  let skippedCount = 0;
  let ingestErrorCount = 0;

  for (let i = 0; i < runningWorkouts.length; i++) {
    const w = runningWorkouts[i];

    try {
      const res = importRunContent(db, w.csvContent, w.csvFile, { force });

      if (res.status === 'imported') {
        importedCount++;
        console.log(
          `  ✅ [IMPORTED] ${res.name || 'Run'} (${res.date}) - ${res.distanceKm} km | Type: ${res.runType} | EF: ${res.efficiencyFactor ?? 'N/A'}`
        );
      } else if (res.status === 'skipped_duplicate') {
        skippedCount++;
        console.log(`  ⏭️  [DUPLICATE] ${w.csvFile} (${res.name || 'Run'} ${res.date})`);
      } else {
        ingestErrorCount++;
        console.log(`  ❌ [ERROR] ${w.csvFile}: ${res.error}`);
      }
    } catch (err: any) {
      ingestErrorCount++;
      console.error(`  ❌ [INGEST ERROR] ${w.csvFile}: ${err.message}`);
    }
  }

  const finalCountRow = db.prepare('SELECT count(*) as c FROM activities').get() as { c: number };

  console.log('\n====================================================');
  console.log('📊 Pipeline Summary:');
  console.log(`  Total FIT files scanned:       ${fitFiles.length}`);
  console.log(`  Running workouts converted:    ${convertedCount}`);
  console.log(`  Non-running files excluded:    ${nonRunningCount}`);
  console.log(`  New runs imported to DB:       ${importedCount}`);
  console.log(`  Duplicates skipped:            ${skippedCount}`);
  if (ingestErrorCount > 0) console.log(`  Ingestion errors:              ${ingestErrorCount}`);
  console.log(`  Total activities in runs.db:   ${finalCountRow.c}`);
  console.log('====================================================\n');

  // Step 3: Cleanup files if not disabled
  if (!keepFiles) {
    console.log('--- Step 3: Cleanup ---');
    try {
      if (fs.existsSync(csvDir)) {
        fs.rmSync(csvDir, { recursive: true, force: true });
        console.log(`🧹 Removed temporary CSV directory: ${csvDir}`);
      }
      if (fs.existsSync(fitDir)) {
        fs.rmSync(fitDir, { recursive: true, force: true });
        console.log(`🧹 Removed FIT directory: ${fitDir}`);
      }
      console.log('✨ Cleanup complete!');
    } catch (err: any) {
      console.error(`⚠️ Warning during cleanup: ${err.message}`);
    }
  } else {
    console.log('💾 Kept fit/ and csv/ directories as requested by --keep-files.');
  }

  console.log('\n🚀 All done! You can view your updated runs in AEROLAB.\n');
}

// Run when executed directly
runBatchProcessing();
