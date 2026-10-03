import { category, finding } from '../domain/coaching/vocabulary.js';
import type { CoachingFactor, CoachCategoryId, CoachFindingId } from '../../shared/coaching.js';
export type { RunFamily } from '../../shared/coaching.js';
import type { RunFamily } from '../../shared/coaching.js';
import { sessionVerdict } from './session-verdict.js';
import type { SessionVerdict } from '../../shared/session-verdict.js';
import { PauseBreakdown } from './economy.js';
import { getLt2TrainingBand } from './zones.js';

/**
 * AEROLAB Physiological Execution Rubric
 *
 * Grades a session against a run-type-specific weighted rubric that always sums
 * to 100 points, instead of a flat baseline score with bonus/penalty deltas.
 *
 * Design rules:
 * - Every factor is graded on a continuous curve, so two different sessions
 *   almost never produce the same number (no cookie-cutter 85-plus-bonus score).
 * - Factors that cannot be measured (no HR, no splits, no pause telemetry) are
 *   omitted from the rubric entirely and reported through `coveragePct`, so a
 *   missing sensor never grants free marks or invents a penalty.
 * - Weights are run-type specific: a cadence point is worth far more in a race
 *   than in a recovery jog.
 */

/** Newly computed factors must carry IDs; public payloads also accept legacy rows. */
export type RubricFactor = CoachingFactor & { categoryId: CoachCategoryId; findingId: CoachFindingId };

export interface RubricInput {
  runType: string;
  isFailedWorkout: boolean;
  /** Steady-state running values where available (traffic/walk breaks removed). */
  steadyHr: number | null;
  /** Session average heart rate, used only as a coarse fallback signal. */
  avgHr?: number | null;
  steadyCadence: number | null;
  steadyStanceTime: number | null;
  decouplingPct: number | null;
  isAccidentalTempo: boolean;
  lt1Hr: number;
  lt2Hr: number;
  maxHeartRate: number;
  restingHr?: number | null;
  activityMaxHr: number | null;
  /** Ambient temperature for the session, so heat load can be priced in. */
  ambientTempC?: number | null;
  /** Session duration, so duration-driven drift can be priced in. */
  durationMin?: number | null;
  pauseBreakdown?: PauseBreakdown | null;
  /** Per-second telemetry, used to judge *why* walk breaks happened. */
  records?: any[] | null;
  intervals?: any[] | null;
  splits?: any[] | null;
}

export interface RubricResult {
  verdict: SessionVerdict;
  family: RunFamily;
  score: number;
  factors: RubricFactor[];
  /** How much of the 100-point rubric could actually be observed (0-100). */
  coveragePct: number;
  focusAdvice: string | null;
  /** Walk-break classification, when per-second telemetry was available. */
  walkAudit: WalkAudit | null;
  /** Condition-adjusted cardiac-drift target used to grade aerobic stability. */
  driftTarget: DriftTarget;
  /** Pacing stability (stop/walk-free, hill-adjusted) when it could be measured. */
  pacing: PacingConsistency | null;
  /** Aerobic intensity distribution (the graded failure mode on easy runs). */
  intensity: IntensityAudit | null;
}

const QUALITY_TYPES = ['threshold_lt2', 'intervals_vo2', 'tempo', 'strides', 'marathon_pace'];

export function runFamilyOf(runType: string): RunFamily {
  if (runType === 'race') return 'race';
  if (QUALITY_TYPES.includes(runType)) return 'quality';
  return 'aerobic';
}

/**
 * Cardiac drift that these *conditions* predict, not a textbook number.
 *
 * 1.5% is only a fair bar for a cool, ~45-60 minute run. Thermoregulatory drift
 * (skin blood flow, plasma-volume shift, dehydration) and sheer duration both
 * add drift that no athlete can pace away: in 31 °C over two hours, 4-5% is
 * normal even for well-trained runners, and sub-1.5% is a best-case outcome.
 * The target therefore widens with ambient temperature and duration, and the
 * rubric grades against that target instead of the cool-weather ideal.
 */
/**
 * How much of a *late-session* ceiling breach is excused.
 *
 * Heat is the only excuse, and only once the session is long enough for
 * thermoregulatory creep to be unavoidable: two hours at 31 °C can push heart
 * rate over the ceiling without any pacing error, whereas the same breach in
 * cool weather — or inside the first hour, in any weather — is a pace, fuelling
 * or fatigue decision that belongs in the score.
 */
export function lateCeilingWeight(ambientTempC?: number | null, durationMin?: number | null): number {
  const heatExcuse = Math.max(0, Math.min(1, driftTargetFor(ambientTempC).heatAllowancePct / HEAT_EXCUSE_FULL_PCT));
  const durationExcuse = Math.max(0, Math.min(1, ((durationMin ?? 45) - 60) / 60));
  return Number((1 - MAX_LATE_EXCUSE * heatExcuse * durationExcuse).toFixed(3));
}

/**
 * The same idea for the softer signal: time creeping into the top of Zone 2 late
 * in a hot run is largely thermoregulatory, so half of it is excused in real heat
 * (and none of it in cool weather, where it is a pacing choice).
 */
export function lateZone2Weight(ambientTempC?: number | null): number {
  const heatExcuse = Math.max(0, Math.min(1, driftTargetFor(ambientTempC).heatAllowancePct / HEAT_EXCUSE_FULL_PCT));
  return Number((1 - MAX_ZONE2_LATE_EXCUSE * heatExcuse).toFixed(3));
}

export interface DriftTarget {
  fullAtPct: number;
  zeroAtPct: number;
  heatAllowancePct: number;
  durationAllowancePct: number;
  /** True when heat or duration moved the target above the 1.5% baseline. */
  conditionsAdjusted: boolean;
}

export function driftTargetFor(ambientTempC?: number | null, durationMin?: number | null): DriftTarget {
  const heat = 0.3 * Math.max(0, Math.min(8, (ambientTempC ?? 20) - 24));
  const duration = 0.012 * Math.max(0, Math.min(90, (durationMin ?? 45) - 60));
  const fullAt = Math.min(4.5, 1.5 + heat + duration);
  return {
    fullAtPct: Number(fullAt.toFixed(2)),
    zeroAtPct: Number((fullAt + 6.5).toFixed(2)),
    heatAllowancePct: Number(heat.toFixed(2)),
    durationAllowancePct: Number(duration.toFixed(2)),
    conditionsAdjusted: heat + duration >= 0.5
  };
}

/** Heat allowance at which a late breach is fully excused (≈31 °C). */
const HEAT_EXCUSE_FULL_PCT = 2.1;
/** A fully-hot, fully-long session still counts a fifth of a late breach. */
const MAX_LATE_EXCUSE = 0.85;
/** In real heat, half of late high-Zone-2 creep is excused. */
const MAX_ZONE2_LATE_EXCUSE = 0.5;


function curve(max: number, value: number | null | undefined, fullAt: number, zeroAt: number): number {
  if (value == null || !Number.isFinite(value)) return 0;
  if (fullAt === zeroAt) return max;
  const t = (value - zeroAt) / (fullAt - zeroAt);
  return max * Math.max(0, Math.min(1, t));
}

/** Band label from the fraction of a factor's weight that was earned. */
function band<T>(ratio: number, elite: T, solid: T, poor: T): T {
  if (ratio >= 0.85) return elite;
  if (ratio >= 0.6) return solid;
  return poor;
}

export function coefficientOfVariation(values: Array<number | null | undefined>): { cv: number; stdDev: number; mean: number } | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (mean <= 0) return null;
  const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length;
  const stdDev = Math.sqrt(variance);
  return { cv: stdDev / mean, stdDev, mean };
}

export function formatPaceText(paceSecKm: number): string {
  const m = Math.floor(paceSecKm / 60);
  const s = Math.round(paceSecKm % 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

export const INTERVAL_TYPE = {
  work: 'work',
  recovery: 'recovery'
} as const;

export const intervalDuration = (rep: any): number => rep?.duration_seconds ?? rep?.durationSeconds ?? 0;
export const intervalHr = (rep: any): number => rep?.avg_heart_rate ?? rep?.avgHeartRate ?? 0;
export const intervalMaxHr = (rep: any): number => rep?.max_heart_rate ?? rep?.maxHeartRate ?? 0;
export const intervalDrop = (rep: any): number => rep?.hr_drop ?? rep?.hrDrop ?? 0;
export const splitPace = (s: any): number => s?.avg_pace_sec_km ?? s?.avgPaceSecKm ?? 0;

/**
 * Race splits restricted to the recorded effort (work interval window when an
 * interval was detected, otherwise all plausible running splits).
 */
export function selectRaceSplits(splits: any[] | null | undefined, intervals: any[] | null | undefined): any[] {
  if (!splits || splits.length < 2) return [];
  const workRep = (intervals || []).find((i: any) => i.type === INTERVAL_TYPE.work);
  let raceSplits: any[] = [];

  if (workRep) {
    const wStart = workRep.startSeconds ?? workRep.start_seconds ?? 0;
    const wDur = workRep.durationSeconds ?? workRep.duration_seconds ?? 0;
    let cumSec = 0;
    raceSplits = splits.filter((s: any) => {
      const splitDur = s.duration_seconds || s.durationSeconds || 0;
      const splitStart = cumSec;
      cumSec += splitDur;
      return splitStart >= wStart - 30 && splitStart < wStart + wDur - 60;
    });
  }

  if (raceSplits.length < 2) {
    raceSplits = splits.filter((s: any) => {
      const p = splitPace(s);
      return p > 120 && p < 720;
    });
  }

  return raceSplits;
}

/**
 * Per-kilometre *running* pace, with stationary stops and walk breaks removed
 * from both the time and the distance of that kilometre.
 *
 * Raw kilometre splits are a city-navigation report, not a pacing report: a
 * single busy crossing adds 2-3 minutes to a kilometre and makes a metronomic
 * run look erratic. Measuring only the running portion isolates the thing the
 * factor is supposed to grade.
 */
export interface PaceSegment {
  km: number;
  /** Running-only pace for this kilometre. */
  paceSecKm: number;
  runDistM: number;
  stopSec: number;
  walkSec: number;
  climbM: number;
}

/** Roughly 12 s/km of legitimate slowdown per 1% uphill grade. */
const GRADE_COST_SEC_KM_PER_PCT = 12;
/** Above this the climb reading is GPS noise, not a hill. */
const MAX_CREDITED_GRADE_PCT = 10;
const MAX_GRADE_ADJUSTMENT_SEC_KM = 60;

/**
 * Credits uphill running with a grade-adjusted pace. The adjustment is capped on
 * both sides: altimeter noise (tens of metres in a kilometre) would otherwise
 * manufacture impossible grades and corrupt the variance.
 */
export function gradeAdjustedPace(paceSecKm: number, climbM: number, distM: number): number {
  if (!climbM || distM <= 0 || climbM < 0) return paceSecKm;
  const gradePct = Math.min(MAX_CREDITED_GRADE_PCT, (climbM / distM) * 100);
  const adjustment = Math.min(MAX_GRADE_ADJUSTMENT_SEC_KM, GRADE_COST_SEC_KM_PER_PCT * gradePct);
  return Math.max(paceSecKm * 0.7, paceSecKm - adjustment);
}

export function steadyPaceSegments(
  records: Array<any> | null | undefined,
  opts: { minRunDistM?: number } = {}
): PaceSegment[] | null {
  if (!records || records.length < 20) return null;
  if (!records.some(r => (r.cadence ?? r.cad ?? 0) > 50)) return null;
  const minRunDistM = opts.minRunDistM ?? 300;

  const acc = new Map<number, { runSec: number; runDist: number; stopSec: number; walkSec: number; climb: number; lastAlt: number | null }>();
  let prev: any = null;

  for (const r of records) {
    if (prev) {
      const dt = Math.max(1, Math.min(15, (r.elapsed_seconds ?? 0) - (prev.elapsed_seconds ?? 0)));
      const dd = (r.distance_m ?? 0) - (prev.distance_m ?? 0);
      const cad = prev.cadence ?? 0;
      const km = Math.max(1, Math.ceil((r.distance_m ?? 0) / 1000));
      const e = acc.get(km) ?? { runSec: 0, runDist: 0, stopSec: 0, walkSec: 0, climb: 0, lastAlt: null };
      if (dd > 0 && dd < 30) {
        if (cad >= WALK_CADENCE_MAX) {
          e.runSec += dt;
          e.runDist += dd;
        } else if (cad >= WALK_CADENCE_MIN) {
          e.walkSec += dt;
        } else {
          e.stopSec += dt;
        }
        // Sum only plausible positive altitude steps, so sensor spikes cannot
        // invent a climb that never happened.
        const alt = r.altitude_m ?? null;
        if (alt != null && e.lastAlt != null) {
          const rise = alt - e.lastAlt;
          if (rise > 0 && rise < 3) e.climb += rise;
        }
        if (alt != null) e.lastAlt = alt;
      }
      acc.set(km, e);
    }
    prev = r;
  }

  const segments: PaceSegment[] = [];
  for (const [km, e] of acc) {
    if (e.runDist < minRunDistM || e.runSec <= 0) continue;
    const pace = (e.runSec / e.runDist) * 1000;
    if (pace < 120 || pace > 720) continue;
    segments.push({
      km,
      paceSecKm: pace,
      runDistM: e.runDist,
      stopSec: e.stopSec,
      walkSec: e.walkSec,
      climbM: e.climb
    });
  }

  segments.sort((a, b) => a.km - b.km);
  return segments.length >= 3 ? segments : null;
}

/** Least-squares trend of pace across segments (positive = slowing down). */
function paceTrend(values: number[]): { detrended: number[]; slopePerKm: number } {
  const n = values.length;
  if (n < 3) return { detrended: [...values], slopePerKm: 0 };
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  return { detrended: values.map((v, i) => v - (meanY + slope * (i - meanX))), slopePerKm: slope };
}

/**
 * Spread of the detrended residuals, expressed against the *mean pace* (the
 * residuals themselves average zero, so a plain CV of them is meaningless).
 */
function residualCv(values: number[], residuals: number[]): { cv: number; stdDev: number } | null {
  if (values.length < 2 || residuals.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!(mean > 0)) return null;
  const stdDev = Math.sqrt(residuals.reduce((a, b) => a + b * b, 0) / residuals.length);
  return { cv: stdDev / mean, stdDev };
}

export interface PacingConsistency {
  /** Variance around the athlete's own pace trend (deliberate progressions are not "erratic"). */
  cvPct: number;
  /** Total variance including any trend, for reporting. */
  rawCvPct: number;
  stdDevSec: number;
  /** Positive = the run slowed down through the session. */
  trendSecPerKm: number;
  sampleCount: number;
  /** Kilometres that contained stops or walk breaks (reported, not counted against you). */
  affectedCount: number;
  /** Uphill kilometres were credited with a grade-adjusted pace. */
  gradeAdjusted: boolean;
  source: 'records' | 'splits';
}

/**
 * Pacing stability across the kilometres actually run. Prefers per-second
 * telemetry (stop/walk-free, gradient-adjusted); falls back to raw splits when
 * there is no telemetry to work from.
 *
 * Graded on the spread *around the athlete's own trend*: a deliberate negative
 * split or a steady progression is good pacing, while up-and-down oscillation
 * is what actually wastes energy.
 */
export function pacingConsistency(
  records: Array<any> | null | undefined,
  splits: any[] | null | undefined,
  runType: string
): PacingConsistency | null {
  const segments = steadyPaceSegments(records);
  if (segments && segments.length >= 3) {
    const values = segments.map(s => gradeAdjustedPace(s.paceSecKm, Math.max(0, s.climbM), s.runDistM));
    const { detrended, slopePerKm } = paceTrend(values);
    const raw = coefficientOfVariation(values);
    const resid = residualCv(values, detrended);
    if (!raw || !resid) return null;
    return {
      cvPct: resid.cv * 100,
      rawCvPct: raw.cv * 100,
      stdDevSec: resid.stdDev,
      trendSecPerKm: Number(slopePerKm.toFixed(1)),
      sampleCount: segments.length,
      affectedCount: segments.filter(s => s.stopSec > 5 || s.walkSec > 10).length,
      gradeAdjusted: segments.some(s => s.climbM >= 5),
      source: 'records'
    };
  }

  const paces = pacingSplitPaces(runType, splits);
  const { detrended, slopePerKm } = paceTrend(paces);
  const raw = coefficientOfVariation(paces);
  const resid = residualCv(paces, detrended);
  if (!raw || !resid) return null;
  return {
    cvPct: resid.cv * 100,
    rawCvPct: raw.cv * 100,
    stdDevSec: resid.stdDev,
    trendSecPerKm: Number(slopePerKm.toFixed(1)),
    sampleCount: paces.length,
    affectedCount: 0,
    gradeAdjusted: false,
    source: 'splits'
  };
}

/** Splits usable when there is no per-second telemetry (drops ramp-walk splits). */
function pacingSplitPaces(runType: string, splits: any[] | null | undefined): number[] {
  const paces = (splits || [])
    .map(splitPace)
    .filter((p: number) => p > 120 && p < 720);
  if (paces.length < 2) return [];

  if (runType === 'long_run') {
    const sorted = [...paces].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return paces.filter(p => p <= median + 90);
  }
  return paces;
}

/**
 * Aerobic intensity audit: how much of the *running* time was spent at or above
 * the LT1 ceiling (Z3 and up in this app's zone model), and how much sat in the
 * top of Zone 2.
 *
 * This is the only failure mode that matters for an easy run: the session exists
 * to build aerobic volume at low strain, so the grade is "did you keep it easy".
 * The first and second halves are separated because time above the ceiling in
 * the opening half is a pacing decision, while late-time creep in 31 °C is
 * thermoregulatory drift that no pacing discipline removes.
 */
export interface IntensityAudit {
  /** Seconds of running (cadence-classified) that carried heart-rate data. */
  sampledSec: number;
  /** Share of running time with HR above the LT1 ceiling (Z3+). */
  aboveCeilingPct: number;
  /** Share of running time in the top 5 bpm of Zone 2. */
  highZ2Pct: number;
  firstHalfAboveCeilingPct: number;
  secondHalfAboveCeilingPct: number;
  highZ2FirstHalfPct: number;
  highZ2SecondHalfPct: number;
  lt1Hr: number;
}

const HIGH_Z2_BAND_BPM = 5;
/** Aerobic-intensity grading weights: Z3+ is the failure, high Z2 is a soft signal. */
const ABOVE_CEILING_MAX = 60;
const HIGH_Z2_MAX = 25;
const HIGH_Z2_PENALTY_START_PCT = 40;

export function intensityAudit(
  records: Array<any> | null | undefined,
  opts: { lt1Hr: number }
): IntensityAudit | null {
  if (!records || records.length < 30) return null;
  const samples: Array<{ t: number; hr: number }> = [];
  const hasCadence = records.some(r => (r.cadence ?? r.cad ?? 0) > 50);

  for (const r of records) {
    const hr = r.heart_rate ?? r.heartRate ?? 0;
    if (!hr || hr <= 40) continue;
    const cad = r.cadence ?? r.cad ?? 0;
    // Running samples only: walking to control heart rate is deliberate, and a
    // stationary pause at 170 bpm is not an execution failure either.
    if (hasCadence && cad < WALK_CADENCE_MAX) continue;
    samples.push({ t: r.elapsed_seconds ?? 0, hr });
  }
  if (samples.length < 30) return null;

  // Smooth heart rate over 60 s before binning: sustained time in a band is what
  // matters, and beat-to-beat jitter around a compliant average (or a 3 s spike
  // over the ceiling) must not create or erase an execution failure.
  const SMOOTHING_WINDOW_SEC = 60;
  const smoothed = samples.map((s, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && samples[i].t - samples[j].t <= SMOOTHING_WINDOW_SEC; j--) {
      sum += samples[j].hr;
      n++;
    }
    for (let j = i + 1; j < samples.length && samples[j].t - samples[i].t <= SMOOTHING_WINDOW_SEC; j++) {
      sum += samples[j].hr;
      n++;
    }
    return { t: s.t, hr: n > 0 ? sum / n : s.hr };
  });

  const lt1 = opts.lt1Hr;
  const half = smoothed[Math.floor(smoothed.length / 2)].t;
  let aboveEarly = 0, aboveLate = 0, highEarly = 0, highLate = 0, earlySec = 0, lateSec = 0;

  for (const s of smoothed) {
    const isEarly = s.t <= half;
    if (isEarly) earlySec++;
    else lateSec++;
    if (s.hr > lt1) {
      if (isEarly) aboveEarly++;
      else aboveLate++;
    } else if (s.hr >= lt1 - HIGH_Z2_BAND_BPM) {
      if (isEarly) highEarly++;
      else highLate++;
    }
  }

  const total = Math.max(1, earlySec + lateSec);
  const pct = (n: number, d: number) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : 0);

  return {
    sampledSec: total,
    aboveCeilingPct: pct(aboveEarly + aboveLate, total),
    highZ2Pct: pct(highEarly + highLate, total),
    firstHalfAboveCeilingPct: pct(aboveEarly, earlySec),
    secondHalfAboveCeilingPct: pct(aboveLate, lateSec),
    highZ2FirstHalfPct: pct(highEarly, earlySec),
    highZ2SecondHalfPct: pct(highLate, lateSec),
    lt1Hr: lt1
  };
}

/**
 * Walking to hold heart rate under the aerobic ceiling, to climb a hill, or to
 * cool down is correct execution — it is the same discipline the aerobic
 * factors reward. Walking because you could not hold the prescribed effort
 * (mid-run, no gradient, heart rate nowhere near the ceiling) is a real signal.
 * A quality rep interrupted at/above LT1 sits in between: the stimulus really
 * was shortened, and the debrief should say so without moralising.
 */
export interface WalkAudit {
  /** Walk blocks that are long enough to mean anything (>= 15 s). */
  blockCount: number;
  /** Every cadence dip seen, including sub-15s turnarounds. */
  rawBlockCount: number;
  walkSec: number;
  movingSec: number;
  /** Warm-up/cool-down, ramp climbs and planned run/walk blocks. */
  deliberateWalkSec: number;
  /** Mid-run walks started inside the upper aerobic band (ceiling protection). */
  preventiveWalkSec: number;
  /** Walks that fell inside a prescribed recovery window between reps. */
  recoveryWalkSec: number;
  recoveryBlockCount: number;
  /** Brief dips at loop turnarounds / stiles (ignored, not walking). */
  artifactWalkSec: number;
  artifactBlockCount: number;
  /** Mid-run walks started at or above LT1 outside any recovery window. */
  correctiveWalkSec: number;
  /** Mid-run walks started at or above LT2 outside any recovery window. */
  hardWalkSec: number;
  /** Mid-run walks started well below the aerobic band with no gradient. */
  capacityWalkSec: number;
  /** Regular run/walk rhythm (Galloway-style session plan). */
  plannedPattern: boolean;
  avgPreventiveEntryHr: number | null;
  avgCorrectiveEntryHr: number | null;
  avgCapacityEntryHr: number | null;
  maxEntryHr: number | null;
  /** Walk time that actually cost the prescribed stimulus (corrective + hard). */
  intrusiveWalkSec: number;
}

const WALK_CADENCE_MIN = 50;
const WALK_CADENCE_MAX = 126; // identical to extractSteadyStateMetrics
const MIN_BLOCK_SEC = 4;
/** Below this a cadence dip is noise (loop turnarounds, stiles, sensor glitch). */
const MIN_RELEVANT_SEC = 15;
const ARTIFACT_MAX_SEC = 20;
const ARTIFACT_MAX_DIST_M = 25;
const WARMUP_FRACTION = 0.12;
const COOLDOWN_FRACTION = 0.88;
const RAMP_CLIMB_M = 5;
const BELOW_BAND_MARGIN_BPM = 25;
/** Detected interval boundaries are approximate, so allow a little slack. */
const RECOVERY_WINDOW_SLACK_SEC = 30;

const meanOf = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const medianOf = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/**
 * Recoveries that genuinely sit between work reps — the only ones that describe a
 * set's recovery structure.
 *
 * Requiring a work rep on *both* sides is what keeps warm-up strides out. On a
 * session with a stride block before the set, the stride jog-recoveries (105-115s)
 * used to qualify because a work rep merely existed somewhere later, dragging the
 * reported set recovery from 2:13 down to 1:54. Warm-up walks and the trailing
 * cool-down are excluded by the duration window and the missing neighbour.
 */
export function betweenRepRecoveries<T extends { type: string }>(intervals: T[] | null | undefined): T[] {
  const rows = intervals || [];
  return rows.filter((i: T, idx: number) => {
    if (i.type !== INTERVAL_TYPE.recovery && i.type !== 'rest') return false;
    const dur = intervalDuration(i);
    if (dur < 20 || dur > 600) return false;
    const workBefore = rows.slice(0, idx).some((earlier: T) => earlier.type === INTERVAL_TYPE.work);
    const workAfter = rows.slice(idx + 1).some((later: T) => later.type === INTERVAL_TYPE.work);
    return workBefore && workAfter;
  });
}

/**
 * Shape of an interval set. Grading has to adapt to it: a 12 x 1 min set and a
 * 3 x 15 min set are different instruments, and a universal "no drift beyond 3%"
 * rule would punish the first for HR lag and the second for ordinary cardiac
 * drift.
 */
export interface SetShape {
  repCount: number;
  /** Median work-rep duration in seconds. */
  medianRepSec: number;
  totalWorkSec: number;
  /** Median recovery duration between work reps, when detected. */
  recoverySec: number | null;
  /** True when reps are too short for average HR to reach the target. */
  shortReps: boolean;
}

export function describeSet(intervals: any[] | null | undefined): SetShape | null {
  const rows = intervals || [];
  const workReps = rows.filter((i: any) => i.type === INTERVAL_TYPE.work);
  if (workReps.length === 0) return null;

  const durations = workReps.map(intervalDuration).filter((d: number) => d > 0);
  const medianRepSec = durations.length > 0 ? Math.round(medianOf(durations) as number) : 0;

  const recoveries = betweenRepRecoveries(rows).map(intervalDuration);

  return {
    repCount: workReps.length,
    medianRepSec,
    totalWorkSec: Math.round(durations.reduce((a: number, b: number) => a + b, 0)),
    recoverySec: recoveries.length > 0 ? Math.round(medianOf(recoveries) as number) : null,
    shortReps: medianRepSec > 0 && medianRepSec < 120
  };
}
const cvOf = (values: number[]) => {
  if (values.length < 2) return 1;
  const m = meanOf(values);
  return m > 0 ? Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length) / m : 1;
};

/**
 * Share of moving time in walk breaks, used only when per-second records are
 * unavailable (the walk audit is preferred because it knows *why* you walked).
 * Stationary traffic stops are excluded: they are already isolated from every
 * physiological metric and are not a coaching failure.
 */
export function walkSharePct(pb?: PauseBreakdown | null): number | null {
  if (!pb) return null;
  const moving = (pb.steadyRunningDurationSeconds || 0) + (pb.walkDurationSeconds || 0) + (pb.stopDurationSeconds || 0);
  if (moving <= 0) return null;
  return (pb.walkDurationSeconds / moving) * 100;
}

/**
 * Walks the raw per-second records and classifies every sustained walk block.
 * Returns null when there is no usable cadence telemetry to judge from.
 */
export function auditWalkBreaks(
  records: Array<any> | null | undefined,
  opts: {
    lt1Hr: number;
    lt2Hr: number;
    /** Prescribed recovery windows (e.g. detected interval recoveries). */
    recoveryWindows?: Array<{ from: number; to: number }> | null;
    allowBriefAerobicBreaks?: boolean;
    /** Known work reps: elevated HR outside these windows is not a work interruption. */
    workWindows?: Array<{ from: number; to: number }>;
  }
): WalkAudit | null {
  if (!records || records.length < 10) return null;
  if (!records.some(r => (r.cadence ?? r.cad ?? 0) > 50)) return null;

  const firstSec = records[0].elapsed_seconds ?? 0;
  const lastSec = records[records.length - 1].elapsed_seconds ?? firstSec;
  const spanSec = Math.max(1, lastSec - firstSec);
  const windows = opts.recoveryWindows ?? [];

  type Block = {
    startSec: number;
    walkSec: number;
    hrBefore: number | null;
    climbM: number;
    coveredM: number;
    startFrac: number;
  };
  const blocks: Block[] = [];
  let cur: { startSec: number; walkSec: number; hrBefore: number | null; altStart: number | null; altEnd: number | null; distStart: number | null; distEnd: number | null } | null = null;
  let runSec = 0;
  let stopSec = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const prev = records[i - 1] ?? r;
    const rSec = r.elapsed_seconds ?? i;
    const prevSec = prev.elapsed_seconds ?? Math.max(0, rSec - 1);
    const dt = Math.min(15, Math.max(1, rSec - prevSec));
    const cad = r.cadence ?? r.cad ?? 0;
    const isWalk = cad >= WALK_CADENCE_MIN && cad < WALK_CADENCE_MAX;
    const isStop = !cad || cad < WALK_CADENCE_MIN;

    if (isWalk) {
      if (!cur) {
        cur = {
          startSec: rSec,
          walkSec: 0,
          hrBefore: prev.heart_rate ?? null,
          altStart: r.altitude_m ?? null,
          altEnd: null,
          distStart: prev.distance_m ?? null,
          distEnd: null
        };
      }
      cur.walkSec += dt;
      cur.altEnd = r.altitude_m ?? cur.altEnd;
      cur.distEnd = r.distance_m ?? cur.distEnd;
    } else if (cur) {
      if (cur.walkSec >= MIN_BLOCK_SEC) blocks.push(toWalkBlock(cur, firstSec, spanSec));
      cur = null;
    }

    if (isStop) stopSec += dt;
    else if (!isWalk) runSec += dt;
  }
  if (cur && cur.walkSec >= MIN_BLOCK_SEC) blocks.push(toWalkBlock(cur, firstSec, spanSec));

  const walkSec = blocks.reduce((a, b) => a + b.walkSec, 0);
  const movingSec = Math.round(runSec + walkSec + stopSec);
  if (movingSec <= 0) return null;

  const preventiveHrs: number[] = [];
  const correctiveHrs: number[] = [];
  const capacityHrs: number[] = [];
  let deliberateWalkSec = 0;
  let preventiveWalkSec = 0;
  let recoveryWalkSec = 0;
  let recoveryBlockCount = 0;
  let artifactWalkSec = 0;
  let artifactBlockCount = 0;
  let correctiveWalkSec = 0;
  let hardWalkSec = 0;
  let capacityWalkSec = 0;
  let maxEntryHr: number | null = null;
  let blockCount = 0;

  for (const b of blocks) {
    const hr = b.hrBefore;
    if (hr != null) maxEntryHr = maxEntryHr == null ? hr : Math.max(maxEntryHr, hr);

    // A turn at the end of a loop: brief and barely any ground covered. Checked
    // before the length filter so these are reported as turnarounds rather than
    // silently dropped as noise.
    if (b.walkSec <= ARTIFACT_MAX_SEC && b.coveredM <= ARTIFACT_MAX_DIST_M) {
      artifactWalkSec += b.walkSec;
      artifactBlockCount++;
      continue;
    }
    // Sub-15s dips that did cover ground are still too short to coach on.
    if (b.walkSec < MIN_RELEVANT_SEC) continue;
    // Prescribed recovery between reps: the session design, not a shortfall.
    if (windows.some(w => b.startSec >= w.from - RECOVERY_WINDOW_SLACK_SEC && b.startSec <= w.to + RECOVERY_WINDOW_SLACK_SEC)) {
      recoveryWalkSec += b.walkSec;
      recoveryBlockCount++;
      blockCount++;
      continue;
    }
    blockCount++;

    if (opts.workWindows?.length && !opts.workWindows.some(w => b.startSec >= w.from && b.startSec < w.to)) {
      // Warm-up/cool-down and gaps between reps can still have elevated HR.
      // HR alone must never place a walk inside a work rep.
      deliberateWalkSec += b.walkSec;
      continue;
    }

    // Brief easy-run breaks can be proactive HR control or route stops.
    // Low entry HR cannot establish fatigue or unplanned walking.
    if (opts.allowBriefAerobicBreaks && b.walkSec <= 60 && (hr == null || hr < opts.lt1Hr)) {
      deliberateWalkSec += b.walkSec;
      continue;
    }
    if (hr != null && hr >= opts.lt2Hr) {
      hardWalkSec += b.walkSec;
      correctiveHrs.push(hr);
      continue;
    }
    if (hr != null && hr >= opts.lt1Hr - 3) {
      correctiveWalkSec += b.walkSec;
      correctiveHrs.push(hr);
      continue;
    }
    if (b.climbM >= RAMP_CLIMB_M) {
      deliberateWalkSec += b.walkSec;
      continue;
    }
    if (b.startFrac < WARMUP_FRACTION || b.startFrac > COOLDOWN_FRACTION) {
      deliberateWalkSec += b.walkSec;
      continue;
    }
    if (hr == null || hr > opts.lt1Hr - BELOW_BAND_MARGIN_BPM) {
      // Mid-run, no gradient, still inside the aerobic band: deliberate ceiling control.
      preventiveWalkSec += b.walkSec;
      if (hr != null) preventiveHrs.push(hr);
      continue;
    }
    capacityWalkSec += b.walkSec;
    if (hr != null) capacityHrs.push(hr);
  }

  // A regular run/walk rhythm (consistent block lengths and gaps) is a session plan.
  const regular = blocks.filter(b => b.walkSec >= MIN_RELEVANT_SEC && !(b.walkSec <= ARTIFACT_MAX_SEC && b.coveredM <= ARTIFACT_MAX_DIST_M));
  let plannedPattern = false;
  if (regular.length >= 4) {
    const gaps = regular.slice(1).map((b, i) => b.startSec - (regular[i].startSec + regular[i].walkSec));
    plannedPattern = cvOf(regular.map(b => b.walkSec)) < 0.45 && cvOf(gaps) < 0.3;
  }

  if (plannedPattern) {
    deliberateWalkSec += capacityWalkSec;
    capacityWalkSec = 0;
    capacityHrs.length = 0;
  }

  return {
    blockCount,
    rawBlockCount: blocks.length,
    walkSec: Math.round(walkSec),
    movingSec,
    deliberateWalkSec: Math.round(deliberateWalkSec),
    preventiveWalkSec: Math.round(preventiveWalkSec),
    recoveryWalkSec: Math.round(recoveryWalkSec),
    recoveryBlockCount,
    artifactWalkSec: Math.round(artifactWalkSec),
    artifactBlockCount,
    correctiveWalkSec: Math.round(correctiveWalkSec),
    hardWalkSec: Math.round(hardWalkSec),
    capacityWalkSec: Math.round(capacityWalkSec),
    plannedPattern,
    avgPreventiveEntryHr: preventiveHrs.length ? Math.round(meanOf(preventiveHrs)) : null,
    avgCorrectiveEntryHr: correctiveHrs.length ? Math.round(meanOf(correctiveHrs)) : null,
    avgCapacityEntryHr: capacityHrs.length ? Math.round(meanOf(capacityHrs)) : null,
    maxEntryHr,
    intrusiveWalkSec: Math.round(correctiveWalkSec + hardWalkSec)
  };
}

function toWalkBlock(
  cur: { startSec: number; walkSec: number; hrBefore: number | null; altStart: number | null; altEnd: number | null; distStart: number | null; distEnd: number | null },
  firstSec: number,
  spanSec: number
) {
  const covered = cur.distStart != null && cur.distEnd != null ? Math.max(0, cur.distEnd - cur.distStart) : 0;
  return {
    startSec: cur.startSec,
    walkSec: cur.walkSec,
    hrBefore: cur.hrBefore,
    climbM: Math.max(0, (cur.altEnd ?? 0) - (cur.altStart ?? 0)),
    coveredM: covered,
    startFrac: (cur.startSec - firstSec) / spanSec
  };
}


function cadencePoints(max: number, cadence: number | null): number {
  if (!cadence) return 0;
  if (cadence >= 186) return max * 0.9; // slightly over-cadenced: efficient but not optimal
  if (cadence >= 174) return max;
  if (cadence >= 166) return max * (0.6 + (0.4 * (cadence - 166)) / 8);
  if (cadence >= 158) return max * ((0.6 * (cadence - 158)) / 8);
  return 0;
}

function stancePoints(max: number, stanceMs: number | null): number {
  if (!stanceMs) return 0;
  return curve(max, stanceMs, 235, 300);
}

function turnoverFactor(input: RubricInput, max: number): RubricFactor | null {
  const cadence = input.steadyCadence;
  const stance = input.steadyStanceTime;
  if (!cadence && !stance) return null;
  const cadenceMax = Math.round(max * 0.7);
  const stanceMax = max - cadenceMax;
  const earned = cadencePoints(cadenceMax, cadence) + (stance ? stancePoints(stanceMax, stance) : 0);
  const ratio = earned / max;
  const parts: string[] = [];
  if (cadence) parts.push(`${cadence} spm steady cadence`);
  if (stance) parts.push(`${Math.round(stance)} ms ground contact`);
  return {
    ...(category('running_turnover')),
    points: Math.round(earned),
    maxPoints: max,
    ...(band(ratio, finding('optimal_cadence_sweet_spot'), finding('adequate_turnover'), finding('sub_optimal_cadence_turnover'))),
    description: parts.join(' · ')
  };
}

/**
 * Set-level fatigue: the last work rep against the first, in pace and heart rate.
 * Recovery length is the athlete's plan (short recoveries deliberately hold HR
 * near threshold), so the raw drop between reps is never graded — decay is.
 */
function setFatigueDetail(input: RubricInput) {
  const workReps = (input.intervals || []).filter((i: any) => i.type === INTERVAL_TYPE.work);
  const shape = describeSet(input.intervals);
  const paces = workReps
    .map((r: any) => {
      const pace = r.avg_pace_sec_km ?? r.avgPaceSecKm ?? (r.avg_speed_mps ? 1000 / r.avg_speed_mps : null);
      return typeof pace === 'number' && pace > 60 ? pace : null;
    })
    .filter((p: number | null): p is number => p != null);
  const hrs = workReps.map(intervalHr).filter((h: number) => h > 0);

  const paceFadeSec = paces.length >= 3 ? paces[paces.length - 1] - paces[0] : null;
  const paceFadePct = paceFadeSec != null && paces[0] > 0 ? (paceFadeSec / paces[0]) * 100 : null;
  const hrClimbBpm = hrs.length >= 3 ? hrs[hrs.length - 1] - hrs[0] : null;
  const hrClimbPct = hrClimbBpm != null && hrs[0] > 0 ? (hrClimbBpm / hrs[0]) * 100 : null;

  // Ordinary cardiac drift accumulates with time under load (roughly 0.06 points
  // of drift per minute of work), so tolerance scales with the set's work time
  // instead of a universal 3%.
  const tolerancePct = Number((3 + 0.06 * Math.min(60, (shape?.totalWorkSec ?? 0) / 60)).toFixed(2));
  const zeroPct = Number((tolerancePct + 12).toFixed(2));
  // Short reps carry heart-rate lag: average HR keeps rising across the set even
  // when nothing is decaying, so pace is the only usable fatigue signal there.
  // Long reps also drift legitimately, which the work-time tolerance above covers.
  const gradeHr = !(shape?.shortReps ?? false);
  const fatiguePct = Math.max(paceFadePct ?? -Infinity, gradeHr ? (hrClimbPct ?? -Infinity) : -Infinity);

  return { workReps: workReps.length, paceFadeSec, paceFadePct, hrClimbBpm, hrClimbPct, fatiguePct, tolerancePct, zeroPct, gradeHr };
}

function intensityControlPoints(
  max: number,
  workHr: number | null,
  lt2: number,
  maxHeartRate: number,
  isVo2: boolean
): number {
  if (!workHr) return 0;
  if (isVo2) {
    // VO2 reps belong above LT2 and close to HRmax; only stop short of failure.
    const lower = lt2 + 3;
    const upper = maxHeartRate * 0.95;
    if (workHr >= lower && workHr <= upper) return max;
    if (workHr < lower) {
      return max * (0.4 + 0.6 * Math.max(0, (workHr - (lt2 - 12)) / 15));
    }
    return max * (0.5 + 0.5 * Math.max(0, (maxHeartRate + 4 - workHr) / (maxHeartRate + 4 - upper)));
  }
  // Threshold / tempo work is anchored on LT2: grey zone below, overshoot above.
  if (workHr >= lt2 - 8 && workHr <= lt2 + 6) return max;
  if (workHr < lt2 - 8) {
    return max * (0.45 + 0.55 * Math.max(0, (workHr - (lt2 - 22)) / 14));
  }
  return max * (0.15 + 0.85 * Math.max(0, (lt2 + 18 - workHr) / 12));
}

// ---------------------------------------------------------------------------
// Aerobic family: easy base, long run, recovery, drifted/accidental tempo
//
// One failure mode only: going too hard. The session exists to build aerobic
// volume at low strain, so the grade is intensity control. Cardiac drift, city
// pacing variance, walk breaks and turnover are reported as observations, not
// charged as execution failures.
// ---------------------------------------------------------------------------
function gradeAerobic(input: RubricInput, walkAudit: WalkAudit | null, intensity: IntensityAudit | null): RubricFactor[] {
  const factors: RubricFactor[] = [];

  // Only a long session in real heat excuses late-session ceiling creep; heat
  // alone softens late Zone 2 creep.
  const lateWeight = lateCeilingWeight(input.ambientTempC, input.durationMin);
  const lateZone2 = lateZone2Weight(input.ambientTempC);

  // 1. Aerobic intensity discipline — 85 pts
  // Two signals with different severity: time above the ceiling (a real failure)
  // and sustained time in the top of Zone 2 (a soft one — still aerobic, but no
  // longer an easy day in the recovery sense).
  const gradeIntensity = (audit: IntensityAudit): { points: number; label: string; findingId: CoachFindingId; description: string } => {
    const effectiveAbove = audit.firstHalfAboveCeilingPct + lateWeight * audit.secondHalfAboveCeilingPct;
    const effectiveHighZ2 = (audit.highZ2FirstHalfPct + lateZone2 * audit.highZ2SecondHalfPct) / 2;
    const abovePoints = curve(ABOVE_CEILING_MAX, effectiveAbove, 5, 40);
    const zone2Points = curve(HIGH_Z2_MAX, effectiveHighZ2, HIGH_Z2_PENALTY_START_PCT, 100);
    const pts = abovePoints + zone2Points;

    const aboveLost = ABOVE_CEILING_MAX - abovePoints;
    const zone2Lost = HIGH_Z2_MAX - zone2Points;

    // Lead the description with whichever signal actually cost the points, so a
    // ceiling-compliant run is never described as a ceiling problem.
    const zone2Text = `${audit.highZ2Pct.toFixed(1)}% in the top of Zone 2 (${audit.lt1Hr - HIGH_Z2_BAND_BPM}-${audit.lt1Hr} bpm)`;
    const aboveText = `${audit.aboveCeilingPct.toFixed(1)}% above the ${audit.lt1Hr} bpm LT1 ceiling`;
    const description = aboveLost > 0 && aboveLost >= zone2Lost
      ? `${aboveText} (first half: ${audit.firstHalfAboveCeilingPct.toFixed(1)}%) · ${zone2Text}`
      : `${zone2Text} · ${aboveText} · rising to ${audit.highZ2SecondHalfPct.toFixed(0)}% in the second half`;

    // The label names the signal that actually failed, not a blended ratio.
    const label = aboveLost >= 12 ? finding('extended_above_the_lt1_ceiling') : audit.highZ2Pct < 40 ? finding('clearly_easy') : audit.highZ2Pct < 60 ? finding('normal_easy') : audit.highZ2Pct <= 75 ? finding('upper_easy_aerobic_steady') : finding('potentially_too_close_to_lt1');

    return {
      points: Math.round(pts),
      ...label,
      description
    };
  };

  if (intensity) {
    const graded = gradeIntensity(intensity);
    factors.push({
      ...(category('aerobic_intensity')),
      points: graded.points,
      maxPoints: 85,
      label: graded.label, findingId: graded.findingId,
      description: graded.description
    });
  } else if (input.steadyHr || input.avgHr) {
    // Coarse fallback when there is no per-second telemetry: an average heart
    // rate cannot show how *long* the ceiling was exceeded, only that it was.
    const hr = input.steadyHr || input.avgHr;
    const pts = curve(85, hr, input.lt1Hr - 8, input.lt1Hr + 12);
    factors.push({
      ...(category('aerobic_intensity')),
      points: Math.round(pts),
      maxPoints: 85,
      ...(band(pts / 85, finding('disciplined_aerobic_ceiling'), finding('normal_easy'), finding('extended_above_the_lt1_ceiling'))),
      description: `${hr} bpm average against a ${input.lt1Hr} bpm LT1 ceiling (average only — no per-second telemetry)`
    });
  }

  // 2. Session integrity — 15 pts. A categorical gate, not a quality judgement:
  // only an aborted session or a session that was mostly walking (and not a
  // planned run/walk rhythm) loses points here.
  const share = walkSharePct(input.pauseBreakdown);
  if (input.isFailedWorkout || walkAudit || share != null) {
    const max = 15;
    const walkPct = walkAudit
      ? (walkAudit.walkSec / walkAudit.movingSec) * 100
      : (share ?? 0);
    let pts: number;
    if (input.isFailedWorkout) {
      pts = 0;
    } else if (walkAudit?.plannedPattern) {
      pts = max; // a structured run/walk session plan is a plan
    } else {
      pts = curve(max, walkPct, 45, 90);
    }

    const label = input.isFailedWorkout ? finding('aborted_incomplete_quality_workout') : pts === max ? finding('unbroken_session') : band(pts / max, finding('substantially_walked_session'), finding('walk_dominated_session'), finding('walk_dominated_session'));

    const description = input.isFailedWorkout
      ? 'Target volume was cut short before the planned stimulus was delivered'
      : `${walkPct.toFixed(1)}% of moving time in walk breaks (up to 45% is free on easy sessions)`;

    factors.push({ ...(category('workout_completion')), points: Math.round(pts), maxPoints: max, ...label, description });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Quality family: threshold, VO2 max, tempo, strides
// ---------------------------------------------------------------------------
function thresholdZoneShare(input: RubricInput): { pct: number; seconds: number; lower: number; upper: number } | null {
  const workWindows = (input.intervals || [])
    .filter((rep: any) => rep.type === INTERVAL_TYPE.work)
    .map((rep: any) => ({ from: rep.start_seconds ?? rep.startSeconds, to: (rep.start_seconds ?? rep.startSeconds) + intervalDuration(rep) }))
    .filter((window: { from: number; to: number }) => Number.isFinite(window.from) && window.to > window.from);
  if (workWindows.length === 0 || !input.records || input.records.length < 10) return null;
  const [lower, upper] = getLt2TrainingBand(input.lt2Hr);
  let observed = 0;
  let inZone = 0;
  const records = input.records;
  for (let index = 0; index < records.length - 1; index++) {
    const record = records[index];
    const time = record.elapsed_seconds ?? record.elapsedSeconds;
    const nextTime = records[index + 1].elapsed_seconds ?? records[index + 1].elapsedSeconds;
    const hr = record.heart_rate ?? record.heartRate;
    if (!Number.isFinite(time) || !Number.isFinite(nextTime) || !Number.isFinite(hr) || hr <= 40) continue;
    for (const window of workWindows) {
      const seconds = Math.max(0, Math.min(nextTime, window.to, time + 15) - Math.max(time, window.from));
      observed += seconds;
      if (hr >= lower && hr <= upper) inZone += seconds;
    }
  }
  if (observed < 60) return null;
  return { pct: (inZone / observed) * 100, seconds: Math.round(inZone), lower, upper };
}

function gradeQuality(input: RubricInput, walkAudit: WalkAudit | null): RubricFactor[] {
  const factors: RubricFactor[] = [];
  const isThreshold = input.runType === 'threshold_lt2';
  const workReps = (input.intervals || []).filter((i: any) => i.type === INTERVAL_TYPE.work);

  if (isThreshold) {
    const zone = thresholdZoneShare(input);
    if (zone) {
      const max = 50;
      const pts = curve(max, zone.pct, 70, 10);
      factors.push({
        ...(category('threshold_zone_time')), points: Math.round(pts), maxPoints: max,
        ...(band(pts / max, finding('sustained_threshold_heart_rate'), finding('partial_threshold_exposure'), finding('little_threshold_exposure'))),
        description: `${Math.floor(zone.seconds / 60)}m ${String(zone.seconds % 60).padStart(2, '0')}s within the LT2 band (${zone.lower}-${zone.upper} bpm), ${zone.pct.toFixed(1)}% of observed work-rep time`
      });
    }
  }

  // 1. Interval structure consistency — 22 pts
  const durations = workReps.map(intervalDuration).filter((d: number) => d > 0);
  const durationStats = coefficientOfVariation(durations);
  // Stride-length reps are too short for duration consistency to mean anything.
  const repsLongEnough = (describeSet(input.intervals)?.medianRepSec ?? 0) >= 20;
  if (durationStats && repsLongEnough) {
    const max = isThreshold ? 10 : 22;
    const cvPct = durationStats.cv * 100;
    const pts = curve(max, cvPct, 6, 25);
    factors.push({
      ...(category('interval_execution')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('laser_rep_consistency'), finding('disciplined_interval_structure'), finding('high_rep_variance_across_set'))),
      description: `${cvPct.toFixed(1)}% duration variance across ${workReps.length} reps (±${Math.round(durationStats.stdDev)}s spread)`
    });
  }

  // 2. Cardiovascular stimulus (peak work HR as a share of HRmax) — 20 pts
  const peakHr = Math.max(0, ...workReps.map(intervalMaxHr), input.activityMaxHr || 0);
  if (!isThreshold && peakHr > 0 && input.maxHeartRate > 0) {
    const max = 20;
    const pctMax = (peakHr / input.maxHeartRate) * 100;
    const pts = curve(max, pctMax, 90, 75);
    factors.push({
      ...(category('cardiovascular_stimulus')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('target_vo2_stimulus_achieved'), finding('partial_cardiovascular_stimulus'), finding('insufficient_cardiovascular_stimulus'))),
      description: `Peaked at ${peakHr} bpm (${Math.round(pctMax)}% HRmax)`
    });
  }

  // 3. Intensity control (work HR held at the session's anchor) — 20 pts
  const shape = describeSet(input.intervals);
  const workHrsAll = workReps.map(intervalHr).filter((h: number) => h > 0);
  const peakWorkHr = Math.max(0, ...workReps.map(intervalMaxHr));
  // The *anchor* comes from the session's intent, never from whatever heart rate
  // showed up: a threshold session that drifts upward is over-intensity for its
  // purpose, not a VO2 session that should be congratulated. Only the measurement
  // method adapts to rep length, because heart rate lags inside short reps.
  const vo2Target = input.runType === 'intervals_vo2';
  const usePeak = !!shape?.shortReps;
  const avgWorkHr = workHrsAll.length > 0
    ? Math.round(workHrsAll.reduce((a: number, b: number) => a + b, 0) / workHrsAll.length)
    : 0;
  const anchorHr = usePeak && peakWorkHr > 0 ? peakWorkHr : avgWorkHr;
  if (anchorHr > 0) {
    const max = isThreshold ? 15 : 20;
    const pts = intensityControlPoints(max, anchorHr, input.lt2Hr, input.maxHeartRate, vo2Target);
    const overshootBpm = anchorHr - input.lt2Hr;
    const driftedIntoVo2 = !vo2Target && overshootBpm >= 12;
    factors.push({
      ...(isThreshold ? category('threshold_heart_rate') : category('pacing_discipline')),
      points: Math.round(pts),
      maxPoints: max,
      ...(driftedIntoVo2 ? finding('drifted_into_vo2_territory') : band(pts / max, finding('on_target_intensity_control'), finding('grey_zone_intensity_drift'), finding('overreaching_intensity'))),
      description: usePeak
        ? `${anchorHr} bpm peak work HR (${shape?.medianRepSec}s reps are too short to average to target) against a ${input.lt2Hr} bpm LT2 anchor`
        : `${anchorHr} bpm average work HR against a ${input.lt2Hr} bpm LT2 anchor`
    });
  }

  // 3. Form & efficiency: turnover and ground contact hold up under fatigue — 16 pts
  const turnover = turnoverFactor(input, isThreshold ? 5 : 16);
  if (turnover) factors.push(turnover);

  // 4. Set fatigue: did the last work rep match the first? Tolerances scale with
  // the set's work time, and short reps are judged on pace only (HR lag makes
  // their average rise regardless of execution).
  const fatigue = setFatigueDetail(input);
  if (fatigue.paceFadePct != null || (fatigue.gradeHr && fatigue.hrClimbPct != null)) {
    const max = isThreshold ? 10 : 12;
    const pts = curve(max, fatigue.fatiguePct, fatigue.tolerancePct, fatigue.zeroPct);

    const detail: string[] = [];
    if (fatigue.paceFadeSec != null) {
      const deltaSec = Math.round(fatigue.paceFadeSec);
      detail.push(deltaSec >= 0
        ? `last rep ${deltaSec}s/km slower than the first`
        : `last rep ${Math.abs(deltaSec)}s/km faster than the first`);
    }
    if (fatigue.hrClimbBpm != null) {
      const deltaHr = Math.round(fatigue.hrClimbBpm);
      const note = fatigue.gradeHr ? '' : ' (not graded: short reps carry HR lag)';
      detail.push(deltaHr >= 0
        ? `work HR ${deltaHr} bpm higher by the last rep${note}`
        : `work HR ${Math.abs(deltaHr)} bpm lower by the last rep${note}`);
    }

    factors.push({
      ...(category('rep_to_rep_fatigue')),
      points: Math.round(pts),
      maxPoints: max,
      ...(fatigue.fatiguePct <= fatigue.tolerancePct ? finding('held_rep_pace_and_hr_to_the_end') : band(pts / max, finding('held_rep_pace_and_hr_to_the_end'), finding('slight_late_rep_fade'), finding('late_rep_collapse'))),
      description: `${detail.join(' · ')} (across ${fatigue.workReps} reps, ${Math.round(fatigue.tolerancePct)}% drift allowed for the set length)`
    });
  }

  // 5. Session integrity — 10 pts
  // Only walking that interrupted a work rep costs anything: recovery walking
  // between reps and gradient/warm-up walking are legitimate.
  const share = walkSharePct(input.pauseBreakdown);
  if (input.isFailedWorkout || walkAudit || share != null) {
    const max = 10;
    const intrusiveSec = walkAudit ? walkAudit.intrusiveWalkSec : null;
    const intrusiveShare = walkAudit ? (intrusiveSec! / walkAudit.movingSec) * 100 : (share ?? 0);
    // A partly interrupted rep set is never scored as a total write-off.
    let pts = input.isFailedWorkout ? 0 : Math.max(curve(max, intrusiveShare, 0, 15), max * 0.35);
    // A quality session with fewer than two work reps never delivered its structure.
    if (!input.isFailedWorkout && workReps.length < 2) pts = Math.min(pts, max * 0.6);

    const label = input.isFailedWorkout ? finding('aborted_incomplete_quality_workout') : walkAudit && walkAudit.intrusiveWalkSec > 0 ? finding('rep_interrupting_walk_breaks') : band(pts / max, finding('unbroken_session'), finding('minor_break_time'), finding('heavily_interrupted_session'));

    const description = input.isFailedWorkout
      ? 'Target volume was cut short before the planned stimulus was delivered'
      : walkAudit
        ? `${workReps.length} work reps · ${walkAudit.intrusiveWalkSec}s of walking inside work reps (average entry ${walkAudit.avgCorrectiveEntryHr ?? '—'} bpm)`
        : `${workReps.length} work reps · ${(share ?? 0).toFixed(1)}% of moving time in walk breaks`;

    factors.push({ ...(category('workout_completion')), points: Math.round(pts), maxPoints: max, ...label, description });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Race family: time trials and competitive efforts
// ---------------------------------------------------------------------------
function gradeRace(input: RubricInput, walkAudit: WalkAudit | null): RubricFactor[] {
  const factors: RubricFactor[] = [];
  const raceSplits = selectRaceSplits(input.splits, input.intervals);
  const paces = raceSplits.map(splitPace).filter((p: number) => p > 120 && p < 720);
  const paceStats = coefficientOfVariation(paces);
  const firstPace = paces[0] ?? null;
  const secondPace = paces[1] ?? null;
  const surgeSec = firstPace != null && secondPace != null ? secondPace - firstPace : 0;
  const isEarlySurge = surgeSec >= 12;

  // 1. Pacing discipline — 34 pts (heaviest weight: races are won or lost here)
  if (paceStats && paces.length >= 2) {
    const max = 34;
    let pts: number;
    if (isEarlySurge) {
      pts = Math.max(0, max - Math.min(22, surgeSec * 1.2));
    } else if (paceStats.cv <= 0.03) {
      pts = max;
    } else {
      pts = max * Math.max(0.35, 1 - (paceStats.cv - 0.03) / 0.07);
    }
    factors.push({
      ...(category('race_pacing_execution')),
      points: Math.round(pts),
      maxPoints: max,
      ...(isEarlySurge ? finding('aggressive_early_surge_positive_split') : band(pts / max, finding('laser_race_pacing_discipline'), finding('controlled_race_pacing'), finding('volatile_split_pacing'))),
      description: isEarlySurge
        ? `Km 1 opened at ${formatPaceText(firstPace!)} then faded ${Math.round(surgeSec)}s/km to ${formatPaceText(secondPace!)}`
        : `${(paceStats.cv * 100).toFixed(1)}% split variance (±${Math.round(paceStats.stdDev)}s spread)`
    });
  }

  // 2. Finish strength (second half against first half) — 18 pts
  if (paces.length >= 2) {
    const half = Math.floor(paces.length / 2);
    const firstHalf = paces.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const secondHalf = paces.slice(paces.length - half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const fadeSec = secondHalf - firstHalf;
    const max = 18;
    const pts = curve(max, fadeSec, -8, 25);
    factors.push({
      ...(category('race_finish_execution')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('strong_negative_split_finish'), finding('held_form_to_the_line'), finding('late_race_fade'))),
      description: fadeSec >= 0
        ? `${Math.round(fadeSec)}s/km slower in the second half`
        : `${Math.abs(Math.round(fadeSec))}s/km faster in the second half`
    });
  }

  // 3. Cardiovascular utilisation (how much of HRmax the race demanded) — 18 pts
  const peakHr = Math.max(0, input.activityMaxHr || 0);
  if (peakHr > 0 && input.maxHeartRate > 0) {
    const max = 18;
    const pctMax = (peakHr / input.maxHeartRate) * 100;
    const pts = curve(max, pctMax, 92, 78);
    factors.push({
      ...(category('cardiovascular_stimulus')),
      points: Math.round(pts),
      maxPoints: max,
      ...(band(pts / max, finding('full_race_day_heart_rate_utilisation'), finding('partial_race_day_effort'), finding('conservative_heart_rate_ceiling'))),
      description: `Peaked at ${peakHr} bpm (${Math.round(pctMax)}% HRmax)`
    });
  }

  // 4. Running turnover — 14 pts
  const turnover = turnoverFactor(input, 14);
  if (turnover) factors.push(turnover);

  // 5. Session integrity — 16 pts
  // In a race, any walk that was not forced by a gradient or the start is a fade signal.
  const share = walkSharePct(input.pauseBreakdown);
  if (input.isFailedWorkout || walkAudit || share != null) {
    const max = 16;
    let pts: number;
    if (input.isFailedWorkout) {
      pts = 0;
    } else if (walkAudit) {
      const fadeSec = walkAudit.intrusiveWalkSec + walkAudit.capacityWalkSec;
      pts = curve(max, (fadeSec / walkAudit.movingSec) * 100, 0, 6);
    } else {
      pts = curve(max, share!, 0, 6);
    }

    const label = input.isFailedWorkout ? finding('aborted_incomplete_quality_workout') : walkAudit && walkAudit.intrusiveWalkSec + walkAudit.capacityWalkSec > 0 ? finding('walk_breaks_inside_the_race_effort') : band(pts / max, finding('unbroken_session'), finding('minor_break_time'), finding('heavily_interrupted_session'));

    const description = input.isFailedWorkout
      ? 'Target volume was cut short before the planned stimulus was delivered'
      : walkAudit
        ? `${walkAudit.blockCount} walk breaks · ${(share != null ? share : 0).toFixed(1)}% of moving time (gradient, start and cool-down walks are free)`
        : `${(share ?? 0).toFixed(1)}% of moving time in walk breaks (races rarely need them)`;

    factors.push({ ...(category('workout_completion')), points: Math.round(pts), maxPoints: max, ...label, description });
  }

  return factors;
}

// ---------------------------------------------------------------------------
// Biggest lever: the factor that lost the most points
// ---------------------------------------------------------------------------
function pickFocus(factors: RubricFactor[]): RubricFactor | null {
  let worst: RubricFactor | null = null;
  let worstLoss = 0;
  for (const f of factors) {
    const loss = f.maxPoints - f.points;
    if (loss > worstLoss) {
      worstLoss = loss;
      worst = f;
    }
  }
  if (!worst || (worstLoss < 5 && worstLoss / worst.maxPoints < 0.15)) return null;
  worst.isFocus = true;
  return worst;
}

function buildFocusAdvice(factor: RubricFactor, input: RubricInput, walkAudit: WalkAudit | null): string {
  const lost = factor.maxPoints - factor.points;
  const prefix = `Biggest Lever — ${factor.category}: `;
  const tail = ` (${lost} of ${factor.maxPoints} points lost)`;
  const workReps = (input.intervals || []).filter((i: any) => i.type === INTERVAL_TYPE.work);

  switch (factor.categoryId) {
    case 'threshold_zone_time': {
      const zone = thresholdZoneShare(input);
      return `${prefix}${zone ? `${zone.pct.toFixed(1)}% of observed work-rep time was within the LT2 band (${zone.lower}-${zone.upper} bpm)` : 'threshold-zone time could not be measured'}${tail}. Let heart rate settle near the LT2 anchor during work reps; use pace only to help hold that effort.`;
    }
    case 'threshold_heart_rate':
      return `${prefix}work-rep heart rate missed the ${input.lt2Hr} bpm LT2 anchor${tail}. Adjust effort to keep the work near threshold rather than chasing a pace target.`;
    case 'aerobic_decoupling': {
      const target = driftTargetFor(input.ambientTempC, input.durationMin);
      const targetNote = target.conditionsAdjusted
        ? ` The target for these conditions is ${target.fullAtPct}% (heat and duration both add drift you cannot pace away), so this is about pacing and fuelling rather than fitness.`
        : '';
      return `${prefix}${(input.decouplingPct ?? 0).toFixed(1)}% cardiac drift was the largest single cost${tail}.${targetNote} Start the opening 2 km 10-15 sec/km slower and add easy volume at or below ${input.lt1Hr - 12} bpm — capillary density, not speed, is the limiter.`;
    }
    case 'pacing_discipline':
      return runFamilyOf(input.runType) === 'quality'
        ? `${prefix}work intervals averaged ${Math.round(workReps.reduce((a: number, r: any) => a + intervalHr(r), 0) / Math.max(1, workReps.filter((r: any) => intervalHr(r) > 0).length))} bpm against a ${input.lt2Hr} bpm LT2 anchor${tail}. Set the watch to alert above ${input.lt2Hr} bpm and hold rep 1 back so rep 3 lands on target.`
        : `${prefix}steady HR reached ${input.steadyHr} bpm against a ${input.lt1Hr} bpm LT1 cap${tail}. Slow the opening 15-20 sec/km and cap the watch at ${input.lt1Hr - 8} bpm so easy days stay easy.`;
    case 'aerobic_intensity': {
      const audit = intensityAudit(input.records, { lt1Hr: input.lt1Hr });
      const above = audit?.aboveCeilingPct ?? 0;
      const zone2 = audit?.highZ2Pct ?? 0;
      const bandLow = input.lt1Hr - HIGH_Z2_BAND_BPM;
      const targetHigh = input.lt1Hr - 10;
      // Advise on whichever signal actually cost the points.
      if (zone2 >= 40 && above < 5) {
        const interpretation = zone2 < 60
          ? 'normal easy'
          : zone2 <= 75
            ? 'upper-easy / aerobic steady'
            : 'potentially too close to LT1 for a routine easy day';
        const guidance = zone2 < 60
          ? 'Keep the opening relaxed and let heart rate rise naturally.'
          : `For a routine easy day, ease the opening kilometres and aim nearer ${targetHigh} bpm.`;
        return `${prefix}you never crossed the ${input.lt1Hr} bpm LT1 ceiling, and ${zone2.toFixed(1)}% of your running time sat in the top of Zone 2 (${bandLow}-${input.lt1Hr} bpm)${tail}. That is ${interpretation}. ${guidance}`;
      }
      return `${prefix}${above.toFixed(1)}% of your running time sat above the ${input.lt1Hr} bpm LT1 ceiling (${(audit?.firstHalfAboveCeilingPct ?? 0).toFixed(1)}% of it in the first half)${tail}. Set a watch alert at ${bandLow} bpm and walk any climb that pushes you over it — for an easy day, keeping the ceiling is the whole session.`;
    }
    case 'running_turnover':
      return `${prefix}${input.steadyCadence} spm cost the most execution points${tail}. Two weekly sets of 4 x 20s strides at 180+ spm raise turnover without adding aerobic load.`;
    case 'pacing_consistency': {
      const pacing = pacingConsistency(input.records, input.splits, input.runType);
      const detail = pacing && pacing.source === 'records'
        ? ` Your running pace held within ±${Math.round(pacing.stdDevSec)}s per kilometre across ${pacing.sampleCount} running km.`
        : '';
      const trendNote = pacing && pacing.trendSecPerKm >= 6
        ? ` The steady ${pacing.trendSecPerKm.toFixed(1)}s/km slowdown through the run points at an opening that was too quick or under-fuelling.`
        : '';
      return `${prefix}running pace varied more than it needed to${tail}.${detail}${trendNote} Lock a pace band before the start and check it every kilometre instead of chasing feel.`;
    }
    case 'workout_completion': {
      if (input.isFailedWorkout) {
        return `${prefix}the session was aborted before the planned stimulus landed${tail}. Re-check sleep, fuel and the previous 48 hours of load before retrying the same session.`;
      }
      if (walkAudit && walkAudit.capacityWalkSec > 0) {
        return `${prefix}${Math.round(walkAudit.capacityWalkSec)}s of mid-run walking started while heart rate was already below your aerobic band${tail}. Worth checking fuelling, sleep and load, or whether the route forces stops.`;
      }
      if (walkAudit && walkAudit.intrusiveWalkSec > 0) {
        return `${prefix}${Math.round(walkAudit.intrusiveWalkSec)}s of walking started inside work reps at an average of ${walkAudit.avgCorrectiveEntryHr ?? '—'} bpm${tail}. Walking was the right call at that heart rate — the fix is upstream: run the first rep 5-8 sec/km easier or pick a route where reps are not interrupted.`;
      }
      const share = walkSharePct(input.pauseBreakdown);
      return `${prefix}${(share ?? 0).toFixed(1)}% of moving time was spent in walk breaks${tail}. Pick a loop with fewer crossings, or place walk breaks at fixed points so the aerobic block stays continuous.`;
    }
    case 'interval_execution':
      return `${prefix}rep durations varied by ${((coefficientOfVariation(workReps.map(intervalDuration))?.cv ?? 0) * 100).toFixed(1)}%${tail}. Fix the rep duration rather than the pace — even reps deliver the intended stimulus.`;
    case 'cardiovascular_stimulus': {
      const peakHr = Math.max(0, ...workReps.map(intervalMaxHr), input.activityMaxHr || 0);
      const pct = Math.round((peakHr / (input.maxHeartRate || 1)) * 100);
      return runFamilyOf(input.runType) === 'race'
        ? `${prefix}the race peaked at ${pct}% of HRmax${tail}. Practise 2 x 8 min at LT2 so race pace feels controlled rather than unknown.`
        : `${prefix}peak work HR only reached ${pct}% of HRmax${tail}. Close the final rep at 90%+ HRmax to load stroke volume instead of stopping at threshold.`;
    }
    case 'autonomic_recovery':
      return `${prefix}heart rate fell slowly between reps${tail}. Lengthen recoveries to 90-120s of easy jogging so every rep starts fresh below LT2.`;
    case 'race_pacing_execution':
      return `${prefix}opening pace discipline was the biggest cost${tail}. Run the first 2 km about 10 sec/km easier than goal pace — a fast opening kilometre spikes lactate early and forces the fade.`;
    case 'race_finish_execution':
      return `${prefix}the second half slowed noticeably${tail}. Add one long run a week with the final 20 minutes at goal race pace to rehearse late-race form.`;
    case 'rep_to_rep_fatigue': {
      const fatigue = setFatigueDetail(input);
      const parts: string[] = [];
      if (fatigue.paceFadeSec != null && Math.abs(fatigue.paceFadeSec) >= 3) {
        parts.push(`the last rep ran ${Math.abs(Math.round(fatigue.paceFadeSec))}s/km ${fatigue.paceFadeSec > 0 ? 'slower' : 'faster'}`);
      }
      if (fatigue.hrClimbBpm != null && Math.abs(fatigue.hrClimbBpm) >= 3) {
        parts.push(`work HR finished ${Math.abs(Math.round(fatigue.hrClimbBpm))} bpm ${fatigue.hrClimbBpm > 0 ? 'higher' : 'lower'} than the first rep`);
      }
      const finding = parts.length > 0 ? ` — ${parts.join(' and ')}` : '';
      const cause = (fatigue.hrClimbBpm ?? 0) > 0
        ? 'A drifting work HR at held or slower pace points at fuelling, heat and recovery between sets rather than at fitness.'
        : 'That pattern points at early-rep overreach or under-fuelling rather than at fitness.';
      return `${prefix}the set decayed as it went${finding}${tail}. ${cause} Start the first rep 5-8 sec/km easier so the final rep lands on target.`;
    }
    default:
      return `${prefix}this factor cost the most points${tail}.`;
  }
}

export function gradeRun(input: RubricInput): RubricResult {
  const family = runFamilyOf(input.runType);
  // Detected recovery intervals are the session's prescribed breaks, so walking
  // inside them is design rather than a shortfall. Only real breaks count: a
  // "recovery" row that spans 20 minutes is a segment label, not a prescription,
  // and aerobic runs have no prescribed breaks at all.
  const recoveryWindows = family === 'aerobic'
    ? []
    : (input.intervals || [])
        .filter((i: any) => i.type === 'recovery' || i.type === 'rest')
        .map((i: any) => {
          const from = i.start_seconds ?? i.startSeconds ?? 0;
          return { from, to: from + (i.duration_seconds ?? i.durationSeconds ?? 0) };
        })
        .filter((w: { from: number; to: number }) => {
          const len = w.to - w.from;
          return len >= 20 && len <= 600;
        });
  const workWindows = family !== 'aerobic'
    ? (input.intervals || []).filter((i: any) => i.type === 'work').map((i: any) => {
        const from = i.start_seconds ?? i.startSeconds;
        const duration = i.duration_seconds ?? i.durationSeconds;
        return { from, to: from + duration };
      }).filter((w: { from: number; to: number }) => Number.isFinite(w.from) && w.to > w.from)
    : undefined;
  const walkAudit = auditWalkBreaks(input.records, { lt1Hr: input.lt1Hr, lt2Hr: input.lt2Hr, recoveryWindows, workWindows, allowBriefAerobicBreaks: family === 'aerobic' });
  const driftTarget = driftTargetFor(input.ambientTempC, input.durationMin);
  const pacing = pacingConsistency(input.records, input.splits, input.runType);
  const intensity = intensityAudit(input.records, { lt1Hr: input.lt1Hr });
  const factors = family === 'race'
    ? gradeRace(input, walkAudit)
    : family === 'quality'
      ? gradeQuality(input, walkAudit)
      : gradeAerobic(input, walkAudit, intensity);

  const gradedMax = factors.reduce((a, f) => a + f.maxPoints, 0);
  const earned = factors.reduce((a, f) => a + f.points, 0);
  const coveragePct = Math.min(100, Math.round(gradedMax));

  let score: number;
  if (gradedMax <= 0) {
    // Nothing measurable: report a neutral mid-point rather than a fake perfect score.
    score = 70;
  } else {
    const observed = (100 * earned) / gradedMax;
    // A partly-observed rubric can never certify an elite execution.
    score = gradedMax >= 50 ? observed : Math.min(observed, 85);
  }

  if (input.isAccidentalTempo) score = Math.min(score, 69);
  if (input.isFailedWorkout) score = Math.min(score, 60);

  // A threshold session cannot earn Gold without observed time in the target
  // heart-rate zone, regardless of how even its pace or rep structure looked.
  const thresholdZone = input.runType === 'threshold_lt2' ? thresholdZoneShare(input) : null;
  if (input.runType === 'threshold_lt2' && (!thresholdZone || thresholdZone.pct < 60)) {
    score = Math.min(score, 84);
  }

  const focus = pickFocus(factors);
  return {
    family,
    verdict: input.runType === 'threshold_lt2' && !thresholdZone
      ? 'insufficient_evidence'
      : sessionVerdict({ family, factors, hasIntensityTelemetry: intensity != null, isFailedWorkout: input.isFailedWorkout, isAccidentalTempo: input.isAccidentalTempo, runType: input.runType }),
    score: Math.max(40, Math.min(98, Math.round(score))),
    factors,
    coveragePct,
    focusAdvice: focus ? buildFocusAdvice(focus, input, walkAudit) : null,
    walkAudit,
    driftTarget,
    pacing,
    intensity
  };
}
