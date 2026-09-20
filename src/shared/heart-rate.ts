export interface HeartRateProfileInput {
  age?: number | null;
  dob?: string | null;
  maxHr?: number | null;
  restingHr?: number | null;
  lt1Hr?: number | null;
  lt2Hr?: number | null;
}

// Provisional model inputs for imports made before onboarding. These are never
// saved as the athlete's measurements; callers can identify them via isEstimated.
const PROVISIONAL_AGE = 30;
const PROVISIONAL_RESTING_HR = 60;

export function ageFromDob(dob?: string | null, fallback = 0): number {
  if (!dob) return fallback;
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(dob);
  if (!match) return fallback;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3] || 1);
  const birth = new Date(year, month - 1, day);
  if (birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) return fallback;
  const now = new Date();
  const age = now.getFullYear() - year - (now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day) ? 1 : 0);
  return age > 0 && age <= 120 ? age : fallback;
}

const valid = (value: number | null | undefined, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function resolveHeartRateProfile(input: HeartRateProfileInput = {}) {
  const age = ageFromDob(input.dob, valid(input.age, 1, 120) ? input.age : 0);
  const maxHr = valid(input.maxHr, 100, 240) ? input.maxHr : Math.round(208 - 0.7 * (age || PROVISIONAL_AGE));
  const restingHr = valid(input.restingHr, 30, Math.min(120, maxHr - 10)) ? input.restingHr : PROVISIONAL_RESTING_HR;
  const reserve = maxHr - restingHr;
  const lt2Hr = valid(input.lt2Hr, restingHr + 3, maxHr - 1) ? input.lt2Hr : Math.round(restingHr + reserve * 0.82);
  const lt1Hr = valid(input.lt1Hr, restingHr + 1, lt2Hr - 2) ? input.lt1Hr : Math.min(lt2Hr - 2, Math.round(restingHr + reserve * 0.65));
  return { maxHr, restingHr, lt1Hr, lt2Hr, age: age || null,
    isEstimated: !valid(input.maxHr, 100, 240) || !valid(input.restingHr, 30, 120),
    hasBaseline: (valid(input.maxHr, 100, 240) || age > 0) && valid(input.restingHr, 30, 120) };
}
