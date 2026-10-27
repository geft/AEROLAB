import type { Translations } from '../i18n/types.js';
import { ApiRequestError } from './client.js';

/**
 * Resolve a user-visible failure to a single dictionary string.
 *
 * Every component that can fail calls this instead of rendering the raw server
 * `error` string: the stable `ApiRequestError.code` selects the copy, and an
 * unmapped or non-API failure falls back to the caller's own dictionary string.
 * This is what keeps HTTP wording out of components and locale-aware.
 */
export function apiErrorMessage(t: Translations, err: unknown, fallback: string): string {
  if (!(err instanceof ApiRequestError)) return fallback;

  switch (err.code) {
    case 'ERR_IMPORT_BUSY':
      return t.apiErrors.importBusy;
    case 'ERR_API':
      return t.apiErrors.generic;
    case 'ERR_NETWORK':
      return t.apiErrors.generic;
    case 'ERR_INVALID_MAX_HR':
      return t.apiErrors.invalidMaxHr;
    case 'ERR_INVALID_RESTING_HR':
      return t.apiErrors.invalidRestingHr;
    case 'ERR_INVALID_PROFILE_INPUT':
      return t.apiErrors.invalidProfileInput;
    case 'ERR_PROFILE_SAVE_FAILED':
      return t.apiErrors.profileSaveFailed;
    case 'ERR_INVALID_TAGS':
      return t.apiErrors.invalidTags;
    case 'ERR_INVALID_ACTIVITY_INPUT':
      return t.apiErrors.invalidActivityInput;
    case 'ERR_NO_FIELDS_TO_UPDATE':
      return t.apiErrors.noFieldsToUpdate;
    case 'ERR_ACTIVITY_NOT_FOUND':
      return t.apiErrors.activityNotFound;
    case 'ERR_PROFILE_NOT_FOUND':
      return t.apiErrors.profileNotFound;
    case 'ERR_COACH_SUMMARY_NOT_FOUND':
      return t.apiErrors.coachSummaryNotFound;
    case 'ERR_INVALID_RESPONSE':
      return t.apiErrors.invalidResponse;
    case 'ERR_NO_GPS':
      return t.apiErrors.noGps;
    case 'ERR_DEV_DIAGNOSTICS_FAILED':
      return t.apiErrors.devDiagnosticsFailed;
    case 'GARMIN_KEY_MISSING':
      return t.apiErrors.garminKeyMissing;
    case 'GARMIN_KEY_INVALID':
      return t.apiErrors.garminKeyInvalid;
    case 'GARMIN_RATE_LIMITED':
      return t.apiErrors.garminRateLimited;
    case 'GARMIN_UNAVAILABLE':
    case 'GARMIN_DOWNLOAD_FAILED':
      return t.apiErrors.garminUnavailable;
    case 'ERR_INVALID_GARMIN_EXPIRY':
      return t.apiErrors.invalidGarminExpiry;
    case 'UPDATE_CHECK_FAILED':
      return t.apiErrors.updateCheckFailed;
    case 'UPDATE_RATE_LIMITED':
      return t.apiErrors.updateRateLimited;
    case 'UPDATE_DOWNLOAD_FAILED':
      return t.apiErrors.updateDownloadFailed;
    case 'UPDATE_CHECKSUM_FAILED':
      return t.apiErrors.updateChecksumFailed;
    case 'UPDATE_NOT_AVAILABLE':
      return t.apiErrors.updateNotAvailable;
    case 'UPDATE_UNSUPPORTED':
      return t.apiErrors.updateUnsupported;
    case 'UPDATE_BUSY':
      return t.apiErrors.updateBusy;
    case 'ERR_INVALID_UPDATE_SETTINGS':
      return t.apiErrors.invalidUpdateSettings;
    default:
      return fallback;
  }
}
