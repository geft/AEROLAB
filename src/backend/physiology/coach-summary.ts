import { getAthleteHeartRateProfile } from './athlete-profile.js';
import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { PauseBreakdown, extractSteadyStateMetrics } from './economy.js';
import { ZoneDistribution } from './zones.js';

export interface ScoreFactor {
  category: string;
  points: number;
  label: string;
  description?: string;
}

export interface CoachSummary {
  headline: string;
  effectivenessScore: number; // 0 - 100
  rating5: number; // 1.0 - 5.0 rating scale
  stars: number; // 1 - 5 stars
  keyInsights: string[];
  recommendation: string;
  scoreBreakdown: ScoreFactor[];
  updatedAt?: string;
  steadyPaceSecKm?: number | null;
  steadyHeartRate?: number | null;
  steadyCadence?: number | null;
  steadyStanceTime?: number | null;
  pauseBreakdown?: PauseBreakdown | null;
}

export function generateCoachSummary(params: {
  runType: string;
  distanceKm: number;
  durationMin: number;
  avgPaceSecKm: number;
  avgHr: number;
  maxHr: number;
  cadence: number;
  decouplingPct: number | null;
  efficiencyFactor: number | null;
  avgTemp: number | null;
  groundContactTime: number | null;
  elevationGainM?: number | null;
  zoneDist?: ZoneDistribution;
  isFailedWorkout?: boolean;
  // Steady state values (isolated from traffic pauses and walk breaks)
  steadyPaceSecKm?: number | null;
  steadyHr?: number | null;
  steadyCadence?: number | null;
  steadyStanceTime?: number | null;
  pauseBreakdown?: PauseBreakdown | null;
  // Athlete profile thresholds
  lt1Hr?: number | null;
  lt2Hr?: number | null;
  maxHeartRate?: number | null;
  restingHr?: number | null;
  // External microclimate weather telemetry
  weatherTempC?: number | null;
  weatherHumidityPct?: number | null;
  weatherApparentTempC?: number | null;
  weatherCondition?: string | null;
  // Interval reps telemetry (for quality threshold / VO2 sessions)
  intervals?: any[] | null;
  splits?: any[] | null;
}): CoachSummary {
  const {
    runType,
    avgPaceSecKm,
    avgHr,
    cadence,
    decouplingPct,
    avgTemp,
    groundContactTime,
    steadyPaceSecKm,
    steadyHr,
    steadyCadence,
    steadyStanceTime,
    pauseBreakdown
  } = params;

  // Use steady-state values when available to avoid pause/stop distortion
  const effectiveCadence = steadyCadence || cadence;
  const effectiveHr = steadyHr || avgHr;
  const effectivePaceSecKm = steadyPaceSecKm || avgPaceSecKm;
  const effectiveGct = steadyStanceTime || groundContactTime;

  const hrProfile = resolveHeartRateProfile({ maxHr: params.maxHeartRate, restingHr: params.restingHr, lt1Hr: params.lt1Hr, lt2Hr: params.lt2Hr });
  const { lt1Hr: lt1 } = hrProfile;

  const insights: string[] = [];
  const scoreBreakdown: ScoreFactor[] = [];
  let score = 85; // Baseline good session

  // Failed workout alert
  if (params.isFailedWorkout) {
    score = 60;
    scoreBreakdown.push({
      category: 'Workout Completion',
      points: 60,
      label: 'Aborted / Incomplete Quality Workout',
      description: 'Target interval volume was cut short or pace collapsed prematurely'
    });
    insights.push('⚠️ Incomplete / Aborted Quality Effort: Target interval volume was cut short or pace collapsed. Re-evaluate fatigue levels before your next hard effort.');
  } else {
    scoreBreakdown.push({
      category: 'Base Execution',
      points: 85,
      label: 'Standard Quality Baseline',
      description: 'Starting evaluation baseline before physiological adjustments'
    });
  }

  // 1. Explicit Traffic & Walk Break Isolation Insight
  if (pauseBreakdown && (pauseBreakdown.stopDurationSeconds > 0 || pauseBreakdown.walkDurationSeconds > 0)) {
    const parts: string[] = [];
    if (pauseBreakdown.stopCount > 0 || pauseBreakdown.stopDurationSeconds > 0) {
      const stopMins = Math.floor(pauseBreakdown.stopDurationSeconds / 60);
      const stopSecs = pauseBreakdown.stopDurationSeconds % 60;
      const stopTimeStr = stopMins > 0 ? `${stopMins}m ${stopSecs}s` : `${stopSecs}s`;
      parts.push(`${pauseBreakdown.stopCount} stationary/traffic stop${pauseBreakdown.stopCount === 1 ? '' : 's'} (${stopTimeStr} idle)`);
    }
    if (pauseBreakdown.walkCount > 0 || pauseBreakdown.walkDurationSeconds > 0) {
      const walkMins = Math.floor(pauseBreakdown.walkDurationSeconds / 60);
      const walkSecs = pauseBreakdown.walkDurationSeconds % 60;
      const walkTimeStr = walkMins > 0 ? `${walkMins}m ${walkSecs}s` : `${walkSecs}s`;
      parts.push(`${pauseBreakdown.walkCount} walk break${pauseBreakdown.walkCount === 1 ? '' : 's'} (${walkTimeStr}, ${Math.round(pauseBreakdown.walkDistanceMeters)}m)`);
    }

    const paceMin = Math.floor(effectivePaceSecKm / 60);
    const paceSec = Math.round(effectivePaceSecKm % 60);
    const cleanPaceStr = `${paceMin}:${String(paceSec).padStart(2, '0')}/km`;

    insights.push(
      `Traffic & Walk Break Isolation: Removed ${parts.join(' and ')} from steady-state analysis. Your true running pace averaged ${cleanPaceStr} at ${effectiveHr} bpm (${effectiveCadence} spm), preventing pause distortion.`
    );
  }

  // Aerobic decoupling / Cardiac Drift insight (applies ONLY to steady continuous aerobic runs)
  const isSteadyAerobic = runType === 'easy_base' || runType === 'long_run' || runType === 'recovery' || runType === 'accidental_tempo';
  if (isSteadyAerobic && decouplingPct !== null) {
    if (decouplingPct < 3.0) {
      score += 8;
      scoreBreakdown.push({
        category: 'Aerobic Decoupling',
        points: 8,
        label: 'Superb Cardiovascular Stability',
        description: `${decouplingPct.toFixed(1)}% cardiac drift (<3% gold standard)`
      });
      insights.push(`Superb cardiovascular stability with only ${decouplingPct.toFixed(1)}% drift. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue.`);
    } else if (decouplingPct < 5.0) {
      score += 4;
      scoreBreakdown.push({
        category: 'Aerobic Decoupling',
        points: 4,
        label: 'Solid Sub-LT1 Aerobic Base',
        description: `${decouplingPct.toFixed(1)}% cardiac drift (<5% ceiling)`
      });
      insights.push(`Solid aerobic discipline. Decoupling was ${decouplingPct.toFixed(1)}%, well within the sub-LT1 gold standard threshold (<5%).`);
    } else {
      score -= 8;
      scoreBreakdown.push({
        category: 'Aerobic Decoupling',
        points: -8,
        label: 'Elevated Cardiac Drift / Thermal Strain',
        description: `${decouplingPct.toFixed(1)}% drift (exceeds 5% sub-LT1 threshold)`
      });
      insights.push(`Noticeable cardiac drift detected (${decouplingPct.toFixed(1)}%). Likely due to thermal strain${avgTemp ? ` (${avgTemp}°C)` : ''}, dehydration, or pacing slightly ahead of current aerobic capacity.`);
    }
  }

  // Structured Interval Execution Quality (for VO2 Max & Threshold quality sessions)
  // Pace-free: duration consistency (structure) + peak-HR attainment (profile-relative).
  if ((runType === 'intervals_vo2' || runType === 'threshold_lt2') && params.intervals && params.intervals.length > 0) {
    const workReps = params.intervals.filter((i: any) => i.type === 'work');
    if (workReps.length >= 2) {
      const durations = workReps
        .map((r: any) => r.duration_seconds ?? r.durationSeconds)
        .filter((d: number) => d > 0);
      if (durations.length >= 2) {
        const meanDur = durations.reduce((a: number, b: number) => a + b, 0) / durations.length;
        const variance = durations.reduce((a: number, b: number) => a + Math.pow(b - meanDur, 2), 0) / durations.length;
        const stdDev = Math.sqrt(variance);
        const cv = meanDur > 0 ? stdDev / meanDur : 0;

        if (cv <= 0.08) {
          score += 8;
          scoreBreakdown.push({
            category: 'Interval Execution',
            points: 8,
            label: 'Laser Rep Consistency',
            description: `Executed ${workReps.length} reps with ${(cv * 100).toFixed(1)}% duration variance (±${Math.round(stdDev)}s)`
          });
          insights.push(
            `Exceptional Rep Consistency: Executed ${workReps.length} work reps with laser precision (${(cv * 100).toFixed(1)}% duration variance, ±${Math.round(stdDev)}s spread). Zero early overshoot or late-rep collapse.`
          );
        } else if (cv <= 0.15) {
          score += 4;
          scoreBreakdown.push({
            category: 'Interval Execution',
            points: 4,
            label: 'Disciplined Interval Structure',
            description: `${workReps.length} reps held within ${(cv * 100).toFixed(1)}% duration variance`
          });
          insights.push(
            `Disciplined Interval Structure: Held ${workReps.length} work reps consistently (${(cv * 100).toFixed(1)}% duration variance).`
          );
        } else if (cv > 0.25) {
          score -= 6;
          scoreBreakdown.push({
            category: 'Interval Execution',
            points: -6,
            label: 'High Rep Variance Across Set',
            description: `High duration variance (${(cv * 100).toFixed(1)}%) across ${workReps.length} reps`
          });
          insights.push(
            `Rep Variance Warning: High duration variance across reps (${(cv * 100).toFixed(1)}%). Focus on even rep durations to keep the stimulus consistent across the entire set.`
          );
        }
      }

      // Check Peak HR reached (true cardiovascular stimulus for VO2 Max)
      const maxWorkHr = Math.max(...workReps.map((r: any) => r.max_heart_rate ?? r.maxHeartRate ?? 0));
      const maxProfileHr = hrProfile.maxHr;
      if (runType === 'intervals_vo2' && maxWorkHr > 0) {
        const pctMax = (maxWorkHr / maxProfileHr) * 100;
        if (pctMax >= 88) {
          score += 6;
          scoreBreakdown.push({
            category: 'Cardiovascular Stimulus',
            points: 6,
            label: 'Target VO2 Stimulus Achieved',
            description: `Peaked at ${maxWorkHr} bpm (${pctMax.toFixed(0)}% HRmax)`
          });
          insights.push(
            `Target VO2 Stimulus Achieved: Heart rate peaked at ${maxWorkHr} bpm (${pctMax.toFixed(0)}% HRmax), successfully stimulating maximal oxygen uptake and cardiac stroke volume adaptations.`
          );
        }
      }

      // Autonomic Recovery Drops during rest periods
      const recoveries = params.intervals.filter((i: any) => (i.type === 'recovery' || i.type === 'rest') && ((i.hr_drop ?? i.hrDrop) > 0));
      if (recoveries.length > 0) {
        const drops = recoveries.map((r: any) => r.hr_drop ?? r.hrDrop ?? 0);
        const avgDrop = Math.round(drops.reduce((a: number, b: number) => a + b, 0) / drops.length);
        if (avgDrop >= 35) {
          score += 5;
          scoreBreakdown.push({
            category: 'Autonomic Recovery',
            points: 5,
            label: 'Rapid Cardiovascular Recovery Drop',
            description: `Averaged -${avgDrop} bpm recovery drop between work intervals`
          });
          insights.push(
            `Rapid Cardiovascular Recovery: Heart rate dropped by an average of ${avgDrop} bpm between work intervals, demonstrating excellent parasympathetic reactivation and high aerobic fitness.`
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Race / Time Trial Execution: Pacing Discipline & Split Consistency
  // ---------------------------------------------------------------------------
  if (runType === 'race' && params.splits && params.splits.length >= 2) {
    const workRep = (params.intervals || []).find((i: any) => i.type === 'work');
    let raceSplits: any[] = [];

    if (workRep) {
      const wStart = workRep.startSeconds ?? workRep.start_seconds ?? 0;
      const wDur = workRep.durationSeconds ?? workRep.duration_seconds ?? 0;
      let cumSec = 0;
      raceSplits = params.splits.filter((s: any) => {
        const splitDur = s.duration_seconds || s.durationSeconds || 0;
        const splitStart = cumSec;
        cumSec += splitDur;
              return splitStart >= wStart - 30 && splitStart < wStart + wDur - 60;
      });
    }

    if (raceSplits.length < 2) {
      // Fallback: active running splits
      raceSplits = params.splits.filter((s: any) => {
        const p = s.avg_pace_sec_km || s.avgPaceSecKm || 0;
        return p > 120 && p < 720;
      });
    }

    if (raceSplits.length >= 2) {
      const paces = raceSplits.map((s: any) => s.avg_pace_sec_km || s.avgPaceSecKm);
      const firstPace = paces[0];
      const secondPace = paces[1];
      const avgPace = paces.reduce((a: number, b: number) => a + b, 0) / paces.length;

      const variance = paces.reduce((a: number, b: number) => a + Math.pow(b - avgPace, 2), 0) / paces.length;
      const stdDev = Math.sqrt(variance);
      const cv = avgPace > 0 ? stdDev / avgPace : 0;

      const fmt = (p: number) => {
        const m = Math.floor(p / 60);
        const s = Math.round(p % 60);
        return `${m}:${String(s).padStart(2, '0')}/km`;
      };

      const earlySurgeSec = secondPace - firstPace;
      const isEarlySurge = earlySurgeSec >= 12;

      if (isEarlySurge) {
        score -= 10;
        scoreBreakdown.push({
          category: 'Race Pacing Execution',
          points: -10,
          label: 'Aggressive Early Surge / Positive Split',
          description: `Km 1 opened at ${fmt(firstPace)}, followed by a ${Math.round(earlySurgeSec)}s/km drop (${fmt(secondPace)})`
        });
        insights.push(
          `Race Pacing Alert: Opened too fast in the first kilometer (${fmt(firstPace)} vs ${fmt(secondPace)} in Km 2, a +${Math.round(earlySurgeSec)}s/km drop). An over-aggressive opening km spikes blood lactate early and forces premature deceleration.`
        );
      } else if (cv <= 0.03) {
        score += 6;
        scoreBreakdown.push({
          category: 'Race Pacing Execution',
          points: 6,
          label: 'Laser Race Pacing Discipline',
          description: `Held race pace within ${(cv * 100).toFixed(1)}% split variance (±${Math.round(stdDev)}s)`
        });
        insights.push(
          `Masterful Race Pacing: Maintained exceptional pacing consistency across race splits (${(cv * 100).toFixed(1)}% variance, ±${Math.round(stdDev)}s spread).`
        );
      }

      if (cv > 0.05 && !isEarlySurge) {
        score -= 6;
        scoreBreakdown.push({
          category: 'Race Pacing Execution',
          points: -6,
          label: 'Volatile Split Pacing',
          description: `Pace varied by ${(cv * 100).toFixed(1)}% (±${Math.round(stdDev)}s spread)`
        });
        insights.push(
          `Erratic Race Pacing: Split paces fluctuated significantly (±${Math.round(stdDev)}s variance). Target an even or slight negative split to maximize endurance efficiency.`
        );
      } else if (cv > 0.05 && isEarlySurge) {
        score -= 4;
        scoreBreakdown.push({
          category: 'Race Pacing Execution',
          points: -4,
          label: 'Split Pacing Fluctuation',
          description: `Pace fluctuated across splits (±${Math.round(stdDev)}s spread)`
        });
      }
    }
  }

  // Cadence insight (evaluated on true steady-state running)
  if (effectiveCadence >= 172 && effectiveCadence <= 186) {
    score += 4;
    scoreBreakdown.push({
      category: 'Running Turnover',
      points: 4,
      label: 'Optimal Cadence Sweet Spot',
      description: `Steady running cadence averaged ${effectiveCadence} spm`
    });
    insights.push(`Cadence was right in the sweet spot (${effectiveCadence} spm), minimizing vertical braking forces and maximizing elastic recoil.`);
  } else if (effectiveCadence > 186) {
    insights.push(`High turnover (${effectiveCadence} spm) maintained during steady running, promoting quick foot turnover.`);
  } else if (effectiveCadence > 0 && effectiveCadence < 165) {
    score -= 3;
    scoreBreakdown.push({
      category: 'Running Turnover',
      points: -3,
      label: 'Sub-Optimal Cadence Turnover',
      description: `Steady running averaged ${effectiveCadence} spm (<165 spm)`
    });
    insights.push(`Steady running cadence averaged ${effectiveCadence} spm. Increasing turnover toward 170-180 spm will decrease ground contact time and reduce joint impact.`);
  }

  // Running dynamics insight
  if (effectiveGct && effectiveGct < 260) {
    insights.push(`Swift ground reaction: ${Math.round(effectiveGct)} ms stance time demonstrates crisp ground clearance and leg spring stiffness.`);
  }

  // Heat & Environment
  if (params.weatherTempC !== undefined && params.weatherTempC !== null) {
    const condStr = params.weatherCondition ? ` (${params.weatherCondition})` : '';
    const humidStr = params.weatherHumidityPct ? ` with ${params.weatherHumidityPct}% humidity` : '';
    const feelsLikeStr = params.weatherApparentTempC ? ` (feels like ${params.weatherApparentTempC}°C)` : '';
    const watchStr = avgTemp ? ` [Garmin watch sensor: ${avgTemp}°C]` : '';
    insights.push(`Microclimate Weather: ${params.weatherTempC}°C ambient${condStr}${humidStr}${feelsLikeStr}${watchStr}. ${
      params.weatherHumidityPct && params.weatherHumidityPct >= 80
        ? 'High tropical humidity restricts evaporative cooling and directly explains elevated cardiac drift.'
        : 'Microclimate weather verified from local meteorological reanalysis.'
    }`);
  } else if (avgTemp && avgTemp >= 30) {
    insights.push(`Executed in hot conditions (${avgTemp}°C). In high heat, heart rate naturally drifts 4-8 bpm higher; effective aerobic pacing was maintained despite the thermal burden.`);
  }

  // Elevation ramp walk check
  if (params.elevationGainM && params.elevationGainM >= 15) {
    insights.push(`Elevation & Ramps: Gained +${Math.round(params.elevationGainM)}m ascent. Uphill grade segments and ramp walks were isolated to keep your flat-ground running economy unskewed.`);
  }

  // Pacing discipline check for easy runs (detect accidental tempo using steady running HR & personalized LT1)
  const hrFloor = params.restingHr ? params.restingHr + 15 : 120;
  const isAccidentalTempo = (runType === 'easy_base' || runType === 'accidental_tempo' || runType === 'recovery')
    && effectiveHr > hrFloor
    && (effectiveHr >= lt1 || (decouplingPct !== null && decouplingPct >= 6.5));

  if (isAccidentalTempo) {
    score -= 15;
    scoreBreakdown.push({
      category: 'Pacing Discipline',
      points: -15,
      label: 'Unintentional Tempo Pacing Alert',
      description: `Broke Zone 2 ceiling (${effectiveHr} bpm steady HR vs LT1 cap of ${lt1} bpm), compromising aerobic recovery`
    });
    insights.push(`Pacing Alert: Heart rate drifted notably higher than pure Zone 2 (${effectiveHr} bpm avg). This functioned as an unintentional 'grey-zone' tempo effort rather than a low-stress aerobic recovery session.`);
  }

  // Clamped score & 3-tier rating calculation (Bronze / Silver / Gold)
  let finalScore = Math.max(40, Math.min(98, score));
  // Pacing violations (accidental tempo) are capped at Bronze tier (max 69 / 100)
  if (isAccidentalTempo) {
    finalScore = Math.min(finalScore, 69);
  }
  // Aborted / failed workouts are also capped at Bronze tier
  if (params.isFailedWorkout) {
    finalScore = Math.min(finalScore, 69);
  }

  // 3-tier star system: 1 = Bronze (<70), 2 = Silver (70-84), 3 = Gold (>=85)
  const stars = finalScore >= 85 ? 3 : finalScore >= 70 ? 2 : 1;
  const rating5 = Number(((finalScore / 20)).toFixed(1));

  let headline = 'Strong Aerobic Adaptation Session';
  let recommendation = 'Prioritize light hydration and low-impact movement before your next hard effort.';

  if (params.isFailedWorkout) {
    headline = 'Incomplete / Aborted Quality Session';
    recommendation = 'Assess underlying fatigue, heat stress, or nutrition. Take a recovery day before attempting another quality stimulus.';
  } else if (runType === 'race') {
    headline = finalScore >= 85
      ? 'All-Out Benchmark / Masterful Race Execution'
      : 'All-Out Benchmark Effort (Erratic Pacing)';
    recommendation = finalScore >= 85
      ? 'Exceptional competitive effort. Prioritize complete replenishment, deep sleep, and gentle recovery jogging over the next 48-72 hours.'
      : 'Commendable maximum effort. In your next benchmark, target an even or slight negative split to avoid early lactic burn.';
  } else if (runType === 'accidental_tempo' || isAccidentalTempo) {
    headline = 'Unintentional Tempo / Drifted Aerobic Run';
    recommendation = `If an Easy recovery was intended, slow your initial kilometer pace by 15-20 sec/km to keep heart rate firmly under your LT1 ceiling (${lt1} bpm).`;
  } else if (runType === 'recovery') {
    headline = 'Low-Stress Active Recovery Jog';
    recommendation = 'Superb discipline keeping heart rate low and muscle tissue unstressed. Ready for your next scheduled quality day.';
  } else if (runType === 'easy_base' || runType === 'long_run') {
    headline = finalScore >= 90 ? 'Near-Perfect Aerobic Base Execution' : 'Productive Zone 2 Aerobic Foundation';
    recommendation = decouplingPct !== null && decouplingPct < 4.0
      ? 'Your aerobic system is absorbing current volume smoothly. Ready for a progressive tempo or threshold stimulus.'
      : 'Maintain easy efforts at this heart rate cap to reinforce mitochondrial density.';
  } else if (runType === 'threshold_lt2') {
    headline = 'High-Quality Lactate Clearance Stimulus';
    recommendation = 'Allow 48 hours of recovery or easy aerobic jogging before your next quality interval day.';
  } else if (runType === 'intervals_vo2') {
    headline = finalScore >= 90 ? 'Masterful VO2 Max Interval Execution' : 'Sharp High-Velocity Neuromuscular Stimulus';
    recommendation = 'Focus on leg recovery and adequate protein intake to rebuild fast-twitch muscle fibers.';
  }

  return {
    headline,
    effectivenessScore: finalScore,
    rating5,
    stars,
    keyInsights: insights,
    recommendation,
    scoreBreakdown
  };
}

/**
 * Synchronizes and persists the Coach AI summary into the dedicated `activity_coach_summaries` table.
 * Continuously called on ingestion, activity edits, profile updates, and on-demand fetches.
 */
export function syncActivityCoachSummary(
  db: any,
  activityId: string,
  overrides?: any
): CoachSummary | null {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId) as any;
  if (!activity) return null;

  const records = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(activityId) as any[];
  const pauseBreakdown = extractSteadyStateMetrics(records);
  const intervals = db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(activityId) as any[];
  const splits = db.prepare('SELECT * FROM activity_splits WHERE activity_id = ? ORDER BY split_index ASC').all(activityId) as any[];

  const { maxHr: maxHeartRate, restingHr, lt1Hr, lt2Hr } = getAthleteHeartRateProfile(db);

  const coachSummary = generateCoachSummary({
    runType: overrides?.runType || activity.run_type || 'easy_base',
    distanceKm: (activity.distance_meters || 0) / 1000,
    durationMin: (activity.duration_seconds || 0) / 60,
    avgPaceSecKm: activity.avg_pace_sec_km || (activity.distance_meters ? Math.round((activity.duration_seconds / activity.distance_meters) * 1000) : 0),
    avgHr: activity.avg_heart_rate || 0,
    maxHr: activity.max_heart_rate || 0,
    cadence: activity.avg_cadence || 0,
    decouplingPct: activity.aerobic_decoupling_pct ?? null,
    efficiencyFactor: activity.efficiency_factor ?? null,
    avgTemp: activity.avg_temperature ?? null,
    groundContactTime: activity.avg_stance_time ?? null,
    elevationGainM: activity.elevation_gain_m ?? null,
    steadyPaceSecKm: pauseBreakdown.steadyPaceSecKm || activity.steady_pace_sec_km || null,
    steadyHr: pauseBreakdown.steadyHeartRate || activity.steady_heart_rate || null,
    steadyCadence: pauseBreakdown.steadyCadence || activity.steady_cadence || null,
    steadyStanceTime: pauseBreakdown.steadyStanceTimeMs || activity.steady_stance_time || null,
    pauseBreakdown,
    lt1Hr,
    lt2Hr,
    maxHeartRate,
    restingHr,
    weatherTempC: activity.weather_temperature_c ?? null,
    weatherHumidityPct: activity.weather_humidity_pct ?? null,
    weatherApparentTempC: activity.weather_apparent_temp_c ?? null,
    weatherCondition: activity.weather_condition ?? null,
    isFailedWorkout: overrides?.isFailedWorkout ?? new RegExp('failed|aborted|dnf|bailed', 'i').test(activity.name || ''),
    intervals: overrides?.intervals || intervals,
    splits: overrides?.splits || splits,
    ...overrides
  });

  try {
    db.prepare(`
      INSERT INTO activity_coach_summaries (
        activity_id, headline, effectiveness_score, key_insights_json,
        recommendation, steady_pace_sec_km, steady_heart_rate,
        steady_cadence, steady_stance_time, pause_breakdown_json, score_breakdown_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(activity_id) DO UPDATE SET
        headline = excluded.headline,
        effectiveness_score = excluded.effectiveness_score,
        key_insights_json = excluded.key_insights_json,
        recommendation = excluded.recommendation,
        steady_pace_sec_km = excluded.steady_pace_sec_km,
        steady_heart_rate = excluded.steady_heart_rate,
        steady_cadence = excluded.steady_cadence,
        steady_stance_time = excluded.steady_stance_time,
        pause_breakdown_json = excluded.pause_breakdown_json,
        score_breakdown_json = excluded.score_breakdown_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      activityId,
      coachSummary.headline,
      coachSummary.effectivenessScore,
      JSON.stringify(coachSummary.keyInsights),
      coachSummary.recommendation,
      pauseBreakdown.steadyPaceSecKm,
      pauseBreakdown.steadyHeartRate,
      pauseBreakdown.steadyCadence,
      pauseBreakdown.steadyStanceTimeMs,
      JSON.stringify(pauseBreakdown),
      JSON.stringify(coachSummary.scoreBreakdown)
    );

    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(activityId) as any;
    if (row) {
      const scoreVal = row.effectiveness_score;
      const starsVal = scoreVal >= 85 ? 3 : scoreVal >= 70 ? 2 : 1;
      return {
        headline: row.headline,
        effectivenessScore: scoreVal,
        rating5: Number((scoreVal / 20).toFixed(1)),
        stars: starsVal,
        keyInsights: JSON.parse(row.key_insights_json || '[]'),
        recommendation: row.recommendation,
        scoreBreakdown: row.score_breakdown_json ? JSON.parse(row.score_breakdown_json) : coachSummary.scoreBreakdown,
        updatedAt: row.updated_at,
        steadyPaceSecKm: row.steady_pace_sec_km,
        steadyHeartRate: row.steady_heart_rate,
        steadyCadence: row.steady_cadence,
        steadyStanceTime: row.steady_stance_time,
        pauseBreakdown: row.pause_breakdown_json ? JSON.parse(row.pause_breakdown_json) : pauseBreakdown
      };
    }
  } catch (err) {
    // Non-fatal if table not ready
  }

  return coachSummary;
}

/**
 * Re-evaluates and updates all coach summaries across all activities.
 * Useful when athlete profile thresholds, gear, or baseline changes.
 */
export function syncAllCoachSummaries(db: any): number {
  const activities = db.prepare('SELECT id FROM activities').all() as Array<{ id: string }>;
  let count = 0;
  for (const act of activities) {
    if (syncActivityCoachSummary(db, act.id)) {
      count++;
    }
  }
  return count;
}

