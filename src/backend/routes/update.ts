import { Router } from 'express';
import type { UpdateApplyResponse, UpdateSettingsResponse } from '../../shared/update.js';
import { saveUpdatePreferences } from '../update/preferences.js';
import { checkForUpdate, getUpdateStatus, scheduleUpdateInstall } from '../update/service.js';

export const updateRouter = Router();

/** Last known state; never performs a network request. */
updateRouter.get('/', (_req, res) => {
  res.json(getUpdateStatus());
});

/** Ask GitHub Releases for the newest version. `force` bypasses the 5 minute cache. */
updateRouter.post('/check', async (req, res, next) => {
  try {
    const force = Boolean(req.body && typeof req.body === 'object' && (req.body as { force?: unknown }).force === true);
    res.json(await checkForUpdate({ force }));
  } catch (error) {
    next(error);
  }
});

/** Persist the startup auto-update preference. */
updateRouter.post('/settings', (req, res) => {
  const autoCheck = req.body && typeof req.body === 'object' ? (req.body as { autoCheck?: unknown }).autoCheck : undefined;
  if (typeof autoCheck !== 'boolean') {
    return res.status(400).json({
      code: 'ERR_INVALID_UPDATE_SETTINGS',
      error: 'autoCheck must be a boolean.'
    });
  }
  const preferences = saveUpdatePreferences({ autoCheck });
  const body: UpdateSettingsResponse = { autoCheck: preferences.autoCheck };
  res.json(body);
});

/** Download and verify the installer, then hand it to the packaged launcher. */
updateRouter.post('/apply', async (_req, res, next) => {
  try {
    const scheduled = await scheduleUpdateInstall();
    const body: UpdateApplyResponse = { status: 'scheduled', version: scheduled.version };
    res.status(202).json(body);
  } catch (error) {
    next(error);
  }
});
