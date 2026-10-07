import { thresholdTime, type ThresholdObservation } from './threshold-trend.js';

// Conservative product rules, not probabilities or laboratory cutoffs.
export const THRESHOLD_EVIDENCE_WINDOW_DAYS = 42;
export const THRESHOLD_STALE_DAYS = 45;
const PACE_CHANGE_RATIO = 0.03;
const COMPARABLE_HR_BPM = 3;

export interface ThresholdEvidenceObservation extends ThresholdObservation {
  sourceId: string;
  external: boolean;
  usable: boolean;
  temperatureC?: number | null;
  kind?: 'continuous' | 'run_walk';
  recoveryFraction?: number;
  runningBoutSeconds?: number;
}

export interface ThresholdEvidence {
  status: 'supported' | 'held' | 'stale' | 'insufficient' | 'external';
  acceptedDate: string | null;
  heartRateDate: string | null;
  observationDate: string | null;
  supportCount: number;
  basis?: 'continuous' | 'run_walk' | 'external';
  method?: 'aerobic_reference';
  confidence?: number;
}

export interface SupportedThreshold {
  hr: number | null;
  pace: number | null;
  confidence: number;
  latestDate: string | null;
  evidence: ThresholdEvidence;
}

/** Replay without future evidence. Easy HR never becomes a new LT1 ceiling. */
export function supportedThreshold(observations: ThresholdEvidenceObservation[], asOfDate: string,
  options: { strictlyBefore?: boolean; aerobicAnchorHr?: number } = {}): SupportedThreshold {
  const ref = thresholdTime(asOfDate);
  const rows = observations.filter(row => Number.isFinite(thresholdTime(row.effective_date)) &&
    (options.strictlyBefore ? thresholdTime(row.effective_date) < ref : thresholdTime(row.effective_date) <= ref) &&
    Number.isFinite(row.hr) && row.hr > 0 && Number.isFinite(row.confidence) && row.confidence > 0 && row.confidence <= 1)
    .sort((a, b) => thresholdTime(a.effective_date) - thresholdTime(b.effective_date) || a.sourceId.localeCompare(b.sourceId));
  let accepted: { hr: number; pace: number | null; confidence: number; date: string; hrDate: string; count: number; temperatureC?: number | null; observedHr: number; basis: 'continuous' | 'run_walk' | 'external' } | null = null;
  let pending: ThresholdEvidenceObservation[] = [];
  let observationDate: string | null = null;
  let lastUsed = false;
  let aerobicAnchor = options.aerobicAnchorHr;
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.sourceId)) continue;
    seen.add(row.sourceId);
    observationDate = row.effective_date;
    lastUsed = false;
    const validPace = row.pace != null && Number.isFinite(row.pace) && row.pace >= 120 && row.pace <= 1200;
    if (row.external) {
      // HR-only tests update HR independently and preserve supported pace and age.
      if (!validPace && accepted?.pace != null) {
        accepted.hr = row.hr;
        accepted.hrDate = row.effective_date;
      } else {
        accepted = { hr: row.hr, observedHr: row.hr, pace: validPace ? row.pace : null, confidence: row.confidence,
          date: row.effective_date, hrDate: row.effective_date, count: 1, basis: 'external' };
        lastUsed = true;
      }
      pending = [];
      if (aerobicAnchor != null) aerobicAnchor = row.hr;
      continue;
    }
    if (!row.usable || !validPace) continue;
    const kind = row.kind ?? 'continuous';
    // Recovery-assisted evidence cannot displace an uninterrupted or external estimate.
    if (kind === 'run_walk' && accepted && accepted.basis !== 'run_walk') continue;
    if (aerobicAnchor != null && Math.abs(row.hr - aerobicAnchor) > COMPARABLE_HR_BPM) continue;
    if (aerobicAnchor != null && accepted?.pace != null && Math.abs(row.hr - accepted.observedHr) > COMPARABLE_HR_BPM) continue;
    // Sensor temperature is only a comparability screen, never a pace correction.
    if (accepted?.temperatureC != null && row.temperatureC != null &&
        Math.abs(accepted.temperatureC - row.temperatureC) > 3) continue;
    pending = pending.filter(p => thresholdTime(row.effective_date) - thresholdTime(p.effective_date) <= THRESHOLD_EVIDENCE_WINDOW_DAYS * 86400000);
    pending.push(row);
    const peers = pending.filter(p => (p.kind ?? 'continuous') === kind &&
      (kind !== 'run_walk' || (p.recoveryFraction != null && row.recoveryFraction != null &&
        p.runningBoutSeconds != null && row.runningBoutSeconds != null &&
        Math.abs(p.recoveryFraction - row.recoveryFraction) <= 0.05 &&
        Math.abs(p.runningBoutSeconds / row.runningBoutSeconds - 1) <= 0.25)) && Math.abs(p.hr - row.hr) <= COMPARABLE_HR_BPM &&
      p.pace != null && Math.abs(p.pace / row.pace! - 1) <= PACE_CHANGE_RATIO &&
      (p.temperatureC == null || row.temperatureC == null || Math.abs(p.temperatureC - row.temperatureC) <= 3));
    const improving = accepted?.pace != null && row.pace! < accepted.pace * (1 - PACE_CHANGE_RATIO);
    const required = kind === 'run_walk' ? (accepted?.pace == null ? 3 : 4) :
      accepted?.pace == null || improving ? 2 : 3;
    if (peers.length < required) continue;
    const orderedPaces = peers.map(p => p.pace!).sort((a, b) => a - b);
    const pace = Math.round(orderedPaces[Math.floor(orderedPaces.length / 2)]);
    const hr = aerobicAnchor ?? Math.round(peers.reduce((sum, p) => sum + p.hr, 0) / peers.length);
    accepted = { hr, pace, confidence: Math.min(kind === 'run_walk' ? 0.65 : 1, ...peers.map(p => p.confidence)), date: row.effective_date,
      hrDate: aerobicAnchor == null ? row.effective_date : accepted?.hrDate ?? row.effective_date, observedHr: Math.round(peers.reduce((sum, p) => sum + p.hr, 0) / peers.length),
      count: peers.length, basis: kind, temperatureC: row.temperatureC };
    pending = [];
    lastUsed = true;
  }
  const stale = accepted != null && ref - thresholdTime(accepted.date) > THRESHOLD_STALE_DAYS * 86400000;
  return {
    hr: accepted?.hr ?? null, pace: accepted?.pace ?? null, confidence: accepted?.confidence ?? 0,
    latestDate: accepted?.date ?? null,
    evidence: { status: accepted == null ? 'insufficient' : stale ? 'stale' :
      !lastUsed ? 'held' : accepted.count === 1 ? 'external' : 'supported',
    acceptedDate: accepted?.pace != null ? accepted.date : null, heartRateDate: accepted?.hrDate ?? null,
    observationDate, supportCount: accepted?.count ?? 0, basis: accepted?.basis }
  };
}
