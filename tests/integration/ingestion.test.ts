import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDatabase } from '../../src/backend/db/client';
import { importRunContent } from '../../src/backend/ingestion/importer';

describe('Database Ingestion Pipeline (Integration)', () => {
  let db: Database.Database;
  const samplePath = path.resolve(__dirname, '../fixtures/sample-run.csv');
  const sampleContent = fs.readFileSync(samplePath, 'utf8');

  beforeEach(() => {
    // In-memory database for clean, isolated test runs
    db = getDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('imports activity, computes running economy, and stores splits & records', () => {
    const res = importRunContent(db, sampleContent, 'sample-run.csv');
    expect(res.status).toBe('imported');
    expect(res.activityId).toBe('24321232759');
    expect(res.runType).toBe('easy_base');

    // Query activities table
    const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get('24321232759') as any;
    expect(activity).toBeDefined();
    expect(activity.name).toBe('Singapore Running');
    expect(activity.avg_heart_rate).toBe(130);
    expect(activity.distance_meters).toBe(8598.59);
    expect(activity.efficiency_factor).toBeGreaterThan(0);
    expect(activity.workout_lat).toBeCloseTo(1.36, 1);
    expect(activity.workout_lon).toBeCloseTo(103.88, 1);

    // Query records table
    const recordCount = db.prepare('SELECT COUNT(*) as count FROM activity_records WHERE activity_id = ?').get('24321232759') as any;
    expect(recordCount.count).toBeGreaterThan(0);
  });

  it('safely skips duplicate files using SHA-256 hash', () => {
    const firstImport = importRunContent(db, sampleContent, 'sample-run.csv');
    expect(firstImport.status).toBe('imported');

    // Second import of same content
    const secondImport = importRunContent(db, sampleContent, 'sample-run.csv');
    expect(secondImport.status).toBe('skipped_duplicate');
    expect(secondImport.activityId).toBe('24321232759');

    // Ensure only 1 row in activities table
    const count = db.prepare('SELECT COUNT(*) as count FROM activities').get() as any;
    expect(count.count).toBe(1);
  });

  it('allows force re-import when force: true is specified', () => {
    const firstImport = importRunContent(db, sampleContent, 'sample-run.csv');
    expect(firstImport.status).toBe('imported');

    // Force re-import replaces the activity
    const forceImport = importRunContent(db, sampleContent, 'sample-run.csv', { force: true });
    expect(forceImport.status).toBe('imported');
    expect(forceImport.activityId).toBe('24321232759');

    const count = db.prepare('SELECT COUNT(*) as count FROM activities').get() as any;
    expect(count.count).toBe(1);
  });
});
