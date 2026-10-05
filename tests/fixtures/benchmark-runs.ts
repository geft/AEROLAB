/**
 * Deterministic benchmark runs with known classifications.
 *
 * These replace the old sample-run.csv fixture. Each benchmark is generated at
 * 1Hz with valid timestamps and documents its expected run_type, so the suite
 * acts as a living classification benchmark (including slow-athlete paces —
 * several workouts run at ~7:30/km with zero absolute pace thresholds).
 *
 * Expectations use an explicitly seeded TEST athlete profile
 * (max 203, resting 55, LT1 148, LT2 167).
 */

export interface BenchRow {
  /** seconds since start */
  t: number;
  hr: number;
  cad: number;
  spd: number;
}

export interface BenchmarkRun {
  id: string;
  name: string;
  /** local date string, e.g. '2026-09-10 07:00:00' */
  date: string;
  rows: BenchRow[];
  expectedRunType: string;
  expectedTags: string[];
  description: string;
}

const LAT = 1.345413;
const LON = 103.853817;

/** Deterministic ±1 wobble so traces look real while staying reproducible. */
function wobble(t: number, base: number): number {
  return base + Math.round(Math.sin(t / 97) * 1);
}

function steady(out: BenchRow[], fromT: number, seconds: number, hr: number, cad: number, spd: number): number {
  for (let i = 0; i < seconds; i++) {
    const t = fromT + i;
    out.push({ t, hr: wobble(t, hr), cad, spd });
  }
  return fromT + seconds;
}

function ramp(out: BenchRow[], fromT: number, seconds: number, hrFrom: number, hrTo: number, cad: number, spd: number): number {
  for (let i = 0; i < seconds; i++) {
    const t = fromT + i;
    out.push({ t, hr: Math.round(hrFrom + ((hrTo - hrFrom) * i) / Math.max(1, seconds - 1)), cad, spd });
  }
  return fromT + seconds;
}

function hold(out: BenchRow[], fromT: number, seconds: number, hr: number, cad: number, spd: number): number {
  for (let i = 0; i < seconds; i++) {
    const t = fromT + i;
    out.push({ t, hr: wobble(t, hr), cad, spd });
  }
  return fromT + seconds;
}

function build(rows: BenchRow[], id: string, name: string, date: string, expectedRunType: string, expectedTags: string[], description: string): BenchmarkRun {
  return { id, name, date, rows, expectedRunType, expectedTags, description };
}

/** 60 min steady aerobic @ HR 138 — easy_base.
 * HR sits deliberately between the recovery ceiling (LT1-12 = 136) and the
 * LT1 auto-calibration floor (142), so the benchmark is classification-stable
 * and never mutates the athlete profile on import. */
function easy60(): BenchmarkRun {
  const rows: BenchRow[] = [];
  steady(rows, 0, 3600, 138, 178, 3.3);
  return build(rows, 'bench-easy-60', 'Benchmark Easy Aerobic', '2026-09-10 07:00:00',
    'easy_base', ['Easy Base'], '60min steady Z2, must stay easy_base with no intervals tab');
}

/** 25 min jog @ HR 125 — recovery. */
function recovery25(): BenchmarkRun {
  const rows: BenchRow[] = [];
  steady(rows, 0, 1500, 125, 162, 2.9);
  return build(rows, 'bench-recovery-25', 'Benchmark Recovery Jog', '2026-09-11 07:00:00',
    'recovery', ['Recovery'], '25min low-strain jog, must stay recovery');
}

/** 3x10min threshold @ slow pace (~7:30/km) with 2min jog recoveries. */
function threshold3x10(): BenchmarkRun {
  const rows: BenchRow[] = [];
  let t = 0;
  t = ramp(rows, t, 300, 135, 142, 155, 2.1); // warmup
  for (let rep = 0; rep < 3; rep++) {
    t = ramp(rows, t, 90, 145, 170, 162, 2.2); // onset ramp
    t = hold(rows, t, 510, 170, 162, 2.2); // plateau
    if (rep < 2) t = ramp(rows, t, 120, 170, 145, 120, 1.7); // jog recovery
  }
  t = ramp(rows, t, 180, 145, 135, 145, 2.0); // cooldown
  return build(rows, 'bench-threshold-3x10', 'Benchmark Threshold 3x10', '2026-09-12 18:00:00',
    'threshold_lt2', ['Threshold'], '3x10:00/2:00 at slow pace, must detect 3 work reps');
}

/** 5x3min VO2 with 2min recoveries. */
function vo2max5x3(): BenchmarkRun {
  const rows: BenchRow[] = [];
  let t = 0;
  t = ramp(rows, t, 300, 135, 142, 155, 2.1); // warmup
  for (let rep = 0; rep < 5; rep++) {
    t = ramp(rows, t, 60, 145, 190, 184, 3.9); // onset ramp
    t = hold(rows, t, 120, 190, 184, 3.9); // plateau
    if (rep < 4) t = ramp(rows, t, 120, 190, 148, 125, 1.8); // recovery
  }
  t = ramp(rows, t, 180, 148, 135, 145, 2.0); // cooldown
  return build(rows, 'bench-vo2-5x3', 'Benchmark VO2 5x3', '2026-09-13 18:00:00',
    'intervals_vo2', ['VO2 Max'], '5x3:00/2:00, must detect 5 work reps with dynamics');
}

/** 120 min steady @ HR 140 — long_run (>= 100 min). */
function longRun120(): BenchmarkRun {
  const rows: BenchRow[] = [];
  steady(rows, 0, 7200, 140, 170, 3.2);
  return build(rows, 'bench-long-120', 'Benchmark Long Run', '2026-09-14 06:30:00',
    'long_run', ['Long Run'], '120min endurance, duration-driven long_run');
}

/** 20 min continuous near-maximal effort — race from recorded intensity. */
function race5k(): BenchmarkRun {
  const rows: BenchRow[] = [];
  let t = 0;
  t = ramp(rows, t, 120, 140, 193, 180, 4.2);
  t = hold(rows, t, 960, 193, 180, 4.2);
  ramp(rows, t, 120, 193, 150, 160, 2.5);
  return build(rows, 'bench-race-5k', 'Benchmark Continuous Effort', '2026-09-15 07:00:00',
    'race', ['Race'], 'All-out benchmark identified by sustained cardiovascular intensity');
}

/** ~59 min easy with 4x20s strides — easy_base + Strides tag, strides tab visible. */
function easyStrides(): BenchmarkRun {
  const rows: BenchRow[] = [];
  let t = 0;
  t = steady(rows, t, 2400, 140, 170, 3.2);
  for (let s = 0; s < 4; s++) {
    t = ramp(rows, t, 20, 140, 150, 196, 5.0); // short burst, HR still catching up
    t = ramp(rows, t, 20, 150, 164, 105, 1.2); // HR peaks after slowing to a walk
    t = ramp(rows, t, 40, 164, 140, 105, 1.2);
    t = steady(rows, t, 120, 140, 170, 3.2);
  }
  t = steady(rows, t, 340, 138, 168, 3.1);
  return build(rows, 'bench-easy-strides', 'Benchmark Easy Plus Strides', '2026-09-16 07:00:00',
    'easy_base', ['Easy Base', 'Strides'], 'easy with 4 detected strides, no work reps');
}

export const BENCHMARKS: BenchmarkRun[] = [
  easy60(),
  recovery25(),
  threshold3x10(),
  vo2max5x3(),
  longRun120(),
  race5k(),
  easyStrides()
];

export function getBenchmark(id: string): BenchmarkRun {
  const b = BENCHMARKS.find(x => x.id === id);
  if (!b) throw new Error(`Unknown benchmark: ${id}`);
  return b;
}

/** Render a benchmark as importable Garmin-style CSV with valid timestamps. */
export function toCsv(bench: BenchmarkRun): string {
  const baseMs = Date.parse(bench.date.replace(' ', 'T'));
  const fmtTs = (t: number): string => {
    const d = new Date(baseMs + t * 1000);
    const p = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  let dist = 0;
  let hrSum = 0;
  let maxHr = 0;
  let cadSum = 0;
  let maxCad = 0;
  const dists: number[] = [];
  for (const r of bench.rows) {
    dist += r.spd;
    dists.push(dist);
    hrSum += r.hr;
    if (r.hr > maxHr) maxHr = r.hr;
    cadSum += r.cad;
    if (r.cad > maxCad) maxCad = r.cad;
  }
  const n = bench.rows.length;
  const totalDist = dist;
  const totalDur = n > 0 ? bench.rows[n - 1].t - bench.rows[0].t : 0;
  const avgHr = Math.round(hrSum / n);
  const avgCad = Math.round(cadSum / n);

  const lines: string[] = [];
  lines.push('# Benchmark Run Export — deterministic classification fixture');
  lines.push(`# Activity: ${bench.name}`);
  lines.push(`# Activity ID: ${bench.id}`);
  lines.push(`# Date: ${bench.date}`);
  lines.push('# Sport: running');
  lines.push(`# Total Distance (m): ${totalDist.toFixed(1)}`);
  lines.push(`# Total Duration (s): ${totalDur}`);
  lines.push(`# Total Elapsed Time (s): ${totalDur}`);
  lines.push(`# Avg Heart Rate (bpm): ${avgHr}`);
  lines.push(`# Max Heart Rate (bpm): ${maxHr}`);
  lines.push(`# Avg Cadence (spm): ${avgCad}`);
  lines.push(`# Max Cadence (spm): ${maxCad}`);
  lines.push(`# Calories: ${Math.round(totalDur / 60 * 11)}`);
  lines.push('# Total Ascent (m): 0');
  lines.push('# Total Descent (m): 0');
  lines.push('#');
  lines.push('timestamp,heart_rate,cadence,speed,distance,altitude,latitude,longitude,temperature,vertical_oscillation,stance_time');
  bench.rows.forEach((r, i) => {
    lines.push([
      fmtTs(r.t), r.hr, r.cad, r.spd.toFixed(2), dists[i].toFixed(1),
      20, LAT, LON, 29, 70, 230
    ].join(','));
  });
  return lines.join('\n');
}

/** Test-only athlete; application databases deliberately start without measurements. */
export function seedBenchmarkProfile(db: import('better-sqlite3').Database, options: { datedThresholds?: boolean } = {}): void {
  db.prepare("UPDATE athlete_profile SET age = 37, dob = '1989-04-15', max_hr = 203, resting_hr = 55, lt1_hr = 148, lt2_hr = 167, is_max_hr_estimated = 1 WHERE id = 'primary'").run();
  // The benchmark athlete's higher maximum is backed by a prior recorded race.
  db.prepare(`INSERT OR REPLACE INTO activities(id,name,start_time,run_type,max_heart_rate,avg_heart_rate,duration_seconds,distance_meters)
    VALUES('benchmark-max-hr-evidence','Prior maximum HR race','2025-01-01 07:00:00','race',203,180,1200,5000)`).run();
  if (options.datedThresholds) {
    // These fixtures specify measured initial thresholds. Give those inputs a
    // date/provenance rather than pretending today's cache is historical evidence.
    const notes = 'Synthetic external HR baseline (test only)';
    db.prepare("DELETE FROM physiological_thresholds WHERE source_kind = 'external' AND notes = ?").run(notes);
    db.prepare(`INSERT INTO physiological_thresholds(effective_date,source_kind,lt1_hr,lt2_hr,confidence,notes)
      VALUES('2026-09-01 00:00:00','external',148,167,1,?)`).run(notes);
  }
}
