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
      return t.upload.busy;
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
    case 'ERR_IMPORT_FORMAT':
      return t.upload.fitZipOnly;
    case 'ERR_ZIP_INVALID':
      return t.apiErrors.zipInvalid;
    case 'ERR_DEV_DIAGNOSTICS_FAILED':
      return t.apiErrors.devDiagnosticsFailed;
    default:
      return fallback;
  }
}
