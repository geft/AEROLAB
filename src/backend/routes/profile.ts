import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { getProfileService, updateProfileService } from '../services/profile-service.js';
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
    const result = updateProfileService(getDatabase(), req.body);
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
