import { describe, expect, it } from 'vitest';
import { coachJoin, coachMessage, coachWeatherCondition } from '../../src/backend/domain/coaching/messages.js';
import { intensityAudit, auditWalkBreaks } from '../../src/backend/physiology/coaching/evidence.js';
import { thresholdZoneShare } from '../../src/backend/physiology/coaching/quality.js';
import { coachingRecord, coachingInterval } from '../../src/backend/domain/coaching/telemetry.js';
import { parseCoachMessage, parseCoachMessageArray } from '../../src/shared/coaching.js';
import { formatCoachMessage } from '../../src/frontend/i18n/coachMessage.js';
import { parseScoreFactors } from '../../src/shared/contracts/coach-analysis.js';
import { en } from '../../src/frontend/i18n/en.js';
import { zh } from '../../src/frontend/i18n/zh.js';

const format = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (token, key: string) => key in values ? String(values[key]) : token);
const record = (elapsedSeconds: number, heartRate = 135) => ({ elapsedSeconds, heartRate, cadence: 180, timerActive: true, timerSegment: 0 });

describe('Dynamic coaching protocol', () => {
  it('localizes nested lists and clauses independently of API English wording', () => {
    const message = coachJoin([
      { ...coachMessage('fragment.stationary_traffic_stop_idle'), text: 'Changed English' },
      coachMessage('fragment.walk_break_m', { p0: 20 })
    ], ' and ');
    expect(formatCoachMessage(message, en, format)).toBe(message.text);
    const localized = formatCoachMessage({ ...message, text: 'Changed outer English' }, zh, format);
    expect(localized).toContain('20');
    expect(localized).not.toContain('Changed');
    expect(localized).not.toContain(' and ');
    expect(parseCoachMessage(JSON.parse(JSON.stringify(message)))).toEqual(message);
  });

  it('preserves legacy descriptions when a future or malformed message is unreadable', () => {
    const factors = parseScoreFactors([{ category: 'Aerobic Intensity', label: 'Clearly Easy', points: 85,
      description: 'Original English', descriptionMessage: { id: 'future.description', text: 'Future English', params: {} } }]);
    expect(factors).toHaveLength(1);
    expect(factors[0].description).toBe('Original English');
    expect(factors[0].descriptionMessage).toBeUndefined();
  });

  it('localizes known weather and retains unrecognized provider text', () => {
    const weather = coachWeatherCondition('Heavy rain');
    expect(typeof weather).toBe('object');
    if (typeof weather === 'object') expect(formatCoachMessage(weather, zh, format)).toBe(zh.weather.conditions['65']);
    expect(coachWeatherCondition('Provider-specific weather')).toBe('Provider-specific weather');
  });

  it('rejects malformed nested messages, invalid numbers and excessive nesting', () => {
    const message = coachMessage('fragment.join');
    expect(parseCoachMessage({ ...message, params: { items: [{ id: 'unknown' }] } })).toBeUndefined();
    expect(parseCoachMessage({ ...message, params: { value: NaN } })).toBeUndefined();
    expect(parseCoachMessageArray([message, null])).toBeUndefined();
    let nested = message;
    for (let i = 0; i < 20; i++) nested = coachJoin([nested], '');
    expect(parseCoachMessage(nested)).toBeUndefined();
  });
});

describe('Coaching telemetry boundaries', () => {
  it('normalizes legacy snake_case inputs and excludes nonfinite sensor values', () => {
    expect(coachingRecord({ elapsed_seconds: 4, heart_rate: 140, cadence: NaN, distance_m: 10 })).toMatchObject({ elapsedSeconds: 4, heartRate: 140, cadence: null, distanceMeters: 10 });
    expect(coachingInterval({ duration_seconds: 120, avg_heart_rate: 150 })).toMatchObject({ durationSeconds: 120, avgHeartRate: 150 });
  });

  it('excludes stopped high heart rate even when cadence remains elevated', () => {
    const records = Array.from({ length: 60 }, (_, i) => record(i));
    records.push(...Array.from({ length: 60 }, (_, i) => ({ ...record(i + 60, 190), timerActive: false })));
    expect(intensityAudit(records, { lt1Hr: 148 })).toMatchObject({ sampledSec: 60, aboveCeilingPct: 0 });
  });

  it('does not smooth heart rate across timer segments or recording gaps', () => {
    for (const offset of [30, 300]) {
      const records = [
        ...Array.from({ length: 30 }, (_, i) => record(i, 130)),
        ...Array.from({ length: 30 }, (_, i) => ({ ...record(i + offset, 170), timerSegment: offset === 30 ? 1 : 0 }))
      ];
      expect(intensityAudit(records, { lt1Hr: 148 })?.aboveCeilingPct).toBe(50);
    }
  });

  it('does not invent a sustained walk across gaps or stopped samples', () => {
    const records = Array.from({ length: 30 }, (_, i) => ({ ...record(i * 60), cadence: 90 }));
    expect(auditWalkBreaks(records, { lt1Hr: 148, lt2Hr: 167 })).toBeNull();
    expect(auditWalkBreaks(records.map(r => ({ ...r, timerActive: false })), { lt1Hr: 148, lt2Hr: 167 })).toBeNull();
  });

  it('measures threshold exposure only inside active observed work intervals', () => {
    const records = Array.from({ length: 121 }, (_, i) => ({ ...record(i, i <= 60 ? 167 : 190), timerActive: i <= 60 }));
    expect(thresholdZoneShare({
      runType: 'threshold_lt2', isFailedWorkout: false, steadyHr: 167, steadyCadence: 180,
      steadyStanceTime: null, decouplingPct: null, isAccidentalTempo: false,
      lt1Hr: 148, lt2Hr: 167, maxHeartRate: 203, activityMaxHr: 190,
      records, intervals: [{ type: 'work', startSeconds: 0, durationSeconds: 120 }]
    })).toMatchObject({ pct: 100, seconds: 60 });
  });
});
