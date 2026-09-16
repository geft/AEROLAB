import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { generateCoachSummary, syncActivityCoachSummary } from '../physiology/coach-summary.js';
import { extractSteadyStateMetrics } from '../physiology/economy.js';
import { syncActivityWeather } from '../physiology/weather.js';

export const activitiesRouter = Router();

// GET /api/activities/volume - aggregated effort and volume metrics
activitiesRouter.get('/volume', (req, res) => {
  try {
    const db = getDatabase();
    const period = (req.query.period as string) || 'month'; // 'week' | 'month' | 'year' | 'all'
    const targetMonth = req.query.month as string | undefined; // e.g. '2026-09'
    const targetYear = req.query.year as string | undefined; // e.g. '2026'

    const profile = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get() as any;
    const lt1Hr = profile?.lt1_hr || 153;
    const lt2Hr = profile?.lt2_hr || 167;
    const maxHr = profile?.max_hr || 203;

    let query = `SELECT id, start_time, distance_meters, duration_seconds, elevation_gain_m, efficiency_factor, run_type FROM activities WHERE 1=1`;
    const params: any[] = [];

    if (targetMonth) {
      query += ` AND start_time LIKE ?`;
      params.push(`${targetMonth}%`);
    } else if (targetYear) {
      query += ` AND start_time LIKE ?`;
      params.push(`${targetYear}%`);
    } else if (period === 'week') {
      query += ` AND start_time >= datetime('now', '-7 days')`;
    } else if (period === 'month') {
      query += ` AND start_time >= datetime('now', '-30 days')`;
    } else if (period === 'year') {
      query += ` AND start_time >= datetime('now', '-365 days')`;
    }

    query += ` ORDER BY start_time DESC`;
    let acts = db.prepare(query).all(...params) as any[];

    // Fallback if period=month returned 0 activities because dataset is historical
    if (acts.length === 0 && !targetMonth && !targetYear && period === 'month') {
      const latestAct = db.prepare('SELECT start_time FROM activities ORDER BY start_time DESC LIMIT 1').get() as any;
      if (latestAct?.start_time) {
        const fallbackMonth = latestAct.start_time.substring(0, 7);
        acts = db.prepare(`SELECT id, start_time, distance_meters, duration_seconds, elevation_gain_m, efficiency_factor, run_type FROM activities WHERE start_time LIKE ? ORDER BY start_time DESC`).all(`${fallbackMonth}%`) as any[];
      }
    }

    let totalDistM = 0;
    let totalDurSec = 0;
    let totalElevM = 0;
    let efSum = 0;
    let efCount = 0;
    let z1z2Sec = 0;
    let z3Sec = 0;
    let z4Sec = 0;
    let z5Sec = 0;

    for (const a of acts) {
      totalDistM += a.distance_meters || 0;
      totalDurSec += a.duration_seconds || 0;
      totalElevM += a.elevation_gain_m || 0;
      if (a.efficiency_factor) {
        efSum += a.efficiency_factor;
        efCount++;
      }

      const recs = db.prepare('SELECT elapsed_seconds, heart_rate FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id) as any[];
      for (let i = 1; i < recs.length; i++) {
        const dt = Math.max(0, Math.min(10, recs[i].elapsed_seconds - recs[i - 1].elapsed_seconds));
        const hr = recs[i].heart_rate;
        if (!hr) continue;
        if (hr < lt1Hr) z1z2Sec += dt;
        else if (hr < lt2Hr) z3Sec += dt;
        else if (hr < maxHr * 0.92) z4Sec += dt;
        else z5Sec += dt;
      }
    }

    const totalHrSec = z1z2Sec + z3Sec + z4Sec + z5Sec;
    const periodLabels: Record<string, string> = {
      week: 'Past 7 Days',
      month: 'Past 30 Days',
      year: 'Past 365 Days',
      all: 'All-Time Total'
    };

    const z2HoursVal = Number((z1z2Sec / 3600).toFixed(1));
    const z2PctVal = totalHrSec > 0 ? Math.round((z1z2Sec / totalHrSec) * 100) : 0;
    const z3HoursVal = Number((z3Sec / 3600).toFixed(1));
    const z3PctVal = totalHrSec > 0 ? Math.round((z3Sec / totalHrSec) * 100) : 0;
    const z4HoursVal = Number((z4Sec / 3600).toFixed(1));
    const z4PctVal = totalHrSec > 0 ? Math.round((z4Sec / totalHrSec) * 100) : 0;
    const z5HoursVal = Number((z5Sec / 3600).toFixed(1));
    const z5PctVal = totalHrSec > 0 ? Math.round((z5Sec / totalHrSec) * 100) : 0;

    const summary = {
      period,
      periodLabel: targetMonth ? `Month: ${targetMonth}` : (periodLabels[period] || 'Effort Aggregation'),
      count: acts.length,
      activityCount: acts.length,
      distanceKm: Number((totalDistM / 1000).toFixed(1)),
      totalDistanceKm: Number((totalDistM / 1000).toFixed(1)),
      durationHours: Number((totalDurSec / 3600).toFixed(1)),
      totalDurationHours: Number((totalDurSec / 3600).toFixed(1)),
      elevationGainM: Math.round(totalElevM),
      totalElevationGainM: Math.round(totalElevM),
      avgEf: efCount > 0 ? Number((efSum / efCount).toFixed(2)) : null,
      zones: {
        z1: { hours: 0, pct: 0 },
        z2: { hours: z2HoursVal, pct: z2PctVal },
        z3: { hours: z3HoursVal, pct: z3PctVal },
        z4: { hours: z4HoursVal, pct: z4PctVal },
        z5: { hours: z5HoursVal, pct: z5PctVal },
        z2Hours: z2HoursVal,
        z2Pct: z2PctVal,
        z3Hours: z3HoursVal,
        z3Pct: z3PctVal,
        z4Hours: z4HoursVal,
        z4Pct: z4PctVal,
        z5Hours: z5HoursVal,
        z5Pct: z5PctVal
      }
    };

    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/progress-history - monthly and yearly longitudinal progress
activitiesRouter.get('/progress-history', (req, res) => {
  try {
    const db = getDatabase();
    const profile = db.prepare("SELECT * FROM athlete_profile WHERE id = 'primary'").get() as any;
    const lt1Hr = profile?.lt1_hr || 153;
    const runTypeFilter = (req.query.run_type as string) || 'all'; // 'all' | 'easy' | 'threshold'

    let actQuery = `
      SELECT
        id, start_time, name, run_type, distance_meters, duration_seconds,
        avg_pace_sec_km, avg_heart_rate, efficiency_factor, elevation_gain_m,
        aerobic_decoupling_pct
      FROM activities
      WHERE 1=1
    `;
    const params: any[] = [];

    if (runTypeFilter === 'easy') {
      actQuery += ` AND (run_type = 'easy_base' OR run_type = 'long_run')`;
    } else if (runTypeFilter === 'threshold') {
      actQuery += ` AND (run_type = 'threshold_lt2' OR run_type = 'intervals_vo2' OR run_type = 'tempo' OR run_type = 'race')`;
    }

    actQuery += ` ORDER BY start_time ASC`;

    // Fetch activities in chronological order
    const acts = db.prepare(actQuery).all(...params) as any[];

    // Fetch all threshold calibrations
    const thresholds = db.prepare(`
      SELECT p.*, a.name as activity_name
      FROM physiological_thresholds p
      LEFT JOIN activities a ON p.source_activity_id = a.id
      ORDER BY p.effective_date ASC
    `).all() as any[];

    // Group activities by Month (YYYY-MM) and Year (YYYY)
    const monthMap = new Map<string, any>();
    const yearMap = new Map<string, any>();

    for (const a of acts) {
      const dateStr = a.start_time || '';
      const ym = dateStr.substring(0, 7); // e.g. "2026-09"
      const yr = dateStr.substring(0, 4); // e.g. "2026"
      if (!ym || ym.length < 7) continue;

      // Month aggregation
      if (!monthMap.has(ym)) {
        const dObj = new Date(`${ym}-01`);
        const label = isNaN(dObj.getTime())
          ? ym
          : dObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        monthMap.set(ym, {
          period: ym,
          label,
          type: 'month',
          runCount: 0,
          totalDistanceM: 0,
          totalDurationSec: 0,
          totalElevationM: 0,
          efSum: 0,
          efCount: 0,
          paceSum: 0,
          paceCount: 0,
          hrSum: 0,
          hrCount: 0,
          z2Sec: 0,
          totalHrSec: 0,
          runs: []
        });
      }

      // Year aggregation
      if (!yearMap.has(yr)) {
        yearMap.set(yr, {
          period: yr,
          label: `${yr} Season`,
          type: 'year',
          runCount: 0,
          totalDistanceM: 0,
          totalDurationSec: 0,
          totalElevationM: 0,
          efSum: 0,
          efCount: 0,
          paceSum: 0,
          paceCount: 0,
          hrSum: 0,
          hrCount: 0,
          activeMonthsSet: new Set<string>(),
          runs: []
        });
      }

      const m = monthMap.get(ym)!;
      const y = yearMap.get(yr)!;

      m.runCount++;
      m.totalDistanceM += a.distance_meters || 0;
      m.totalDurationSec += a.duration_seconds || 0;
      m.totalElevationM += a.elevation_gain_m || 0;
      if (a.efficiency_factor) { m.efSum += a.efficiency_factor; m.efCount++; }
      if (a.avg_pace_sec_km) { m.paceSum += a.avg_pace_sec_km; m.paceCount++; }
      if (a.avg_heart_rate) { m.hrSum += a.avg_heart_rate; m.hrCount++; }
      m.runs.push(a.id);

      y.runCount++;
      y.totalDistanceM += a.distance_meters || 0;
      y.totalDurationSec += a.duration_seconds || 0;
      y.totalElevationM += a.elevation_gain_m || 0;
      if (a.efficiency_factor) { y.efSum += a.efficiency_factor; y.efCount++; }
      if (a.avg_pace_sec_km) { y.paceSum += a.avg_pace_sec_km; y.paceCount++; }
      if (a.avg_heart_rate) { y.hrSum += a.avg_heart_rate; y.hrCount++; }
      y.activeMonthsSet.add(ym);
      y.runs.push(a.id);

      // Heart rate zone 2 accumulation
      const recs = db.prepare('SELECT elapsed_seconds, heart_rate FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(a.id) as any[];
      for (let i = 1; i < recs.length; i++) {
        const dt = Math.max(0, Math.min(10, recs[i].elapsed_seconds - recs[i - 1].elapsed_seconds));
        const hr = recs[i].heart_rate;
        if (!hr) continue;
        m.totalHrSec += dt;
        if (hr <= lt1Hr) {
          m.z2Sec += dt;
        }
      }
    }

    // Format months array
    const months = Array.from(monthMap.values()).map(m => {
      const avgEf = m.efCount > 0 ? Number((m.efSum / m.efCount).toFixed(2)) : null;
      const avgPace = m.paceCount > 0 ? Math.round(m.paceSum / m.paceCount) : null;
      const avgHr = m.hrCount > 0 ? Math.round(m.hrSum / m.hrCount) : null;
      const z2Hours = Number((m.z2Sec / 3600).toFixed(1));
      const z2Pct = m.totalHrSec > 0 ? Math.round((m.z2Sec / m.totalHrSec) * 100) : 0;
      const periodCalibrations = thresholds.filter(t => t.effective_date?.startsWith(m.period));

      return {
        period: m.period,
        label: m.label,
        runCount: m.runCount,
        totalDistanceKm: Number((m.totalDistanceM / 1000).toFixed(1)),
        totalDurationHours: Number((m.totalDurationSec / 3600).toFixed(1)),
        totalElevationM: Math.round(m.totalElevationM),
        avgEfficiencyFactor: avgEf,
        avgPaceSecKm: avgPace,
        avgHeartRate: avgHr,
        zone2Hours: z2Hours,
        zone2Pct: z2Pct,
        calibrations: periodCalibrations
      };
    });

    // Format years array
    const years = Array.from(yearMap.values()).map(y => {
      const avgEf = y.efCount > 0 ? Number((y.efSum / y.efCount).toFixed(2)) : null;
      const avgPace = y.paceCount > 0 ? Math.round(y.paceSum / y.paceCount) : null;
      const avgHr = y.hrCount > 0 ? Math.round(y.hrSum / y.hrCount) : null;
      const periodCalibrations = thresholds.filter(t => t.effective_date?.startsWith(y.period));

      return {
        period: y.period,
        label: y.label,
        runCount: y.runCount,
        activeMonths: y.activeMonthsSet.size,
        totalDistanceKm: Number((y.totalDistanceM / 1000).toFixed(1)),
        totalDurationHours: Number((y.totalDurationSec / 3600).toFixed(1)),
        totalElevationM: Math.round(y.totalElevationM),
        avgEfficiencyFactor: avgEf,
        avgPaceSecKm: avgPace,
        avgHeartRate: avgHr,
        calibrations: periodCalibrations
      };
    });

    res.json({ months, years });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities - list all runs
activitiesRouter.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const typeFilter = req.query.type as string | undefined;

    let query = `
      SELECT
        a.id, a.start_time, a.name, a.run_type, a.auto_run_type,
        a.distance_meters, a.duration_seconds, a.avg_pace_sec_km,
        a.avg_heart_rate, a.max_heart_rate, a.avg_cadence, a.calories,
        a.elevation_gain_m, a.avg_temperature, a.avg_vertical_oscillation,
        a.avg_stance_time, a.efficiency_factor, a.aerobic_decoupling_pct,
        a.meters_per_beat, a.tags,
        a.steady_pace_sec_km, a.steady_heart_rate, a.steady_cadence,
        a.steady_stance_time, a.pause_duration_seconds, a.walk_duration_seconds,
        a.walk_distance_meters,
        a.weather_temperature_c, a.weather_humidity_pct, a.weather_apparent_temp_c,
        a.weather_condition, a.weather_code, a.weather_fetched_at,
        a.workout_lat, a.workout_lon,
        cs.effectiveness_score
      FROM activities a
      LEFT JOIN activity_coach_summaries cs ON a.id = cs.activity_id
    `;

    const params: any[] = [];
    if (typeFilter) {
      query += ` WHERE a.run_type = ?`;
      params.push(typeFilter);
    }
    query += ` ORDER BY a.start_time DESC`;

    const activities = db.prepare(query).all(...params);
    res.json({ activities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/:id - deep dive into individual run
activitiesRouter.get('/:id', async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    let activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as any;
    if (!activity) {
      return res.status(404).json({ error: 'Activity not found' });
    }

    // Auto-fetch microclimate weather if coordinates exist but weather has not been fetched yet
    if (activity.weather_temperature_c === null && activity.workout_lat && activity.workout_lon) {
      await syncActivityWeather(db, id);
      activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as any;
    }

    const splits = db.prepare('SELECT * FROM activity_splits WHERE activity_id = ? ORDER BY split_index ASC').all(id);
    const intervals = db.prepare('SELECT * FROM activity_intervals WHERE activity_id = ? ORDER BY interval_index ASC').all(id);
    const rawRecords = db.prepare('SELECT * FROM activity_records WHERE activity_id = ? ORDER BY elapsed_seconds ASC').all(id) as any[];

    // Auto-repair flat or corrupted speed telemetry (e.g. FIT records where speed was saved as static cumulative average)
    const records = [...rawRecords];
    if (records.length >= 20) {
      const validSpeeds = records.map(r => r.speed_mps).filter((s): s is number => s !== null && s > 0);
      const hasDistances = records.filter(r => r.distance_m !== null && r.distance_m > 0).length >= 20;
      let isBrokenSpeed = false;
      if (validSpeeds.length >= 20) {
        const minS = Math.min(...validSpeeds);
        const maxS = Math.max(...validSpeeds);
        if (maxS - minS < 0.15 && minS > 1.0) {
          isBrokenSpeed = true;
        }
      } else if (validSpeeds.length === 0 && hasDistances) {
        isBrokenSpeed = true;
      }

      if (isBrokenSpeed && hasDistances) {
        const windowSec = 5;
        for (let i = 0; i < records.length; i++) {
          const cur = records[i];
          if (cur.distance_m === null) continue;
          let prevIdx = i;
          while (prevIdx > 0 && cur.elapsed_seconds - records[prevIdx].elapsed_seconds < windowSec) {
            prevIdx--;
          }
          let nextIdx = i;
          while (nextIdx < records.length - 1 && records[nextIdx].elapsed_seconds - cur.elapsed_seconds < windowSec) {
            nextIdx++;
          }
          const prev = records[prevIdx];
          const next = records[nextIdx];
          if (prev.distance_m !== null && next.distance_m !== null) {
            const dt = next.elapsed_seconds - prev.elapsed_seconds;
            const dd = next.distance_m - prev.distance_m;
            if (dt >= 2 && dd >= 0) {
              const derived = dd / dt;
              cur.speed_mps = Number(Math.max(0, Math.min(9.0, derived)).toFixed(3));
            }
          }
        }
      }
    }

    // Isolate walk breaks and traffic pauses to obtain pure steady-state running metrics
    const pauseBreakdown = extractSteadyStateMetrics(records);

    // Retrieve athlete profile for calibrated thresholds (defaulting to runner profile)
    const profile = db.prepare('SELECT * FROM athlete_profile WHERE id = ?').get('primary') as any;
    const lt1Hr = profile?.lt1_hr || (profile?.z3_start_hr ? profile.z3_start_hr - 1 : 148);
    const lt2Hr = profile?.lt2_hr || profile?.z4_start_hr || 167;
    const maxHeartRate = profile?.max_hr || 203;
    const restingHr = profile?.resting_hr || 55;

    // Generate, persist, and retrieve from activity_coach_summaries table
    const coachSummary = syncActivityCoachSummary(db, id) || generateCoachSummary({
      runType: (activity as any).run_type || 'easy_base',
      distanceKm: ((activity as any).distance_meters || 0) / 1000,
      durationMin: ((activity as any).duration_seconds || 0) / 60,
      avgPaceSecKm: (activity as any).avg_pace_sec_km || 330,
      avgHr: (activity as any).avg_heart_rate || 140,
      maxHr: (activity as any).max_heart_rate || 160,
      cadence: (activity as any).avg_cadence || 170,
      decouplingPct: (activity as any).aerobic_decoupling_pct ?? null,
      efficiencyFactor: (activity as any).efficiency_factor ?? null,
      avgTemp: (activity as any).avg_temperature ?? null,
      groundContactTime: (activity as any).avg_stance_time ?? null,
      elevationGainM: (activity as any).elevation_gain_m ?? null,
      steadyPaceSecKm: pauseBreakdown.steadyPaceSecKm || (activity as any).steady_pace_sec_km || null,
      steadyHr: pauseBreakdown.steadyHeartRate || (activity as any).steady_heart_rate || null,
      steadyCadence: pauseBreakdown.steadyCadence || (activity as any).steady_cadence || null,
      steadyStanceTime: pauseBreakdown.steadyStanceTimeMs || (activity as any).steady_stance_time || null,
      pauseBreakdown,
      lt1Hr,
      lt2Hr,
      maxHeartRate,
      restingHr
    });

    res.json({
      activity: {
        ...(activity as any),
        steady_pace_sec_km: pauseBreakdown.steadyPaceSecKm || (activity as any).steady_pace_sec_km,
        steady_heart_rate: pauseBreakdown.steadyHeartRate || (activity as any).steady_heart_rate,
        steady_cadence: pauseBreakdown.steadyCadence || (activity as any).steady_cadence,
        steady_stance_time: pauseBreakdown.steadyStanceTimeMs || (activity as any).steady_stance_time,
        pause_duration_seconds: pauseBreakdown.stopDurationSeconds,
        walk_duration_seconds: pauseBreakdown.walkDurationSeconds,
        walk_distance_meters: pauseBreakdown.walkDistanceMeters
      },
      splits,
      intervals,
      records,
      coachSummary,
      pauseBreakdown
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


export const ALLOWED_TAGS = [
  'Easy Base',
  'Long Run',
  'Recovery',
  'Threshold',
  'VO2 Max',
  'Tempo',
  'Marathon Pace',
  'Strides',
  'Race'
];

// PATCH /api/activities/:id - manual override for run_type or notes
activitiesRouter.patch('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const { run_type, notes, name, tags } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (run_type) {
      updates.push('run_type = ?');
      params.push(run_type);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    if (name) {
      updates.push('name = ?');
      params.push(name);
    }
    if (tags !== undefined) {
      let tagList: string[] = [];
      if (Array.isArray(tags)) {
        tagList = tags;
      } else if (typeof tags === 'string') {
        try {
          const parsed = JSON.parse(tags);
          tagList = Array.isArray(parsed) ? parsed : [tags];
        } catch {
          tagList = [tags];
        }
      }

      const invalidTags = tagList.filter(t => !ALLOWED_TAGS.includes(t));
      if (invalidTags.length > 0) {
        return res.status(400).json({
          error: `Invalid tags: ${invalidTags.join(', ')}. Only existing tags are allowed (${ALLOWED_TAGS.join(', ')}).`
        });
      }

      updates.push('tags = ?');
      params.push(JSON.stringify(tagList));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);
    db.prepare(`UPDATE activities SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Continuous update: re-evaluate and persist coach summary into activity_coach_summaries
    const coachSummary = syncActivityCoachSummary(db, id, run_type ? { runType: run_type } : undefined);

    const updated = db.prepare('SELECT * FROM activities WHERE id = ?').get(id);
    res.json({ activity: updated, coachSummary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/:id/coach-summary - retrieve persistent coach summary from table
activitiesRouter.get('/:id/coach-summary', (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    let coachRow = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(id) as any;
    if (!coachRow) {
      syncActivityCoachSummary(db, id);
      coachRow = db.prepare('SELECT * FROM activity_coach_summaries WHERE activity_id = ?').get(id) as any;
    }
    if (!coachRow) {
      return res.status(404).json({ error: 'Coach summary not found' });
    }
    res.json({
      coachSummary: {
        headline: coachRow.headline,
        effectivenessScore: coachRow.effectiveness_score,
        rating5: Number((coachRow.effectiveness_score / 20).toFixed(1)),
        stars: coachRow.effectiveness_score >= 85 ? 3 : coachRow.effectiveness_score >= 70 ? 2 : 1,
        scoreBreakdown: coachRow.score_breakdown_json ? JSON.parse(coachRow.score_breakdown_json) : [],
        keyInsights: JSON.parse(coachRow.key_insights_json || '[]'),
        recommendation: coachRow.recommendation,
        updatedAt: coachRow.updated_at,
        steadyPaceSecKm: coachRow.steady_pace_sec_km,
        steadyHeartRate: coachRow.steady_heart_rate,
        steadyCadence: coachRow.steady_cadence,
        steadyStanceTime: coachRow.steady_stance_time,
        pauseBreakdown: coachRow.pause_breakdown_json ? JSON.parse(coachRow.pause_breakdown_json) : null
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/activities/:id/weather/refresh - manually trigger or refresh historical weather
activitiesRouter.post('/:id/weather/refresh', async (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const weather = await syncActivityWeather(db, id);
    if (!weather) {
      return res.status(400).json({ error: 'Activity has no GPS coordinates for microclimate weather lookup' });
    }
    const updated = db.prepare('SELECT * FROM activities WHERE id = ?').get(id) as any;
    const coachSummary = syncActivityCoachSummary(db, id);
    res.json({ activity: updated, weather, coachSummary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
