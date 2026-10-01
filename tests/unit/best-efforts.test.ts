import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { findFastestSegment, getAthleteBestEfforts, BEST_EFFORT_TARGETS } from '../../src/backend/physiology/best-efforts.js';

describe('Best Efforts Tracker Unit Tests', () => {
  it('interpolates the finish instead of charging for distance beyond the target', () => {
    const records = [0, 350, 700, 1050].map(distance_m => ({ distance_m, elapsed_seconds: distance_m / 3.5 }));
    expect(findFastestSegment(records, 1000)).toBe(286);
  });

  it('finds an optimum whose start lies between samples', () => {
    const records = [
      { distance_m: 0, elapsed_seconds: 0 },
      { distance_m: 600, elapsed_seconds: 300 },
      { distance_m: 1400, elapsed_seconds: 460 }
    ];
    // Start at 400 m (200 s), finish at 1400 m (460 s).
    expect(findFastestSegment(records, 1000)).toBe(260);
  });

  it('includes pauses inside an effort but can start after a stationary plateau', () => {
    const records = [
      { distance_m: 0, elapsed_seconds: 0 },
      { distance_m: 500, elapsed_seconds: 100 },
      { distance_m: 500, elapsed_seconds: 200 },
      { distance_m: 1500, elapsed_seconds: 400 }
    ];
    expect(findFastestSegment(records, 1000)).toBe(200);
    expect(findFastestSegment(records, 1500)).toBe(400);
  });

  it('does not manufacture an effort across a distance reset or invalid telemetry', () => {
    expect(findFastestSegment([
      { distance_m: 0, elapsed_seconds: 0 },
      { distance_m: 900, elapsed_seconds: 300 },
      { distance_m: 0, elapsed_seconds: 301 },
      { distance_m: 1100, elapsed_seconds: 631 }
    ], 1000)).toBe(300);
    expect(findFastestSegment([
      { distance_m: 0, elapsed_seconds: 0 },
      { distance_m: null, elapsed_seconds: 100 },
      { distance_m: 1000, elapsed_seconds: 300 }
    ], 1000)).toBeNull();
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid target distance %s', target => {
    expect(findFastestSegment([
      { distanceMeters: 0, elapsedSeconds: 0 },
      { distanceMeters: 1000, elapsedSeconds: 300 }
    ], target)).toBeNull();
  });

  it('matches an exhaustive interpolated-window reference for irregular traces with pauses', () => {
    let seed = 20261001;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let trial = 0; trial < 40; trial++) {
      const records = [{ distance_m: 0, elapsed_seconds: 0 }];
      for (let i = 0; i < 35; i++) {
        const previous = records[records.length - 1];
        records.push({
          distance_m: previous.distance_m + (random() < 0.2 ? 0 : 50 + random() * 300),
          elapsed_seconds: previous.elapsed_seconds + 10 + random() * 120
        });
      }
      const target = 1000;
      const total = records[records.length - 1].distance_m;
      const candidates = records.flatMap(r => [r.distance_m, r.distance_m - target])
        .filter(distance => distance >= 0 && distance + target <= total);
      const timesAt = (distance: number) => {
        const times = records.filter(r => r.distance_m === distance).map(r => r.elapsed_seconds);
        for (let i = 1; i < records.length; i++) {
          const a = records[i - 1], b = records[i];
          if (a.distance_m < distance && distance < b.distance_m) {
            times.push(a.elapsed_seconds + (b.elapsed_seconds - a.elapsed_seconds) *
              (distance - a.distance_m) / (b.distance_m - a.distance_m));
          }
        }
        return times;
      };
      const reference = Math.min(...candidates.map(start =>
        Math.min(...timesAt(start + target)) - Math.max(...timesAt(start))));
      expect(findFastestSegment(records, target)).toBe(Math.round(reference));
    }
  });

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
    expect(pb5k?.source).toBe('estimated');

    // Sparse telemetry is still usable; the fast finish beats the whole-run mean.
    const insert = db.prepare('INSERT INTO activity_records (activity_id, elapsed_seconds, distance_m) VALUES (?, ?, ?)');
    insert.run('act-5k-fast', 0, 0);
    insert.run('act-5k-fast', 1000, 4000);
    insert.run('act-5k-fast', 1260, 5000);
    const sparseBest = getAthleteBestEfforts(db).allTime.find(e => e.targetId === '1k');
    expect(sparseBest?.timeSeconds).toBe(250);
    expect(sparseBest?.source).toBe('measured');

    // The database query must preserve null readings so the scan can break the trace.
    insert.run('act-5k-fast', 100, null);
    const brokenTraceBest = getAthleteBestEfforts(db).allTime.find(e => e.targetId === '1k');
    expect(brokenTraceBest?.timeSeconds).toBe(260);

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
