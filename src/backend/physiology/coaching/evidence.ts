import { coachingRecord, coachingInterval, coachingSplit, type CoachingRecord, type CoachingRecordInput, type CoachingIntervalInput, type CoachingSplitInput } from '../../domain/coaching/telemetry.js';
import { sameTimerSegment, MAX_OBSERVED_GAP_SECONDS } from '../time-series.js';
import { coachMessage, coachDescription, coachJoin } from '../../domain/coaching/messages.js';
import type { CoachMessage } from '../../../shared/coaching.js';
import { category, finding } from '../../domain/coaching/vocabulary.js';
import type { CoachingFactor, CoachCategoryId, CoachFindingId } from '../../../shared/coaching.js';
export type { RunFamily } from '../../../shared/coaching.js';
import type { RunFamily } from '../../../shared/coaching.js';
import type { SessionVerdict } from '../../../shared/session-verdict.js';
import { PauseBreakdown } from '../economy.js';

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
  records?: CoachingRecordInput[] | null;
  intervals?: CoachingIntervalInput[] | null;
  splits?: CoachingSplitInput[] | null;
}

export interface RubricResult {
  /** Easy-session intensity drift, verified against running HR when available. */
  isAccidentalTempo: boolean;
  verdict: SessionVerdict;
  family: RunFamily;
  score: number;
  factors: RubricFactor[];
  /** How much of the 100-point rubric could actually be observed (0-100). */
  coveragePct: number;
  focusAdvice: string | null;
  focusAdviceMessage: CoachMessage | null;
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


export function curve(max: number, value: number | null | undefined, fullAt: number, zeroAt: number): number {
  if (value == null || !Number.isFinite(value)) return 0;
  if (fullAt === zeroAt) return max;
  const t = (value - zeroAt) / (fullAt - zeroAt);
  return max * Math.max(0, Math.min(1, t));
}

/** Band label from the fraction of a factor's weight that was earned. */
export function band<T>(ratio: number, elite: T, solid: T, poor: T): T {
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

export const intervalDuration = (rep: CoachingIntervalInput): number => coachingInterval(rep).durationSeconds;
export const intervalHr = (rep: CoachingIntervalInput): number => coachingInterval(rep).avgHeartRate;
export const intervalMaxHr = (rep: CoachingIntervalInput): number => coachingInterval(rep).maxHeartRate;
export const intervalDrop = (rep: CoachingIntervalInput): number => coachingInterval(rep).hrDrop;
export const splitPace = (s: CoachingSplitInput): number => coachingSplit(s).avgPaceSecKm ?? 0;

/**
 * Race splits restricted to the recorded effort (work interval window when an
 * interval was detected, otherwise all plausible running splits).
 */
export function selectRaceSplits(splitInput: CoachingSplitInput[] | null | undefined, intervalInput: CoachingIntervalInput[] | null | undefined): CoachingSplitInput[] {
  const splits = splitInput;
  const intervals = intervalInput?.map(coachingInterval);
  if (!splits || splits.length < 2) return [];
  const workRep = (intervals || []).find((i) => i.type === INTERVAL_TYPE.work);
  let raceSplits: CoachingSplitInput[] = [];

  if (workRep) {
    const wStart = workRep.startSeconds;
    const wDur = workRep.durationSeconds;
    let cumSec = 0;
    raceSplits = splits.filter((s) => {
      const splitDur = coachingSplit(s).durationSeconds;
      const splitStart = cumSec;
      cumSec += splitDur;
      return splitStart >= wStart - 30 && splitStart < wStart + wDur - 60;
    });
  }

  if (raceSplits.length < 2) {
    raceSplits = splits.filter((s) => {
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
  recordInput: CoachingRecordInput[] | null | undefined,
  opts: { minRunDistM?: number } = {}
): PaceSegment[] | null {
  const records = recordInput?.map(coachingRecord);
  if (!records || records.length < 20) return null;
  if (!records.some(r => (r.cadence ?? 0) > 50)) return null;
  const minRunDistM = opts.minRunDistM ?? 300;

  const acc = new Map<number, { runSec: number; runDist: number; stopSec: number; walkSec: number; climb: number; lastAlt: number | null }>();
  let prev: CoachingRecord | null = null;

  for (const r of records) {
    if (prev) {
      const dt = r.elapsedSeconds - prev.elapsedSeconds;
      if (!sameTimerSegment(prev, r) || dt <= 0 || dt > MAX_OBSERVED_GAP_SECONDS) {
        prev = r;
        continue;
      }
      const dd = (r.distanceMeters ?? 0) - (prev.distanceMeters ?? 0);
      const cad = prev.cadence ?? 0;
      const km = Math.max(1, Math.ceil((r.distanceMeters ?? 0) / 1000));
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
        const alt = r.altitudeMeters ?? null;
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
  recordInput: CoachingRecordInput[] | null | undefined,
  splits: CoachingSplitInput[] | null | undefined,
  runType: string
): PacingConsistency | null {
  const records = recordInput?.map(coachingRecord);
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
export function pacingSplitPaces(runType: string, splits: CoachingSplitInput[] | null | undefined): number[] {
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

export const HIGH_Z2_BAND_BPM = 5;
/** Aerobic-intensity grading weights: Z3+ is the failure, high Z2 is a soft signal. */

export function intensityAudit(
  recordInput: CoachingRecordInput[] | null | undefined,
  opts: { lt1Hr: number }
): IntensityAudit | null {
  const records = recordInput?.map(coachingRecord);
  if (!records || records.length < 30) return null;
  const samples: Array<{ t: number; hr: number; segment: number }> = [];
  let segment = 0;
  let previous: CoachingRecord | undefined;
  const hasCadence = records.some(r => (r.cadence ?? 0) > 50);

  for (const r of records) {
    if (previous && (!sameTimerSegment(previous, r) || r.elapsedSeconds - previous.elapsedSeconds > MAX_OBSERVED_GAP_SECONDS || r.elapsedSeconds <= previous.elapsedSeconds)) segment++;
    previous = r;
    if (r.timerActive === false) continue;
    const hr = r.heartRate ?? 0;
    if (!hr || hr <= 40) continue;
    const cad = r.cadence ?? 0;
    // Running samples only: walking to control heart rate is deliberate, and a
    // stationary pause at 170 bpm is not an execution failure either.
    if (hasCadence && cad < WALK_CADENCE_MAX) continue;
    samples.push({ t: r.elapsedSeconds, hr, segment });
  }
  if (samples.length < 30) return null;

  // Smooth heart rate over 60 s before binning: sustained time in a band is what
  // matters, and beat-to-beat jitter around a compliant average (or a 3 s spike
  // over the ceiling) must not create or erase an execution failure.
  const SMOOTHING_WINDOW_SEC = 60;
  const smoothed = samples.map((s, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && samples[j].segment === s.segment && samples[i].t - samples[j].t <= SMOOTHING_WINDOW_SEC; j--) {
      sum += samples[j].hr;
      n++;
    }
    for (let j = i + 1; j < samples.length && samples[j].segment === s.segment && samples[j].t - samples[i].t <= SMOOTHING_WINDOW_SEC; j++) {
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
export function betweenRepRecoveries<T extends CoachingIntervalInput>(intervals: T[] | null | undefined): T[] {
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

export function describeSet(intervals: CoachingIntervalInput[] | null | undefined): SetShape | null {
  const rows = (intervals || []).map(coachingInterval);
  const workReps = rows.filter((i) => i.type === INTERVAL_TYPE.work);
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
  const moving = pb.steadyRunningDurationSeconds + pb.walkDurationSeconds;
  if (moving <= 0) return null;
  return (pb.walkDurationSeconds / moving) * 100;
}

/**
 * Walks the raw per-second records and classifies every sustained walk block.
 * Returns null when there is no usable cadence telemetry to judge from.
 */
export function auditWalkBreaks(
  recordInput: CoachingRecordInput[] | null | undefined,
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
  const records = recordInput?.map(coachingRecord);
  if (!records || records.length < 10) return null;
  if (!records.some(r => (r.cadence ?? 0) > 50)) return null;

  const firstSec = records[0].elapsedSeconds ?? 0;
  const lastSec = records[records.length - 1].elapsedSeconds ?? firstSec;
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

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const prev = records[i - 1] ?? r;
    const rSec = r.elapsedSeconds ?? i;
    const prevSec = prev.elapsedSeconds ?? Math.max(0, rSec - 1);
    const dt = i === 0 ? 1 : rSec - prevSec;
    if (!sameTimerSegment(prev, r) || dt <= 0 || dt > MAX_OBSERVED_GAP_SECONDS) {
      if (cur && cur.walkSec >= MIN_BLOCK_SEC) blocks.push(toWalkBlock(cur, firstSec, spanSec));
      cur = null;
      continue;
    }
    const cad = r.cadence ?? 0;
    const isWalk = cad >= WALK_CADENCE_MIN && cad < WALK_CADENCE_MAX;
    const isStop = !cad || cad < WALK_CADENCE_MIN;

    if (isWalk) {
      if (!cur) {
        cur = {
          startSec: rSec,
          walkSec: 0,
          hrBefore: prev.heartRate ?? null,
          altStart: r.altitudeMeters ?? null,
          altEnd: null,
          distStart: prev.distanceMeters ?? null,
          distEnd: null
        };
      }
      cur.walkSec += dt;
      cur.altEnd = r.altitudeMeters ?? cur.altEnd;
      cur.distEnd = r.distanceMeters ?? cur.distEnd;
    } else if (cur) {
      if (cur.walkSec >= MIN_BLOCK_SEC) blocks.push(toWalkBlock(cur, firstSec, spanSec));
      cur = null;
    }

    if (!isStop && !isWalk) runSec += dt;
  }
  if (cur && cur.walkSec >= MIN_BLOCK_SEC) blocks.push(toWalkBlock(cur, firstSec, spanSec));

  const walkSec = blocks.reduce((a, b) => a + b.walkSec, 0);
  const movingSec = Math.round(runSec + walkSec);
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

export function turnoverFactor(input: RubricInput, max: number): RubricFactor | null {
  const cadence = input.steadyCadence;
  const stance = input.steadyStanceTime;
  if (!cadence && !stance) return null;
  const cadenceMax = Math.round(max * 0.7);
  const stanceMax = max - cadenceMax;
  const earned = cadencePoints(cadenceMax, cadence) + (stance ? stancePoints(stanceMax, stance) : 0);
  const ratio = earned / max;
  const parts: CoachMessage[] = [];
  if (cadence) parts.push(coachMessage("fragment.spm_steady_cadence", { p0: cadence }));
  if (stance) parts.push(coachMessage("fragment.ms_ground_contact", { p0: Math.round(stance) }));
  return {
    ...(category('running_turnover')),
    points: Math.round(earned),
    maxPoints: max,
    ...(band(ratio, finding('optimal_cadence_sweet_spot'), finding('adequate_turnover'), finding('sub_optimal_cadence_turnover'))),
    ...coachDescription(coachJoin(parts, ' · '))
  };
}

/**
 * Set-level fatigue: the last work rep against the first, in pace and heart rate.
 * Recovery length is the athlete's plan (short recoveries deliberately hold HR
 * near threshold), so the raw drop between reps is never graded — decay is.
 */
export function setFatigueDetail(input: RubricInput) {
  const workReps = (input.intervals || []).map(coachingInterval).filter((i) => i.type === INTERVAL_TYPE.work);
  const shape = describeSet(input.intervals);
  const paces = workReps
    .map((r) => {
      const pace = r.avgPaceSecKm ?? (r.avgSpeedMps ? 1000 / r.avgSpeedMps : null);
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

export function intensityControlPoints(
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
