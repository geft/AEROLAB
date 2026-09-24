import { Router } from 'express';
import { getDatabase } from '../db/client.js';
import { getThresholdsService } from '../services/thresholds-service.js';

export const thresholdsRouter = Router();

// GET /api/thresholds - returns LT1/LT2 timeline, pace-dependent economy curves, and race predictions
thresholdsRouter.get('/', (req, res) => {
  try {
    const runTypeFilter = req.query.run_type as string | undefined;
    res.json(getThresholdsService(getDatabase(), runTypeFilter));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
