import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { findFastestSegment, getAthleteBestEfforts, BEST_EFFORT_TARGETS } from '../../src/backend/physiology/best-efforts.js';

describe('Best Efforts Tracker Unit Tests', () => {
  it('finds fastest segment from continuous records', () => {
    // 5 km run with a fast middle km (km 3 is 4:00/km, rest is 5:00/km)
    const records: Array<{ elapsed_seconds: number; distance_m: number }> = [];
    let sec = 0;
    let dist = 0;

    // Km 1 & 2: 300 sec per 1000m (5:00/km)
    for (let i = 0; i < 2000; i += 10) {
      records.push({ elapsed_seconds: sec, distance_m: dist });
      sec += 3; // 3 sec per 10m = 300s/km
      dist += 10;
    }

    // Km 3: 240 sec per 1000m (4:00/km) - fastest 1k!
    for (let i = 0; i < 1000; i += 10) {
      records.push({ elapsed_seconds: sec, distance_m: dist });
      sec += 2.4;
      dist += 10;
    }

    // Km 4 & 5: 300 sec per 1000m
    for (let i = 0; i <= 2000; i += 10) {
      records.push({ elapsed_seconds: sec, distance_m: dist });
      sec += 3;
      dist += 10;
    }

    const fastest1k = findFastestSegment(records, 1000);
    expect(fastest1k).toBeDefined();
    expect(fastest1k).toBeCloseTo(240, -1); // Approx 240s (4:00)

    const fastest5k = findFastestSegment(records, 5000);
    expect(fastest5k).toBeDefined();
    expect(fastest5k).toBeGreaterThan(1400);
  });

  it('returns null if workout is shorter than target distance', () => {
    const records = [
      { elapsed_seconds: 0, distance_m: 0 },
      { elapsed_seconds: 120, distance_m: 500 }
    ];
    expect(findFastestSegment(records, 1000)).toBeNull();
  });

  it('extracts all-time and current year PRs from database', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        name TEXT,
        start_time TEXT,
        distance_meters REAL,
        duration_seconds REAL
      );
      CREATE TABLE activity_records (
        id INTEGER PRIMARY KEY,
        activity_id TEXT,
        elapsed_seconds REAL,
        distance_m REAL
      );
    `);

    db.prepare(`
      INSERT INTO activities (id, name, start_time, distance_meters, duration_seconds)
      VALUES ('act-5k-fast', '5k Race PB', '2026-09-10T08:00:00Z', 5000, 1260)
    `).run();

    const efforts = getAthleteBestEfforts(db);
    expect(efforts.allTime.length).toBeGreaterThan(0);
    const pb5k = efforts.allTime.find(e => e.targetId === '5k');
    expect(pb5k).toBeDefined();
    expect(pb5k?.timeSeconds).toBe(1260);

    db.close();
  });

  it('tracks 1 km, 5 km, 10 km, Half Marathon and Marathon (no 1 Mile)', () => {
    const ids = BEST_EFFORT_TARGETS.map(t => t.id);
    expect(ids).toEqual(['1k', '5k', '10k', 'hm', 'mar']);
    expect(ids).not.toContain('1mi');
    expect(BEST_EFFORT_TARGETS.some(t => t.label === '1 Mile')).toBe(false);

    const marathon = BEST_EFFORT_TARGETS.find(t => t.id === 'mar');
    expect(marathon?.label).toBe('Marathon');
    expect(marathon?.distanceMeters).toBe(42195);
  });

  it('always reports every target so un-raced distances can render as empty tiles', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        name TEXT,
        start_time TEXT,
        distance_meters REAL,
        duration_seconds REAL
      );
      CREATE TABLE activity_records (
        id INTEGER PRIMARY KEY,
        activity_id TEXT,
        elapsed_seconds REAL,
        distance_m REAL
      );
    `);

    // Only a 5k effort exists — Marathon has no record yet
    db.prepare(`
      INSERT INTO activities (id, name, start_time, distance_meters, duration_seconds)
      VALUES ('act-5k', 'Parkrun', '2026-09-10T08:00:00Z', 5000, 1260)
    `).run();

    const efforts = getAthleteBestEfforts(db);

    expect(efforts.targets.map(t => t.id)).toEqual(['1k', '5k', '10k', 'hm', 'mar']);
    expect(efforts.allTime.map(t => t.targetId)).toContain('5k');
    expect(efforts.allTime.some(t => t.targetId === 'mar')).toBe(false);
    expect(efforts.targets.find(t => t.id === 'mar')?.distanceMeters).toBe(42195);

    db.close();
  });
});
