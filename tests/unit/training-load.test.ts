import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { calculateActivityTrainingLoad, calculateTrainingStatus } from '../../src/backend/physiology/training-load.js';

describe('Training Load & ACWR Engine Unit Tests', () => {
  const mockProfile = {
    maxHr: 190,
    restingHr: 50,
    lt1Hr: 148,
    lt2Hr: 168,
    gender: 'male'
  };

  it('calculates low training load for an easy 30-minute recovery run', () => {
    // 30 min at 130 bpm (Z2)
    const records: Array<{ elapsed_seconds: number; heart_rate: number }> = [];
    for (let s = 0; s <= 1800; s += 2) {
      records.push({ elapsed_seconds: s, heart_rate: 130 });
    }

    const res = calculateActivityTrainingLoad(records, mockProfile);
    expect(res.trainingLoad).toBeGreaterThan(15);
    expect(res.trainingLoad).toBeLessThan(50);
    expect(res.zones.z2Seconds).toBeGreaterThan(1700);
  });

  it('calculates higher training load for a 60-minute threshold workout', () => {
    // 60 min at 170 bpm (Z4 threshold)
    const records: Array<{ elapsed_seconds: number; heart_rate: number }> = [];
    for (let s = 0; s <= 3600; s += 2) {
      records.push({ elapsed_seconds: s, heart_rate: 170 });
    }

    const res = calculateActivityTrainingLoad(records, mockProfile);
    expect(res.trainingLoad).toBeGreaterThan(120);
    expect(res.trainingLoad).toBeLessThan(250);
    expect(res.zones.z4Seconds).toBeGreaterThan(3500);
  });

  it('computes training status, acute load, chronic load and optimal tunnel', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        start_time TEXT,
        duration_seconds INTEGER,
        training_load REAL
      );
    `);

    // Insert 4 weeks of consistent training (3 runs per week, load ~60 each)
    const now = new Date();
    for (let i = 28; i >= 1; i -= 2) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      db.prepare(`
        INSERT INTO activities (id, start_time, duration_seconds, training_load)
        VALUES (?, ?, 3600, 60)
      `).run(`act-${i}`, date.toISOString());
    }

    const status = calculateTrainingStatus(db, 30);
    expect(status.currentAcuteLoad).toBeGreaterThan(0);
    expect(status.currentChronicLoad).toBeGreaterThan(0);
    expect(status.optimalRange.min).toBeLessThan(status.optimalRange.max);
    expect(['optimal', 'maintaining', 'recovery', 'overreaching']).toContain(status.status);
    expect(status.timeline.length).toBe(30);

    db.close();
  });
});
