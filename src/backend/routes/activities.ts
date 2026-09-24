import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import {
  getActivityCoachSummaryService,
  getActivityDetailService,
  getBestEffortsService,
  getProgressHistoryService,
  getTrainingLoadService,
  getVolumeService,
  listActivitiesService,
  parseActivityUpdate,
  refreshActivityWeatherService,
  updateActivityService,
} from '../services/activity-service.js';

export { ALLOWED_TAGS } from '../services/activity-service.js';

export const activitiesRouter = Router();

// GET /api/activities/best-efforts - standard distance personal bests (1k, 5k, 10k, HM, Marathon)
activitiesRouter.get('/best-efforts', (req, res) => {
  try {
    res.json(getBestEffortsService(getDatabase()));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve best efforts' });
  }
});

// GET /api/activities/training-load - retrieve acute load, chronic load, optimal tunnel, and status
activitiesRouter.get('/training-load', (req, res) => {
  try {
    const daysHistory = req.query.days ? parseInt(req.query.days as string, 10) : 30;
    res.json(getTrainingLoadService(getDatabase(), daysHistory));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to calculate training status' });
  }
});

// GET /api/activities/volume - aggregated effort and volume metrics
activitiesRouter.get('/volume', (req, res) => {
  try {
    res.json(getVolumeService(getDatabase(), {
      period: req.query.period as string | undefined,
      month: req.query.month as string | undefined,
      year: req.query.year as string | undefined,
    }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/progress-history - monthly and yearly longitudinal progress
activitiesRouter.get('/progress-history', (req, res) => {
  try {
    const runTypeFilter = (req.query.run_type as string) || 'all';
    res.json(getProgressHistoryService(getDatabase(), runTypeFilter));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities - list all runs
activitiesRouter.get('/', (req, res) => {
  try {
    const typeFilter = req.query.type as string | undefined;
    res.json(listActivitiesService(getDatabase(), typeFilter));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/:id - deep dive into individual run
activitiesRouter.get('/:id', async (req, res) => {
  try {
    const detail = getActivityDetailService(getDatabase(), req.params.id);
    if (!detail) {
      return res.status(404).json({ code: 'ERR_ACTIVITY_NOT_FOUND', error: 'Activity not found' });
    }
    res.json(detail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/activities/:id - manual override for run_type or notes
activitiesRouter.patch('/:id', (req, res) => {
  try {
    const input = parseActivityUpdate(req.body);
    if (!input) return res.status(400).json({ code: 'ERR_INVALID_ACTIVITY_INPUT', error: 'Invalid activity update' });
    const result = updateActivityService(getDatabase(), req.params.id, input);
    if (!result.ok) {
      return res.status(result.status).json({ code: result.code, error: result.error });
    }
    res.json(result.response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities/:id/coach-summary - retrieve persistent coach summary from table
activitiesRouter.get('/:id/coach-summary', (req, res) => {
  try {
    const result = getActivityCoachSummaryService(getDatabase(), req.params.id);
    if (!result) {
      return res.status(404).json({ code: 'ERR_COACH_SUMMARY_NOT_FOUND', error: 'Coach summary not found' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/activities/:id/weather/refresh - manually trigger or refresh historical weather
activitiesRouter.post('/:id/weather/refresh', async (req, res) => {
  try {
    const result = await refreshActivityWeatherService(getDatabase(), req.params.id);
    if (!result) {
      return res.status(400).json({ code: 'ERR_NO_GPS', error: 'Activity has no GPS coordinates for microclimate weather lookup' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
