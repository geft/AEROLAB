import { describe, it, expect, vi } from 'vitest';
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
    // 60 min at the 168 bpm LT2 boundary (top of Z4)
    const records: Array<{ elapsed_seconds: number; heart_rate: number }> = [];
    for (let s = 0; s <= 3600; s += 2) {
      records.push({ elapsed_seconds: s, heart_rate: 168 });
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

  it('keeps current load independent of the requested chart history and includes old training', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY, start_time TEXT, duration_seconds INTEGER, training_load REAL)');
      const insert = db.prepare('INSERT INTO activities VALUES (?, ?, 3600, 60)');
      for (let day = 365; day >= 0; day--) {
        insert.run(`run-${day}`, new Date(Date.now() - day * 86400000).toISOString());
      }
      const short = calculateTrainingStatus(db, 7);
      const long = calculateTrainingStatus(db, 180);
      expect(short.currentChronicLoad).toBe(long.currentChronicLoad);
      expect(short.currentAcuteLoad).toBe(long.currentAcuteLoad);
      expect(short.acwr).toBe(1);
      expect(short.timeline).toEqual(long.timeline.slice(-7));
      expect(short.currentChronicLoad).toBe(Math.round(60 / (1 - Math.exp(-1 / 7))));
      expect(short.last7DaysLoad).toBe(420);
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });

  it('decays training before the display window and excludes future activities', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE activities (id TEXT PRIMARY KEY, start_time TEXT, duration_seconds INTEGER, training_load REAL)');
      const insert = db.prepare('INSERT INTO activities VALUES (?, ?, 3600, ?)');
      insert.run('old', '2026-07-01T12:00:00Z', 1000);
      insert.run('future', '2026-10-02T12:00:00Z', 10000);
      for (let i = 0; i < 5; i++) insert.run(`stale-${i}`, '2020-01-01T12:00:00Z', 100);
      const status = calculateTrainingStatus(db, 7);
      const daysAgo = (Date.parse('2026-10-01') - Date.parse('2026-07-01')) / 86400000;
      const chronicScale = (1 - Math.exp(-1 / 28)) / (1 - Math.exp(-1 / 7));
      expect(status.currentChronicLoad).toBe(Math.round(1000 * Math.exp(-daysAgo / 28) * chronicScale));
      expect(status.last7DaysLoad).toBe(0);
      expect(status.timeline.every(point => point.dailyLoad === 0)).toBe(true);
      expect(status.status).toBe('establishing');
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });
});
