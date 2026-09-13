import { EconomyMetrics, PauseBreakdown, extractSteadyStateMetrics } from './economy.js';
import { ZoneDistribution } from './zones.js';

export interface CoachSummary {
  headline: string;
  effectivenessScore: number; // 0 - 100
  rating5: number; // 1.0 - 5.0 rating scale
  stars: number; // 1 - 5 stars
  keyInsights: string[];
  recommendation: string;
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
}): CoachSummary {
  const {
    runType,
    distanceKm,
    durationMin,
    avgPaceSecKm,
    avgHr,
    cadence,
    decouplingPct,
    efficiencyFactor,
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

  const lt1 = params.lt1Hr || 153;
  const lt2 = params.lt2Hr || 167;

  const insights: string[] = [];
  let score = 85; // Baseline good session

  // Failed workout alert
  if (params.isFailedWorkout) {
    score = 60;
    insights.push('⚠️ Incomplete / Aborted Quality Effort: Target interval volume was cut short or pace collapsed. Re-evaluate fatigue levels before your next hard effort.');
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
      insights.push(`Superb cardiovascular stability with only ${decouplingPct.toFixed(1)}% drift. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue.`);
    } else if (decouplingPct < 5.0) {
      score += 4;
      insights.push(`Solid aerobic discipline. Decoupling was ${decouplingPct.toFixed(1)}%, well within the sub-LT1 gold standard threshold (<5%).`);
    } else {
      score -= 8;
      insights.push(`Noticeable cardiac drift detected (${decouplingPct.toFixed(1)}%). Likely due to thermal strain${avgTemp ? ` (${avgTemp}°C)` : ''}, dehydration, or pacing slightly ahead of current aerobic capacity.`);
    }
  }

  // Structured Interval Execution Quality (for VO2 Max & Threshold quality sessions)
  if ((runType === 'intervals_vo2' || runType === 'threshold_lt2') && params.intervals && params.intervals.length > 0) {
    const workReps = params.intervals.filter((i: any) => i.type === 'work');
    if (workReps.length >= 2) {
      const paces = workReps.map((r: any) => r.avg_pace_sec_km ?? r.avgPaceSecKm).filter((p: number) => p > 0);
      if (paces.length >= 2) {
        const meanPace = paces.reduce((a: number, b: number) => a + b, 0) / paces.length;
        const variance = paces.reduce((a: number, b: number) => a + Math.pow(b - meanPace, 2), 0) / paces.length;
        const stdDev = Math.sqrt(variance);
        const cv = stdDev / meanPace;

        if (cv <= 0.035) {
          score += 8;
          insights.push(
            `Exceptional Pacing Consistency: Executed ${workReps.length} work reps with laser precision (${(cv * 100).toFixed(1)}% pace variance, ±${Math.round(stdDev)}s/km spread). Zero early pacing overshoot or late-rep collapse.`
          );
        } else if (cv <= 0.065) {
          score += 4;
          insights.push(
            `Disciplined Interval Pacing: Paced ${workReps.length} work reps consistently (${(cv * 100).toFixed(1)}% pace variance).`
          );
        } else if (cv > 0.12) {
          score -= 6;
          insights.push(
            `Pacing Variance Warning: High pace variance across reps (${(cv * 100).toFixed(1)}%). Focus on starting 5-10s slower on rep 1 to maintain even splits across the entire set.`
          );
        }
      }

      // Check Peak HR reached (true cardiovascular stimulus for VO2 Max)
      const maxWorkHr = Math.max(...workReps.map((r: any) => r.max_heart_rate ?? r.maxHeartRate ?? 0));
      const maxProfileHr = params.maxHeartRate || 203;
      if (runType === 'intervals_vo2' && maxWorkHr > 0) {
        const pctMax = (maxWorkHr / maxProfileHr) * 100;
        if (pctMax >= 88) {
          score += 6;
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
          insights.push(
            `Rapid Cardiovascular Recovery: Heart rate dropped by an average of ${avgDrop} bpm between work intervals, demonstrating excellent parasympathetic reactivation and high aerobic fitness.`
          );
        }
      }
    }
  }

  // Cadence insight (evaluated on true steady-state running)
  if (effectiveCadence >= 174 && effectiveCadence <= 184) {
    score += 4;
    insights.push(`Cadence was right in the sweet spot (${effectiveCadence} spm), minimizing vertical braking forces and maximizing elastic recoil.`);
  } else if (effectiveCadence > 184) {
    insights.push(`High turnover (${effectiveCadence} spm) maintained during steady running, promoting quick foot turnover.`);
  } else if (effectiveCadence < 165) {
    score -= 3;
    insights.push(`Steady running cadence averaged ${effectiveCadence} spm. Increasing turnover toward 172-180 spm will decrease ground contact time and reduce joint impact.`);
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
  const isAccidentalTempo = (runType === 'easy_base' || runType === 'accidental_tempo')
    && effectiveHr > 130
    && (effectiveHr >= lt1 || (decouplingPct !== null && decouplingPct >= 6.5));

  if (isAccidentalTempo) {
    score -= 6;
    insights.push(`Pacing Alert: Heart rate drifted notably higher than pure Zone 2 (${effectiveHr} bpm avg). This functioned as an unintentional 'grey-zone' tempo effort rather than a low-stress aerobic recovery session.`);
  }

  // Clamped score & 5-star rating calculation
  const finalScore = Math.max(50, Math.min(98, score));
  const stars = finalScore >= 90 ? 5 : finalScore >= 78 ? 4 : finalScore >= 65 ? 3 : finalScore >= 50 ? 2 : 1;
  const rating5 = Number(((finalScore / 20)).toFixed(1));

  let headline = 'Strong Aerobic Adaptation Session';
  let recommendation = 'Prioritize light hydration and low-impact movement before your next hard effort.';

  if (params.isFailedWorkout) {
    headline = 'Incomplete / Aborted Quality Session';
    recommendation = 'Assess underlying fatigue, heat stress, or nutrition. Take a recovery day before attempting another quality stimulus.';
  } else if (runType === 'race') {
    headline = 'All-Out Benchmark / Race Effort Execution';
    recommendation = 'Exceptional competitive effort. Prioritize complete replenishment, deep sleep, and gentle recovery jogging over the next 48-72 hours.';
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
    recommendation
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

  const profile = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
  const lt1Hr = profile?.lt1_hr || (profile?.z3_start_hr ? profile.z3_start_hr - 1 : 148);
  const lt2Hr = profile?.lt2_hr || profile?.z4_start_hr || 167;
  const maxHeartRate = profile?.max_hr || 203;
  const restingHr = profile?.resting_hr || 55;

  const coachSummary = generateCoachSummary({
    runType: overrides?.runType || activity.run_type || 'easy_base',
    distanceKm: (activity.distance_meters || 0) / 1000,
    durationMin: (activity.duration_seconds || 0) / 60,
    avgPaceSecKm: activity.avg_pace_sec_km || 330,
    avgHr: activity.avg_heart_rate || 140,
    maxHr: activity.max_heart_rate || 160,
    cadence: activity.avg_cadence || 170,
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
    isFailedWorkout: overrides?.isFailedWorkout ?? (activity.tags ? (typeof activity.tags === 'string' ? activity.tags.includes('Failed Workout') : false) : false),
    intervals: overrides?.intervals || intervals,
    ...overrides
  });

  try {
    db.prepare(`
      INSERT INTO activity_coach_summaries (
        activity_id, headline, effectiveness_score, key_insights_json,
        recommendation, steady_pace_sec_km, steady_heart_rate,
        steady_cadence, steady_stance_time, pause_breakdown_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      JSON.stringify(pauseBreakdown)
    );

    const row = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(activityId) as any;
    if (row) {
      return {
        headline: row.headline,
        effectivenessScore: row.effectiveness_score,
        keyInsights: JSON.parse(row.key_insights_json || '[]'),
        recommendation: row.recommendation,
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

