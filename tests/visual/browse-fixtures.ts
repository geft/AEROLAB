import { expect, type Page } from '@playwright/test';

const activity = {
  id: 'visual-run-1',
  start_time: '2026-09-12 07:00:00',
  name: 'Singapore Running',
  run_type: 'easy_base',
  distance_meters: 8500,
  duration_seconds: 2800,
  avg_pace_sec_km: 330,
  avg_heart_rate: 138,
  max_heart_rate: 150,
  avg_cadence: 176,
  calories: 550,
  elevation_gain_m: 12,
  avg_temperature: 28,
  avg_vertical_oscillation: 82,
  avg_stance_time: 245,
  efficiency_factor: 1.25,
  aerobic_decoupling_pct: 2.1,
  meters_per_beat: 3.1,
  tags: '["Easy Base","Recovery"]',
  training_load: 68,
  verdict: 'on_track',
  effectiveness_score: 95
};

const activityDetail = {
  activity: {
    ...activity,
    notes: 'Smooth morning run in Zone 2.',
    weather_source: 'open-meteo',
    weather_temperature_c: 30.2,
    weather_humidity_pct: 67,
    weather_apparent_temp_c: 34.4,
    weather_condition: 'Mainly clear',
    weather_pm25_ug_m3: 96,
    weather_pm25_source: 'nea-sg'
  },
  splits: [
    { id: 1, split_index: 1, distance_meters: 1000, avg_pace_sec_km: 340, duration_seconds: 340, avg_heart_rate: 132, split_efficiency_factor: 1.22, elevation_change_m: 2 },
    { id: 2, split_index: 2, distance_meters: 1000, avg_pace_sec_km: 334, duration_seconds: 334, avg_heart_rate: 136, split_efficiency_factor: 1.24, elevation_change_m: -1 },
    { id: 3, split_index: 3, distance_meters: 1000, avg_pace_sec_km: 328, duration_seconds: 328, avg_heart_rate: 139, split_efficiency_factor: 1.26, elevation_change_m: 3 },
    { id: 4, split_index: 4, distance_meters: 1000, avg_pace_sec_km: 326, duration_seconds: 326, avg_heart_rate: 141, split_efficiency_factor: 1.27, elevation_change_m: -2 }
  ],
  intervals: [],
  records: Array.from({ length: 48 }, (_, index) => ({
    elapsed_seconds: index * 60,
    heart_rate: 128 + Math.round(index * 0.28) + (index % 5),
    speed_mps: 2.9 + Math.sin(index / 5) * 0.12,
    altitude_m: 12 + Math.round(Math.sin(index / 8) * 4),
    distance_m: index * 175,
    cadence: 174 + (index % 4)
  })),
  coachSummary: {
    headline: 'Near-Perfect Aerobic Base Execution',
    verdict: 'on_track',
    effectivenessScore: 95,
    rating5: 4.8,
    keyInsights: ['Superb cardiovascular stability with only 2.1% drift.', 'Cadence was right in the sweet spot (176 spm).'],
    recommendation: 'Absorbing volume smoothly. Ready for progressive tempo.',
    context: { acwr: 0.9, windowDays: 28 }
  }
};

const thresholdData = {
  latest: {
    lt1: { lt1_hr: 140, lt1_pace_sec_km: 330, effective_date: '2026-09-12', baseline_economy_ef: 1.25 },
    lt2: { lt2_hr: 165, lt2_pace_sec_km: 270, effective_date: '2026-09-12' },
    vo2Max: 58
  },
  currentThresholds: {
    lt1Hr: 140,
    lt1Range: [139, 141],
    lt2Hr: 165,
    lt1PaceSecKm: 330,
    lt2PaceSecKm: 270,
    baselineEconomyEf: 1.25,
    source: 'calibrated'
  },
  zones: { z1: [0, 126], z2: [127, 140], z3: [141, 164], z4: [165, 180], z5: [181, 203] },
  predictions: [
    { distanceName: '5K', timeSeconds: 1290, timeFormatted: '21:30', paceFormatted: '4:18/km' },
    { distanceName: '10K', timeSeconds: 2700, timeFormatted: '45:00', paceFormatted: '4:30/km' }
  ],
  history: [
    { id: 1, effective_date: '2026-05-12', lt1_hr: 138, lt1_pace_sec_km: 345, lt2_hr: 163, lt2_pace_sec_km: 282, baseline_economy_ef: 1.2, source_activity_id: 'history-1', activity_name: 'Aerobic Base Run' },
    { id: 2, effective_date: '2026-07-12', lt1_hr: 139, lt1_pace_sec_km: 338, lt2_hr: 164, lt2_pace_sec_km: 276, baseline_economy_ef: 1.23, source_activity_id: 'history-2', activity_name: 'Aerobic Base Run' },
    { id: 3, effective_date: '2026-09-12', lt1_hr: 140, lt1_pace_sec_km: 330, lt2_hr: 165, lt2_pace_sec_km: 270, baseline_economy_ef: 1.25, source_activity_id: 'history-3', activity_name: 'Aerobic Base Run' }
  ],
  economyTrend: [],
  scatterData: []
};

const progressHistory = {
  months: [
    { period: '2026-07', label: 'Jul 2026', runCount: 12, totalDistanceKm: 85, totalDurationHours: 8.1, avgEfficiencyFactor: 1.2, avgPaceSecKm: 340, avgHeartRate: 140 },
    { period: '2026-08', label: 'Aug 2026', runCount: 14, totalDistanceKm: 96, totalDurationHours: 9.2, avgEfficiencyFactor: 1.23, avgPaceSecKm: 335, avgHeartRate: 139 },
    { period: '2026-09', label: 'Sep 2026', runCount: 8, totalDistanceKm: 58, totalDurationHours: 5.4, avgEfficiencyFactor: 1.25, avgPaceSecKm: 330, avgHeartRate: 138 }
  ],
  years: [
    { period: '2025', label: '2025 Season', runCount: 120, totalDistanceKm: 840, totalDurationHours: 82, avgEfficiencyFactor: 1.16, avgPaceSecKm: 360, avgHeartRate: 145 },
    { period: '2026', label: '2026 Season', runCount: 96, totalDistanceKm: 690, totalDurationHours: 66, avgEfficiencyFactor: 1.23, avgPaceSecKm: 338, avgHeartRate: 140 }
  ]
};

const volumeData = {
  periodLabel: 'Past 30 Days',
  totalDistanceKm: 239.4,
  totalDurationHours: 22.8,
  activityCount: 14,
  avgEf: 1.23,
  zones: {
    z1: { hours: 0.8, pct: 4 },
    z2: { hours: 14.2, pct: 62 },
    z3: { hours: 3.6, pct: 16 },
    z4: { hours: 3.1, pct: 14 },
    z5: { hours: 0.9, pct: 4 }
  }
};

const profileData = {
  isConfigured: true,
  profile: {
    id: 'primary', name: 'Visual Runner', gender: 'Male', age: 37,
    dob: '1989-01-01', resting_hr: 55, max_hr: 203, is_max_hr_estimated: 0
  },
  currentThresholds: thresholdData.currentThresholds,
  observedPeakHr: { peakHr: 198, activityId: 'visual-run-1', activityName: 'Interval Workout', activityDate: '2026-09-12', runType: 'intervals_vo2' },
  tanakaMaxHr: 182,
  effectiveMaxHr: 203,
  maxHrSource: 'observed'
};

const trainingLoad = {
  trainingStatus: {
    currentAcuteLoad: 410,
    currentChronicLoad: 365,
    acwr: 1.12,
    status: 'optimal',
    statusLabel: 'Optimal',
    statusDescription: 'Training load is within the productive range.',
    optimalRange: { min: 0.8, max: 1.3 },
    last7DaysLoad: 98,
    timeline: Array.from({ length: 14 }, (_, index) => ({
      date: `2026-09-${String(index + 12).padStart(2, '0')}`,
      dailyLoad: 35 + (index % 4) * 8,
      acuteLoad: 380 + index * 2,
      chronicLoad: 350 + index,
      optimalMin: 280,
      optimalMax: 455,
      acwr: 1.05 + (index % 4) * 0.03
    }))
  }
};

export async function openBrowseFixture(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('aerolab_theme', 'dark'));
  await page.route('**/api/profile', route => route.fulfill({ json: profileData }));
  await page.route('**/api/thresholds', route => route.fulfill({ json: thresholdData }));
  await page.route('**/api/activities/progress-history*', route => route.fulfill({ json: progressHistory }));
  await page.route('**/api/activities/volume*', route => route.fulfill({ json: volumeData }));
  await page.route('**/api/activities/training-load*', route => route.fulfill({ json: trainingLoad }));
  await page.route('**/api/activities/best-efforts', route => route.fulfill({ json: { allTime: [], currentYear: [], targets: [] } }));
  await page.route('**/api/activities/visual-run-1', route => route.fulfill({ json: activityDetail }));
  await page.route('**/api/activities', route => route.fulfill({ json: { activities: [activity] } }));

  await page.goto('/');
  await page.addStyleTag({ content: '.dev-floating-trigger { display: none !important; }' });
  await expect(page.locator('#dev-mode-trigger-btn')).toBeHidden();
  await page.locator('.session-card').waitFor();
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.locator('.nav-tabs').evaluate(nav => { (nav as HTMLElement).style.visibility = 'hidden'; });
    await expect(page.locator('.nav-tabs')).toBeHidden();
  }
  await page.locator('.metric-chips-grid').waitFor({ state: 'attached' });
}

export async function openSettingsFixture(page: Page): Promise<void> {
  await openBrowseFixture(page);
  await page.route('**/api/database/status', route => route.fulfill({ json: {
    dbPath: 'C:/Users/Runner/AEROLAB/runs.db',
    startupDbPath: 'C:/Users/Runner/AEROLAB/runs.db',
    sizeMb: '12.4',
    activityCount: 329,
    snapshots: [{ filename: 'runs-2026-09-19.db', createdAt: '2026-09-19T00:00:00.000Z', sizeMb: '12.4' }],
    settings: {
      backupDirectory: 'C:/Users/Runner/AEROLAB/backups',
    }
  } }));
  await page.route('**/api/system/maintenance', route => route.fulfill({ json: { status: 'idle' } }));
  await page.route('**/api/ingest/settings', route => route.fulfill({ json: {
    directory: 'C:/Users/Runner/Downloads/Garmin',
    exists: true
  } }));

  await page.locator('#tab-settings-btn').evaluate(button => (button as HTMLButtonElement).click());
  await page.locator('.settings-view #garmin-import-directory').waitFor();
  await expect(page.locator('.settings-view')).toBeVisible();
  await expect(page.locator('.backup-management-panel').getByText('329', { exact: true })).toBeVisible();
  await expect(page.locator('.backup-management-panel').getByText('runs-2026-09-19.db')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

export async function openUploadFixture(page: Page): Promise<void> {
  await openBrowseFixture(page);
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.locator('.nav-tabs').evaluate(nav => { (nav as HTMLElement).style.visibility = ''; });
  }
  await page.locator('#nav-upload-btn').click();
  await expect(page.locator('.modal-content')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
