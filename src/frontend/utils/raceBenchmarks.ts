import snapshot from '../data/raceBenchmarks.json';

export const RACE_BENCHMARK_LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'] as const;
export type RaceBenchmarkLevel = typeof RACE_BENCHMARK_LEVELS[number];

type Distance = keyof typeof snapshot.ages;
type Sex = 'Male' | 'Female';

export interface RaceBenchmark {
  age: number;
  sex: Sex;
  distance: Distance;
  levels: Array<{ level: RaceBenchmarkLevel; timeSeconds: number; percentileFasterThan: number }>;
  achievedLevel: RaceBenchmarkLevel | null;
  sourceUrl: string;
  capturedAt: string;
}

function parseTime(value: string): number {
  return value.split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

/** Interpolates the published five-year age rows; no online lookup at runtime. */
export function raceBenchmarkFor(
  distanceName: string,
  predictedTimeSeconds: number,
  age: number | null | undefined,
  gender: string | null | undefined
): RaceBenchmark | null {
  if (!Number.isFinite(age) || age == null || age < 20 || age > 90 ||
      !Number.isFinite(predictedTimeSeconds) || predictedTimeSeconds <= 0 ||
      (gender !== 'Male' && gender !== 'Female') ||
      !(distanceName in snapshot.ages)) return null;

  const distance = distanceName as Distance;
  const sex = gender as Sex;
  const rows = snapshot.ages[distance][sex] as Record<string, string[]>;
  const lowerAge = Math.max(20, Math.floor(age / 5) * 5);
  const upperAge = Math.min(90, lowerAge + 5);
  const lower = rows[String(lowerAge)];
  const upper = rows[String(upperAge)];
  if (!lower || !upper) return null;
  const fraction = upperAge === lowerAge ? 0 : (age - lowerAge) / (upperAge - lowerAge);
  const levels = RACE_BENCHMARK_LEVELS.map((level, index) => ({
    level,
    percentileFasterThan: snapshot.percentileFasterThan[index],
    timeSeconds: Math.round(parseTime(lower[index]) + (parseTime(upper[index]) - parseTime(lower[index])) * fraction)
  }));
  const achievedLevel = [...levels].reverse().find(row => predictedTimeSeconds <= row.timeSeconds)?.level ?? null;

  const slugs: Record<Distance, string> = {
    '5K': '5k-times',
    '10K': '10k-times',
    'Half Marathon': 'half-marathon-times',
    Marathon: 'marathon-times'
  };
  return { age, sex, distance, levels, achievedLevel, sourceUrl: `${snapshot.sourceUrl}${slugs[distance]}`, capturedAt: snapshot.capturedAt };
}
