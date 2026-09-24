import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { getProfileService, parseProfileUpdate, updateProfileService } from '../services/profile-service.js';
import { logger } from '../utils/logger.js';

export { getObservedPeakHeartRate } from '../services/profile-service.js';
export { ageFromDob as calculateAgeFromDob } from '../../shared/heart-rate.js';

export const profileRouter = Router();

// GET /api/profile - return athlete profile and calculated HRR zones reflecting current LT1/LT2
profileRouter.get('/', (req, res) => {
  try {
    const response = getProfileService(getDatabase());
    if (!response) {
      return res.status(404).json({ code: 'ERR_PROFILE_NOT_FOUND', error: 'Profile not found' });
    }
    res.json(response);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/profile - update athlete profile
profileRouter.patch('/', (req, res) => {
  try {
    if (req.body && typeof req.body === 'object' && 'resting_hr' in req.body &&
        (typeof req.body.resting_hr !== 'number' ||
          !Number.isFinite(req.body.resting_hr) || req.body.resting_hr < 30 || req.body.resting_hr > 120)) {
      return res.status(400).json({ code: 'ERR_INVALID_RESTING_HR', error: 'Invalid resting heart rate' });
    }
    if (req.body && typeof req.body === 'object' && 'max_hr' in req.body &&
        !req.body.is_max_hr_estimated && !req.body.opt_out_max_hr &&
        (typeof req.body.max_hr !== 'number' || !Number.isFinite(req.body.max_hr) ||
          req.body.max_hr < 100 || req.body.max_hr > 240)) {
      return res.status(400).json({ code: 'ERR_INVALID_MAX_HR', error: 'Invalid maximum heart rate' });
    }
    const input = parseProfileUpdate(req.body);
    if (!input) return res.status(400).json({ code: 'ERR_INVALID_PROFILE_INPUT', error: 'Invalid profile update' });
    const result = updateProfileService(getDatabase(), input);
    if (!result.ok) {
      const body = result.code ? { code: result.code, error: result.error } : { error: result.error };
      return res.status(result.status).json(body);
    }
    res.json(result.response);
  } catch (err: any) {
    logger.error('Profile', 'PATCH /api/profile failed', err);
    res.status(500).json({
      code: 'ERR_PROFILE_SAVE_FAILED',
      error: err.message || 'Database error while saving athlete profile',
      details: err.stack || String(err)
    });
  }
});
