import { getAthleteHeartRateProfile } from '../physiology/athlete-profile.js';
import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { calculateRacePredictions } from '../physiology/predictions.js';
import { getCurrentThresholds } from '../physiology/threshold-tracker.js';
import { getDefaultZones } from '../physiology/zones.js';

export const thresholdsRouter = Router();

// GET /api/thresholds - returns LT1/LT2 timeline, pace-dependent economy curves, and race predictions
thresholdsRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const runTypeFilter = req.query.run_type as string | undefined;

    const history = db.prepare(`
      SELECT
        p.*,
        a.name as activity_name,
        a.distance_meters,
        a.duration_seconds
      FROM physiological_thresholds p
      LEFT JOIN activities a ON p.source_activity_id = a.id
      ORDER BY p.effective_date DESC
    `).all();

    const currentThresholds = getCurrentThresholds(db);
    const hrProfile = getAthleteHeartRateProfile(db);
    const zones = getDefaultZones(hrProfile.maxHr, currentThresholds.lt1Hr, currentThresholds.lt2Hr, hrProfile.restingHr);

    // Latest LT1 & LT2
    const latestLt1Row = db.prepare(`
      SELECT lt1_hr, lt1_pace_sec_km, effective_date, baseline_economy_ef
      FROM physiological_thresholds
      WHERE lt1_hr IS NOT NULL
      ORDER BY effective_date DESC, id DESC
      LIMIT 1
    `).get() as { lt1_hr: number; lt1_pace_sec_km: number; effective_date: string; baseline_economy_ef: number } | undefined;

    const latestLt2Row = db.prepare(`
      SELECT lt2_hr, lt2_pace_sec_km, effective_date
      FROM physiological_thresholds
      WHERE lt2_hr IS NOT NULL
      ORDER BY effective_date DESC, id DESC
      LIMIT 1
    `).get() as { lt2_hr: number; lt2_pace_sec_km: number; effective_date: string } | undefined;

    const latestLt1Pace = latestLt1Row?.lt1_pace_sec_km ?? currentThresholds.lt1PaceSecKm;
    const latestLt2Pace = latestLt2Row?.lt2_pace_sec_km ?? currentThresholds.lt2PaceSecKm;

    const latestLt1 = latestLt1Row ? {
      ...latestLt1Row,
      lt1_hr: currentThresholds.lt1Hr,
      lt1_pace_sec_km: currentThresholds.lt1PaceSecKm || latestLt1Row.lt1_pace_sec_km,
      is_estimated: false
    } : {
      lt1_hr: currentThresholds.lt1Hr,
      lt1_pace_sec_km: currentThresholds.lt1PaceSecKm,
      effective_date: currentThresholds.lastCalibratedDate || 'Baseline',
      baseline_economy_ef: null,
      is_estimated: !currentThresholds.lt1PaceSecKm
    };

    // Average overall pace from recent runs for prediction baseline
    const avgRecent = db.prepare(`
      SELECT AVG(avg_pace_sec_km) as avg_pace
      FROM activities
      WHERE avg_pace_sec_km IS NOT NULL
    `).get() as { avg_pace: number | null } | undefined;

    // If LT2 has not been calibrated through a threshold workout or race:
    // Estimate LT2 pace based on aerobic turnpoint mechanics (~86% of LT1 pace),
    // or from recent overall running pace.
    let effectiveLt2Pace: number | null = currentThresholds.lt2PaceSecKm || latestLt2Pace;
    let isLt2Estimated = false;

    if (!effectiveLt2Pace) {
      if (latestLt1Pace) {
        effectiveLt2Pace = Math.round(latestLt1Pace * 0.86);
        isLt2Estimated = true;
      } else if (avgRecent?.avg_pace) {
        effectiveLt2Pace = Math.round(avgRecent.avg_pace * 0.88);
        isLt2Estimated = true;
      }
    }

    const latestLt2 = latestLt2Row ? {
      ...latestLt2Row,
      lt2_hr: currentThresholds.lt2Hr,
      lt2_pace_sec_km: currentThresholds.lt2PaceSecKm || effectiveLt2Pace,
      is_estimated: false
    } : {
      lt2_hr: currentThresholds.lt2Hr,
      lt2_pace_sec_km: effectiveLt2Pace,
      effective_date: isLt2Estimated ? (latestLt1Pace ? 'Estimated from LT1' : 'Estimated from Recent Runs') : (currentThresholds.lastCalibratedDate || 'Baseline'),
      is_estimated: isLt2Estimated
    };

    // Check for proven 5K benchmark (from actual 5k time trial / race or profile PB)
    let benchmark5kPace: number | null = null;
    const race5kAct = db.prepare(`
      SELECT a.id, a.duration_seconds, a.distance_meters, a.avg_pace_sec_km
      FROM activities a
      WHERE (a.run_type = 'race' AND a.distance_meters BETWEEN 4500 AND 5500)
         OR (a.distance_meters BETWEEN 4500 AND 5500 AND (a.name LIKE '%5k%' OR a.name LIKE '%5 km%' OR a.name LIKE '%Time Trial%'))
         OR ((a.name LIKE '%5k%' OR a.name LIKE '%5 km%') AND a.distance_meters <= 10000)
      ORDER BY a.start_time DESC
      LIMIT 1
    `).get() as any;

    if (race5kAct) {
      const workInv = db.prepare(`
        SELECT avg_pace_sec_km FROM activity_intervals WHERE activity_id = ? AND type = 'work' AND duration_seconds >= 600 ORDER BY avg_speed_mps DESC LIMIT 1
      `).get(race5kAct.id) as any;
      if (workInv?.avg_pace_sec_km) {
        benchmark5kPace = workInv.avg_pace_sec_km;
      } else if (race5kAct.avg_pace_sec_km) {
        benchmark5kPace = race5kAct.avg_pace_sec_km;
      }
    }

    if (!benchmark5kPace) {
      const profile = db.prepare("SELECT pb_5k FROM athlete_profile WHERE id = 'primary'").get() as any;
      if (profile?.pb_5k) {
        const match = profile.pb_5k.match(/(\d{1,2}):(\d{2})/);
        if (match) {
          const totalSec = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
          benchmark5kPace = Math.round(totalSec / 5);
        } else {
          const minMatch = profile.pb_5k.match(/(\d{1,2})\s*(?:min|m)?/i);
          if (minMatch && parseInt(minMatch[1], 10) >= 12 && parseInt(minMatch[1], 10) <= 60) {
            benchmark5kPace = Math.round((parseInt(minMatch[1], 10) * 60) / 5);
          }
        }
      }
    }

    // Race predictions
    const predictionsResult = calculateRacePredictions(
      latestLt2?.lt2_pace_sec_km ?? null,
      latestLt1?.lt1_pace_sec_km ?? null,
      avgRecent?.avg_pace ?? null,
      benchmark5kPace
    );

    // Pace-dependent economy curves:
    // 1. Filtered timeline
    let query = `
      SELECT
        id, start_time, name, run_type, efficiency_factor,
        meters_per_beat, aerobic_decoupling_pct, avg_pace_sec_km, avg_heart_rate
      FROM activities
      WHERE efficiency_factor IS NOT NULL
    `;
    const params: any[] = [];

    if (runTypeFilter && runTypeFilter !== 'all') {
      if (runTypeFilter === 'easy') {
        query += ` AND (run_type = 'easy_base' OR run_type = 'long_run')`;
      } else if (runTypeFilter === 'threshold') {
        query += ` AND (run_type = 'threshold_lt2' OR run_type = 'intervals_vo2')`;
      } else {
        query += ` AND run_type = ?`;
        params.push(runTypeFilter);
      }
    }
    query += ` ORDER BY start_time ASC`;

    const economyTrend = db.prepare(query).all(...params);

    // 2. Scatter data for Pace vs Efficiency Factor / HR curve
    const scatterData = db.prepare(`
      SELECT
        id, start_time, name, run_type,
        avg_pace_sec_km, avg_heart_rate, efficiency_factor, meters_per_beat
      FROM activities
      WHERE avg_pace_sec_km IS NOT NULL
        AND avg_heart_rate IS NOT NULL
        AND efficiency_factor IS NOT NULL
      ORDER BY avg_pace_sec_km ASC
    `).all();

    res.json({
      latest: {
        lt1: latestLt1 || null,
        lt2: latestLt2 || null,
        vo2Max: predictionsResult.vo2Max
      },
      currentThresholds,
      zones,
      predictions: predictionsResult.predictions,
      history,
      economyTrend,
      scatterData
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
