import { thresholdTime } from './threshold-trend.js';
import type { SupportedThreshold } from './threshold-evidence.js';

/** Durability evidence can prompt an LT1 reassessment without measuring LT1. */
export interface AerobicObservation {
  activityId: string;
  date: string;
  /** The freshest comparable window, not the drifted mean of the whole effort. */
  hr: number;
  /** Highest HR seen in a comparable-pace window of the same effort. */
  hrHigh?: number;
  paceSecKm: number;
  runningSeconds: number;
  decouplingPct: number;
  basis: 'continuous' | 'run_walk';
}

export interface AerobicReference extends AerobicObservation {
  supportCount: number;
  supportingActivityIds: string[];
  supportingDates?: string[];
  stale: boolean;
}

export interface AerobicAssessment {
  assessedRunCount: number;
  usableRunCount: number;
  latestEvidenceDate: string | null;
  reference: AerobicReference | null;
  candidate: AerobicObservation | null;
}

// Comparability and corroboration are product policy, not lactate cutoffs.
export const AEROBIC_HISTORY_DAYS = 180;
const CORROBORATION_DAYS = 42;
const FRESHNESS_DAYS = 45;
const HR_TOLERANCE = 3;
const PACE_TOLERANCE = 0.03;
const REQUIRED_EFFORTS = 3;

/**
 * LT1 defines the easy ceiling, so an overestimate costs more than an
 * underestimate: too high pushes easy running into tempo. This promoter only
 * ever raises the anchor (slower easy runs must not ratchet it down), and a
 * larger upward revision needs a second independent confirmation period inside
 * the corroboration window, so fitness cannot walk up on one long run.
 */
export const LT1_MAX_UPWARD_STEP_BPM = 3;
const INDEPENDENT_CONFIRMATION_DAYS = 14;
/** A promoted aerobic reference must stay clearly below LT2 or it is not a turnpoint. */
export const LT1_LT2_MIN_SEPARATION_BPM = 10;

export function assessAerobicEvidence(observations: AerobicObservation[], assessedRunCount: number,
  asOfDate: string, options: { strictlyBefore?: boolean; excludeActivityId?: string } = {}): AerobicAssessment {
  const ref = thresholdTime(asOfDate);
  const seen = new Set<string>();
  const rows = observations.filter(row => {
    const time = thresholdTime(row.date);
    return row.activityId !== options.excludeActivityId && Number.isFinite(time) &&
      (options.strictlyBefore ? time < ref : time <= ref) && time >= ref - AEROBIC_HISTORY_DAYS * 86400000 &&
      Number.isFinite(row.hr) && row.hr > 40 && row.hr < 240 &&
      Number.isFinite(row.paceSecKm) && row.paceSecKm >= 120 && row.paceSecKm <= 1200 &&
      Number.isFinite(row.runningSeconds) && row.runningSeconds >= 900 &&
      Number.isFinite(row.decouplingPct) && row.decouplingPct >= -8 && row.decouplingPct <= 5;
  }).sort((a, b) => thresholdTime(a.date) - thresholdTime(b.date)).filter(row => {
    if (seen.has(row.activityId)) return false;
    seen.add(row.activityId);
    return true;
  });
  let reference: AerobicReference | null = null;
  for (const row of rows) {
    const peers = rows.filter(peer => thresholdTime(peer.date) <= thresholdTime(row.date) &&
      thresholdTime(peer.date) >= thresholdTime(row.date) - CORROBORATION_DAYS * 86400000 &&
      Math.abs(peer.hr - row.hr) <= HR_TOLERANCE &&
      Math.abs(peer.paceSecKm / row.paceSecKm - 1) <= PACE_TOLERANCE);
    if (peers.length < REQUIRED_EFFORTS) continue;
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const hr = Math.round(median(peers.map(peer => peer.hr)));
    const paceSecKm = Math.round(median(peers.map(peer => peer.paceSecKm)));
    // Easy recovery runs are useful evidence but cannot ratchet the reference down.
    let referenceHr = hr;
    if (reference) {
      if (hr < reference.hr - HR_TOLERANCE || paceSecKm > reference.paceSecKm * (1 + PACE_TOLERANCE)) continue;
      referenceHr = Math.max(reference.hr, hr);
    }
    reference = { ...row, hr: referenceHr, paceSecKm,
      basis: peers.some(peer => peer.basis === 'run_walk') ? 'run_walk' : 'continuous',
      supportCount: peers.length, supportingActivityIds: peers.map(peer => peer.activityId),
      supportingDates: peers.map(peer => peer.date),
      stale: ref - thresholdTime(row.date) > FRESHNESS_DAYS * 86400000 };
  }
  // A higher observation is visible even outside the previous HR anchor. A single
  // such effort is a candidate, never a new Zone 2 ceiling.
  const candidates = rows.filter(row => ref - thresholdTime(row.date) <= FRESHNESS_DAYS * 86400000 &&
    (!reference || row.hr > reference.hr + HR_TOLERANCE && row.paceSecKm < reference.paceSecKm));
  const candidate = candidates.sort((a, b) => b.hr - a.hr || thresholdTime(b.date) - thresholdTime(a.date))[0] ?? null;
  return { assessedRunCount, usableRunCount: rows.length, latestEvidenceDate: rows.at(-1)?.date ?? null,
    reference, candidate };
}

/** Corroboration updates working LT1; age lowers confidence without erasing it. */
export function promoteAerobicReference(accepted: SupportedThreshold, assessment: AerobicAssessment,
  maximumHr: number): SupportedThreshold {
  const reference = assessment.reference;
  if (!reference || reference.supportCount < REQUIRED_EFFORTS || reference.hr > maximumHr ||
    accepted.hr != null && reference.hr < accepted.hr) return accepted;
  const acceptedDate = accepted.evidence.heartRateDate ?? accepted.latestDate;
  if (accepted.evidence.basis === 'external' && acceptedDate &&
    thresholdTime(reference.date) <= thresholdTime(acceptedDate)) return accepted;
  if (reference.hr === accepted.hr && acceptedDate &&
    thresholdTime(reference.date) <= thresholdTime(acceptedDate)) return accepted;
  // A jump larger than one small step needs a second confirmation period.
  if (accepted.hr != null && reference.hr > accepted.hr + LT1_MAX_UPWARD_STEP_BPM &&
    !hasIndependentConfirmation(reference)) return accepted;
  const confidence = reference.basis === 'run_walk' ? 0.65 : 0.8;
  return { hr: reference.hr, pace: reference.paceSecKm, confidence, latestDate: reference.date,
    evidence: { status: reference.stale ? 'stale' : 'supported', acceptedDate: reference.date,
      heartRateDate: reference.date, observationDate: assessment.latestEvidenceDate,
      supportCount: reference.supportCount, basis: reference.basis, method: 'aerobic_reference', confidence } };
}

/** The corroborating efforts must span two separate confirmation periods. */
function hasIndependentConfirmation(reference: AerobicReference): boolean {
  const latest = thresholdTime(reference.date);
  if (!Number.isFinite(latest)) return false;
  return (reference.supportingDates ?? [reference.date]).some(date => {
    const time = thresholdTime(date);
    return Number.isFinite(time) && latest - time >= INDEPENDENT_CONFIRMATION_DAYS * 86400000;
  });
}
