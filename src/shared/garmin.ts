/**
 * Garmin Connect Personal API contracts shared by the backend and frontend.
 *
 * The Personal API is a self-service key that can read one athlete's own
 * activities. AEROLAB exchanges that key for a 24-hour bearer token and pulls
 * original activity files (returned as a ZIP containing one FIT file).
 */

/** Environment variable checked when no key has been saved in Settings. */
export const GARMIN_API_KEY_ENV = 'GARMIN_API_KEY';

/** Optional expiry date for the environment key, e.g. `2027-10-22`. */
export const GARMIN_API_KEY_EXPIRY_ENV = 'GARMIN_API_KEY_EXPIRY';

/** Maximum number of FIT files downloaded by one sync. */
export const GARMIN_SYNC_BATCH_SIZE = 10;

/** Show the expiry warning when the key has this many days or fewer left. */
export const GARMIN_KEY_EXPIRY_WARNING_DAYS = 30;

/** Garmin Connect page where a Personal API key is created and its status viewed. */
export const GARMIN_PERSONAL_API_KEY_URL = 'https://connect.garmin.com/app/settings/personalApiToken';

export type GarminCredentialSource = 'environment' | 'stored';

export interface GarminKeyStatus {
  configured: boolean;
  source: GarminCredentialSource | null;
  /** ISO timestamp, or null when the user has not recorded an expiry date. */
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  /** True when the key expires within GARMIN_KEY_EXPIRY_WARNING_DAYS days. */
  expiringSoon: boolean;
  /** True when the recorded expiry date has passed. A stored key is removed; an environment key stays configured. */
  expired: boolean;
  /** Where the active expiry date came from, or null when none is recorded. */
  expirySource: 'environment' | 'stored' | null;
}

export type GarminImportStatus = 'imported' | 'skipped_duplicate' | 'skipped_non_running' | 'skipped_no_file' | 'error';

export interface GarminSyncResultItem {
  filename: string;
  activityName?: string;
  date?: string;
  status: GarminImportStatus;
  activityId?: string;
  error?: string;
}

export interface GarminSyncResponse {
  key: GarminKeyStatus;
  batchLimit: number;
  newerFound: number;
  olderFound: number;
  imported: number;
  duplicates: number;
  nonRunning: number;
  /** Activities Garmin has no recorded file for, such as manual entries. */
  noFile: number;
  errors: number;
  hasMoreNewer: boolean;
  hasMoreOlder: boolean;
  results: GarminSyncResultItem[];
}
