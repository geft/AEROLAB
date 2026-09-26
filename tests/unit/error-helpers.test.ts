import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../src/frontend/api/client.js';
import { apiErrorMessage } from '../../src/frontend/api/errors.js';
import { errorMessage } from '../../src/frontend/utils/errors.js';
import { en } from '../../src/frontend/i18n/en.js';

describe('API error translation', () => {
  const cases = [
    ['ERR_API', 'generic'], ['ERR_NETWORK', 'generic'], ['ERR_INVALID_MAX_HR', 'invalidMaxHr'],
    ['ERR_INVALID_RESTING_HR', 'invalidRestingHr'], ['ERR_INVALID_PROFILE_INPUT', 'invalidProfileInput'],
    ['ERR_PROFILE_SAVE_FAILED', 'profileSaveFailed'], ['ERR_INVALID_TAGS', 'invalidTags'],
    ['ERR_INVALID_ACTIVITY_INPUT', 'invalidActivityInput'], ['ERR_NO_FIELDS_TO_UPDATE', 'noFieldsToUpdate'],
    ['ERR_ACTIVITY_NOT_FOUND', 'activityNotFound'], ['ERR_PROFILE_NOT_FOUND', 'profileNotFound'],
    ['ERR_COACH_SUMMARY_NOT_FOUND', 'coachSummaryNotFound'], ['ERR_INVALID_RESPONSE', 'invalidResponse'],
    ['ERR_NO_GPS', 'noGps'], ['ERR_ZIP_UNSUPPORTED', 'zipUnsupported'],
    ['ERR_DEV_DIAGNOSTICS_FAILED', 'devDiagnosticsFailed'],
  ] as const;

  it.each(cases)('maps %s to its dictionary entry', (code, key) => {
    expect(apiErrorMessage(en, new ApiRequestError(400, code, 'server wording'), 'fallback')).toBe(en.apiErrors[key]);
  });

  it('uses the fallback for unknown codes and non-API errors', () => {
    expect(apiErrorMessage(en, new ApiRequestError(400, 'ERR_NEW', 'detail'), 'fallback')).toBe('fallback');
    expect(apiErrorMessage(en, new Error('detail'), 'fallback')).toBe('fallback');
    expect(apiErrorMessage(en, null, 'fallback')).toBe('fallback');
  });
});

describe('errorMessage', () => {
  it.each([
    [new Error('readable'), 'Unexpected error', 'readable'],
    [new Error(''), 'caller fallback', 'caller fallback'],
    ['readable string', 'Unexpected error', 'readable string'],
    ['   ', 'caller fallback', 'caller fallback'],
    [null, 'caller fallback', 'caller fallback'],
    [{ reason: 'unknown' }, 'caller fallback', 'caller fallback'],
  ])('normalizes thrown value %j', (value, fallback, expected) => {
    expect(errorMessage(value, fallback)).toBe(expected);
  });
});
