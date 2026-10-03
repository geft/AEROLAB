import { coachingInterval } from '../domain/coaching/telemetry.js';
export * from './coaching/evidence.js';
import { RubricInput, RubricResult, runFamilyOf, driftTargetFor, pacingConsistency, intensityAudit, auditWalkBreaks } from './coaching/evidence.js';
import { sessionVerdict } from './session-verdict.js';
import { gradeAerobic } from './coaching/aerobic.js';
import { gradeQuality, thresholdZoneShare } from './coaching/quality.js';
import { gradeRace } from './coaching/race.js';
import { pickFocus, buildFocusAdvice } from './coaching/focus.js';
export function gradeRun(input: RubricInput): RubricResult {
  const family = runFamilyOf(input.runType);
  // Detected recovery intervals are the session's prescribed breaks, so walking
  // inside them is design rather than a shortfall. Only real breaks count: a
  // "recovery" row that spans 20 minutes is a segment label, not a prescription,
  // and aerobic runs have no prescribed breaks at all.
  const recoveryWindows = family === 'aerobic'
    ? []
    : (input.intervals || []).map(coachingInterval)
        .filter((i) => i.type === 'recovery' || i.type === 'rest')
        .map((i) => {
          const from = i.startSeconds;
          return { from, to: from + (i.durationSeconds) };
        })
        .filter((w: { from: number; to: number }) => {
          const len = w.to - w.from;
          return len >= 20 && len <= 600;
        });
  const workWindows = family !== 'aerobic'
    ? (input.intervals || []).map(coachingInterval).filter((i) => i.type === 'work').map((i) => {
        const from = i.startSeconds;
        const duration = i.durationSeconds;
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
  const focusAdviceMessage = focus ? buildFocusAdvice(focus, input, walkAudit) : null;
  return {
    family,
    verdict: input.runType === 'threshold_lt2' && !thresholdZone
      ? 'insufficient_evidence'
      : sessionVerdict({ family, factors, hasIntensityTelemetry: intensity != null, isFailedWorkout: input.isFailedWorkout, isAccidentalTempo: input.isAccidentalTempo, runType: input.runType }),
    score: Math.max(40, Math.min(98, Math.round(score))),
    factors,
    coveragePct,
    focusAdvice: focusAdviceMessage?.text ?? null,
    focusAdviceMessage,
    walkAudit,
    driftTarget,
    pacing,
    intensity
  };
}
