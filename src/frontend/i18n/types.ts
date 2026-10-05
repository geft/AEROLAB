import type { CoachCategoryId, CoachFindingId, CoachMessageId } from '../../shared/coaching.js';
export type Language = 'en' | 'zh';

/**
 * BCP-47 locale tags used for `Intl` date/number formatting.
 *
 * This is the web equivalent of Android's `values/` + `values-zh/` resource
 * folders: the language code selects the message dictionary, and this map
 * selects the matching locale for locale-aware formatting (dates, numbers).
 * Never hardcode 'zh-CN' / 'en-US' inside a component — read `locale` from
 * `useTranslation()` so adding a language is a one-line change here.
 */
export const LOCALES: Record<Language, string> = {
  en: 'en-US',
  zh: 'zh-CN'
};

/**
 * Plural forms for a dictionary entry. The correct form is selected at runtime
 * by `Intl.PluralRules` for the active locale — the web equivalent of Android
 * `plurals`. Use `{count}` as the interpolation token.
 */
export interface PluralForms {
  one: string;
  other: string;
}

/**
 * Language switcher metadata. Declared once so UI can iterate over the
 * supported languages instead of branching per language.
 */
export const LANGUAGE_LABELS: Record<Language, { short: string; native: string }> = {
  en: { short: 'EN', native: 'English' },
  zh: { short: '中', native: '简体中文' }
};

/** Every supported language, in switcher display order. */
export const SUPPORTED_LANGUAGES: Language[] = ['en', 'zh'];

export interface Translations {
  snapshot: {
    loadingTitle: string;
    downloading: string;
    preparing: string;
    downloadPercent: string;
    generatedAt: string;
    deployRowButton: string;
    deployProtectionConfirmation: string;
    deploying: string;
    deploySetupTerminalHint: string;
    deployPhases: {
      checking: string;
      login: string;
      linking: string;
      exporting: string;
      validating: string;
      building: string;
      deploying: string;
      complete: string;
      failed: string;
    };
    deploySteps: {
      checking: string;
      login: string;
      linking: string;
      exporting: string;
      validating: string;
      building: string;
      deploying: string;
      complete: string;
    };
    deployStepsLabel: string;
    deploySuccess: string;
    deployOpen: string;
    deployFailed: string;
    deploySnapshotMissing: string;
  };
  nav: {
    navigationLabel: string;
    decreaseFont: string;
    decreaseFontTooltip: string;
    increaseFont: string;
    increaseFontTooltip: string;
    browse: string;
    progress: string;
    stats: string;
    profile: string;
    settings: string;
    dayMode: string;
    nightMode: string;
    importRuns: string;
    langTitle: string;
    fontSize: string;
    backup: string;
    appearance: string;
    moreOptions: string;
  };
  common: {
    devDiagnosticsTooltip: string;
    closeGuide: string;
    save: string;
    cancel: string;
    type: string;
    monthsShort: string;
    quotedText: string;
    loading: string;
    retry: string;
    close: string;
    done: string;
    filter: string;
    all: string;
    date: string;
    pace: string;
    heartRate: string;
    cadence: string;
    distance: string;
    duration: string;
    notes: string;
    km: string;
    min: string;
    devMode: string;
    confidence: string;
  };
  weather: {
    ambientTooltip: string;
    unknownSourceTooltip: string;
    humidity: string;
    feelsLike: string;
    watchSensor: string;
    refresh: string;
    available: string;
    fetching: string;
    fetch: string;
    shareNotice: string;
    garminSensor: string;
    storedUnverifiedTemp: string;
    pm25: string;
    pm25InfoTitle: string;
    pm25CurrentReading: string;
    pm25MeasuredSource: string;
    pm25ModeledSource: string;
    pm25NeaExplanation: string;
    pm25ModelExplanation: string;
    pm25BandTitle: string;
    pm25Normal: string;
    pm25RangeNormal: string;
    pm25Elevated: string;
    pm25RangeElevated: string;
    pm25High: string;
    pm25RangeHigh: string;
    pm25VeryHigh: string;
    pm25RangeVeryHigh: string;
    conditions: Record<string, string>;
  };
  runTypes: {
    easy_base: string;
    tempo: string;
    threshold_lt2: string;
    intervals_vo2: string;
    long_run: string;
    recovery: string;
    race: string;
    all: string;
  };
  tags: {
    easyBase: string;
    threshold: string;
    vo2Max: string;
    longRun: string;
    recovery: string;
    race: string;
    strides: string;
    hills: string;
    tempo: string;
    marathonPace: string;
  };
  browse: {
    jumpYear: PluralForms;
    activityNamePlaceholder: string;
    renameTooltip: string;
    filterYear: string;
    previousYear: string;
    nextYear: string;
    previousMonth: string;
    nextMonth: string;
    closeCalendar: string;
    filterDateTooltip: string;
    showSessionsTooltip: string;
    workOnlyCount: string;
    steadyOnlyCount: string;
    intervalWorkReps: string;
    steadySegments: string;
    segmentsRecoveries: string;
    intervalExplanation: string;
    allSegmentsCount: string;
    averagePeak: string;
    peakAverage: string;
    recoveryDrop: string;
    averageHr: string;
    noIntervals: string;
    hrSummaryTooltip: string;
    allInMonth: string;
    title: string;
    totalRuns: string;
    tabTelemetry: string;
    tabIntervals: string;
    tabSplits: string;
    tabCoach: string;
    viewSwitcherLabel: string;
    sessionsCount: string;
    exportCsv: string;
    steadyPace: string;
    steadyHr: string;
    efficiencyFactor: string;
    telemetryChartTitle: string;
    telemetryChartElevation: string;
    telemetryChartAltitude: string;
    telemetrySampleSelector: string;
    telemetrySamplePosition: string;
    historyLoadFailed: string;
    telemetryLoadFailed: string;
    loadingTelemetry: string;
    backToSessions: string;
    efficiencyFactorUnits: string;
    metersPerHeartbeatDesc: string;
    efficiencyDefaultDesc: string;
    aerobicDecoupling: string;
    aerobicDecouplingDescSolid: string;
    aerobicDecouplingDescDrift: string;
    metersPerBeat: string;
    verticalOscillation: string;
    biomechanicalDynamics: string;
    dynamicsTitle: string;
    biomechanicalDesc: string;
    gctShort: string;
    cadenceShort: string;
    verticalOscLabelShort: string;
    strideLengthShort: string;
    verticalRatioShort: string;
    verticalOscShort: string;
    dropOrImportRun: string;
    noRunsMatchingFilter: string;
    readyFirstRunTitle: string;
    readyFirstRunDesc: string;
    importFirstWorkoutBtn: string;
    showAll: string;
    cadenceLabel: string;
    raw: string;
    elevationLabel: string;
    caloriesLabel: string;
    coachTag: string;
    nextStep: string;
    clear: string;
    runsBadge: string;
    /**
     * Session-card suffix that orders several runs logged on the same day,
     * e.g. `Run 1 of 2`. Tokens: `{index}`, `{total}`.
     */
    runOfDay: string;
    /** Calendar-day tooltip for a day with recorded sessions, e.g. `2 runs`. */
    dayRuns: PluralForms;
    /** Calendar-day tooltip for a day without recorded activity. */
    dayNoActivity: string;
    /** Time-of-day buckets shown beside a run's clock time in the detail header. */
    timeOfDayMorning: string;
    timeOfDayMidday: string;
    timeOfDayEvening: string;
    timeOfDayNight: string;
    /** Execution emblem tooltip. Tokens: `{stars}` (and `{score}` when scored). */
    /** Weighted-rubric transparency labels. */
    coachBaselineTitle: string;
    coachCompareIntensity: string;
    coachComparePaceFaster: string;
    coachComparePaceSlower: string;
    coachCompareHrLower: string;
    coachCompareHrHigher: string;
    coachContextAcwr: string;
    coachContextEconomy: string;
    coachContextHrAtPace: string;
    coachContextDecoupling: string;
    coachContextLongest: string;
    /** Title above the coach-debrief tone legend strip. */
    coachLegacyTemplates: Record<string, string>;
    coachTextOverrides: Record<string, string>;
    coachCategoryOverrides: Partial<Record<CoachCategoryId, string>>;
    coachFindingOverrides: Partial<Record<CoachFindingId, string>>;
    coachMessageOverrides: Partial<Record<CoachMessageId, string>>;
    verdictOnTrack: string;
    verdictSomeDeviation: string;
    verdictOffTarget: string;
    verdictInsufficientEvidence: string;
    verdictDetails: string;
    verdictExplanation: string;
    coachAllInsights: string;
    coachInsightMix: string;
    /** Tone legend for coach-debrief insights: strength, watch-out, fix, context. */
    coachToneGood: string;
    coachToneWatch: string;
    coachToneFix: string;
    coachToneInfo: string;
    distance: string;
    movingTime: string;
    avgPace: string;
    avgHeartRate: string;
    maxHeartRate: string;
    trainingLoad: string;
    loadPts: string;
    excludes: string;
    trafficStops: string;
    walkBreaks: string;
    defaultTitles: {
      easy_base: string;
      long_run: string;
      threshold_lt2: string;
      intervals_vo2: string;
      recovery: string;
      strides: string;
      tempo: string;
      failed_workout: string;
      accidental_tempo: string;
      race: string;
      generic: string;
    };
    close: string;
    calendar: string;
    otherGroup: string;
    /** Short weekday column headers, Sunday first. */
    weekdayShort: string[];
  };
  splits: {
    title: string;
    split: string;
    pace: string;
    fastestSplit: string;
    slowestSplit: string;
    noSplits: string;
    paceSpread: string;
    stdDev: string;
  };
  progress: {
    estimatedPace: string;
    milestoneCardsTooltip: string;
    tableTooltip: string;
    vdotGuideTitle: string;
    vdotGuideAria: string;
    economyGuideTitle: string;
    economyGuideAria: string;
    liveCalibrationsValues: string;
    displayedCount: string;
    noCalibrations: string;
    chartPointSelector: string;
    title: string;
    subtitle: string;
    monthly: string;
    yearly: string;
    totalTime: string;
    economyIndex: string;
    loadFailed: string;
    vdotTrend: string;
    lt1Title: string;
    lt1Sub: string;
    lt2Title: string;
    lt2Sub: string;
    vdotSub: string;
    zone2Ceiling: string;
    zone4Threshold: string;
    vdotRacingIndex: string;
    predicted5k: string;
    cardioEfficiency: string;
    benchmarksTitle: string;
    filterAll: string;
    filterLt1: string;
    filterLt2: string;
    filterRace: string;
    cardsView: string;
    tableView: string;
    gainInYear: string;
    longitudinalDesc: string;
    totalDistanceLegend: string;
    runningEconomyLegend: string;
    hoverHint: string;
    allRunsFilter: string;
    easyBaseFilter: string;
    thresholdVo2Filter: string;
    runningEconomy: string;
    metersPerHeartbeat: string;
    totalCardio: string;
    averagePace: string;
    avgHr: string;
    loggedActivities: string;
    currentBlock: string;
    lt2Peak: string;
    lt1Base: string;
    benchmarkEffort: string;
    tablePeriod: string;
    tableActivities: string;
    tableDistance: string;
    tableDuration: string;
    tableEconomy: string;
    tableAvgPace: string;
    tableAvgHr: string;
    tableZone2: string;
    tableCalibrations: string;
    liveCalibrations: string;
    liveCalibrationsDesc: string;
    thresholdEstimateNote: string;
    syncWithProfile: string;
    confidence: string;
    raceBenchmark: string;
    lt2ThresholdBadge: string;
    lt1AerobicBaseBadge: string;
    lt2PaceLabel: string;
    thresholdHrLabel: string;
    lt1PaceLabel: string;
    aerobicHrLabel: string;
    baselineEconomyLabel: string;
    noThresholdsYet: string;
    tableDate: string;
    tableRunSource: string;
    tableLt1Pace: string;
    tableLt1Hr: string;
    tableLt2Pace: string;
    tableLt2Hr: string;
    tableConfidence: string;
    tableCalibrationNote: string;
    thresholdTrendsTitle: string;
    thresholdTrendsDesc: string;
    paceTrend: string;
    hrTrend: string;
    rangeAll: string;
    range6m: string;
    range3m: string;
    noTrendData: string;
  };
  stats: {
    turnpointGuideTooltip: string;
    title: string;
    subtitle: string;
    aerobicTurnpoint: string;
    anaerobicThreshold: string;
    racePredictions: string;
    fiveK: string;
    tenK: string;
    halfMarathon: string;
    marathon: string;
    predictedPace: string;
    predictionCompare: string;
    predictionGroup: string;
    predictionLevel: string;
    predictionBelow: string;
    predictionTierRanges: string;
    predictionFasterThanCutoff: string;
    predictionProfileNeeded: string;
    predictionWeatherNote: string;
    predictionMale: string;
    predictionFemale: string;
    benchmarkBeginner: string;
    benchmarkNovice: string;
    benchmarkIntermediate: string;
    benchmarkAdvanced: string;
    benchmarkElite: string;
    volumeTitle: string;
    loadFailed: string;
    volumeLoadFailed: string;
    volumeDesc: string;
    periodWeek: string;
    periodMonth: string;
    periodYear: string;
    periodAll: string;
    allRecentMonth: string;
    totalDist: string;
    totalTime: string;
    zone2Mileage: string;
    qualityMileage: string;
    speedworkQuality: string;
    distributionTitle: string;
    hrsTotal: string;
    zone1Recovery: string;
    zone2AerobicBase: string;
    zone3Tempo: string;
    zone4Threshold: string;
    zone5Vo2Max: string;
    polarizedBalanceTitle: string;
    polarizedBalanceDesc: string;
    thresholdGapUnavailable: string;
    thresholdGapGuide: string;
    runWalkEvidence: string;
    thresholdEvidence: string;
    thresholdSupportCount: PluralForms;
    thresholdEvidenceStatus: { supported: string; held: string; stale: string; insufficient: string; external: string };
    turnpointMarginTitle: string;
    turnpointCurrentTitle: string;
    turnpointGuideTitle: string;
    turnpointWhatIsTitle: string;
    turnpointGotIt: string;
    polarizedBalanceValue: string;
    /** Templates with a `{seconds}` token. */
    estGapSeconds: string;
    /** Template with `{easy}`, `{threshold}` and `{estimated}` tokens. */
    paceGapCalc: string;
    /** Template with a `{pace}` token. */
    notCalibrated: string;
    /**
     * Overrides for server-provided period labels, keyed by the API string.
     * `en` leaves this empty (the payload is already English) while `zh`
     * translates the known labels. Unknown labels pass through unchanged.
     */
    periodLabelOverrides: Record<string, string>;
    /** Template with a `{year}` token for "<year> Season" labels. */
    periodLabelSeasonPattern: string;
    /** `whatIs` copy alternates plain and bold fragments around inline `<b>` tags. */
    whatIsP1: string;
    whatIsBoldMargin: string;
    whatIsP2: string;
    whatIsBoldLt1: string;
    whatIsP3: string;
    whatIsBoldLt2: string;
    whatIsP4: string;
    /** Template with an `{hr}` token. */
    zoneDesc: {
      z1: string;
      z2: string;
      z3: string;
      z4: string;
      z5: string;
    };
  };
  profile: {
    efficiencyBadge: string;
    title: string;
    subtitle: string;
    personalInfo: string;
    name: string;
    gender: string;
    genderMale: string;
    genderFemale: string;
    genderOther: string;
    age: string;
    dob: string;
    height: string;
    restingHr: string;
    maxHr: string;
    lt1Hr: string;
    lt2Hr: string;
    vo2Max: string;
    saveProfile: string;
    thresholdsCardTitle: string;
    autoMaxHrNote: string;
    manualMaxHrNote: string;
    observedPeak: string;
    tanakaFallback: string;
    lockCustomMaxHr: string;
    calibratedFromActualRunData: string;
    estimatedBaselineNoHardEfforts: string;
    manualMaxHrLabel: string;
    manualMaxHrHint: string;
    autoCalibrateCheckbox: string;
    trainingZonesPreview: string;
    zone1Title: string;
    zone1Name: string;
    zone1Desc: string;
    zone2Title: string;
    zone2Name: string;
    zone2Desc: string;
    zone3Title: string;
    zone3Name: string;
    zone3Desc: string;
    zone4Title: string;
    zone4Name: string;
    zone4Desc: string;
    zone5Title: string;
    zone5Name: string;
    zone5Desc: string;
    iDontKnowMaxHr: string;
    readOnlyBaseline: string;
    thresholdHeartRate: string;
    yearsUnit: string;
    /** Template with an `{hr}` token. */
    tanakaMaxShort: string;
    /** Template with `{hr}`, `{activity}` and `{date}` tokens. */
    observedPeakNote: string;
    /** Template with `{age}` and `{hr}` tokens. */
    tanakaFormulaNote: string;
    /** Template with `{resting}` and `{max}` tokens. */
    zonesHeaderSummary: string;
    restingHrRangeError: string;
    restingHrPlaceholder: string;
    maxHrPlaceholder: string;
    savedRecomputing: string;
    saved: string;
    /** Shown when GET /api/profile fails. */
    loadFailed: string;
    /** Fallback when PATCH /api/profile fails with an unmapped code. */
    saveFailed: string;
  };
  upload: {
    currentFile: string;
    title: string;
    dragDrop: string;
    selectFiles: string;
    overwriteTip: string;
    importingCount: string;
    uploadingFiles: string;
    decodingFiles: string;
    reanalysingRuns: string;
    busy: string;
    importedCard: string;
    skippedCard: string;
    nonRunCard: string;
    errorsCard: string;
    alreadyInDatabase: string;
    retryWithOverwrite: string;
    viewRun: string;
    done: string;
    errorDetails: string;
    batchSuccess: string;
    batchWarnings: string;
    batchFailed: string;
    fitZipOnly: string;
    /** Fallback per-file error when an upload fails with an unmapped code. */
    importFailed: string;
    importFailedReason: string;
    errorOverrides: Record<string, string>;
    dupTip: string;
    /** Plural copy for the number of skipped duplicate files. */
    skippedFiles: PluralForms;
  };
  backup: {
    directoryPlaceholder: string;
    cardTitle: string;
    cardSubtitle: string;
    downloadSnapshot: string;
    downloadSnapshotDesc: string;
    downloadButton: string;
    manualBackupTitle: string;
    manualBackupDesc: string;
    backupNowButton: string;
    backupSuccess: string;
    backupFailed: string;
    dbSize: string;
    totalRuns: string;
    recentBackups: string;
    restoreFileButton: string;
    restoreSuccessWithCount: string;
    restoreFailed: string;
    restoring: string;
    settingsSaved: string;
    selectFolder: string;
    folderSelectionFailed: string;
    backingUp: string;
    localSnapshots: string;
    retentionPolicy: string;
    noSnapshots: string;
    tableSnapshotName: string;
    tableCreated: string;
    tableSize: string;
    tableAction: string;
    rollback: string;
    deleteAction: string;
    deleteSnapshotConfirm: string;
    deleteSnapshotSuccess: string;
    deleteSnapshotFailed: string;
    deletingSnapshot: string;
    saveSettings: string;
    restoreConfirm: string;
    refreshAction: string;
    openFolderAction: string;
  };
  databaseLocation: {
    title: string;
    description: string;
    current: string;
    nextStart: string;
    loading: string;
    chooseFile: string;
    useExisting: string;
    copyHere: string;
    pickerHint: string;
    existingHint: string;
    newHint: string;
    confirmExisting: string;
    confirmCopy: string;
    restartNeeded: string;
    statusFailed: string;
    selectFailed: string;
    syncFailed: string;
    locationChanged: string;
    overrideActive: string;
    invalidDatabase: string;
    invalidFolder: string;
    maintenanceRunning: string;
    maintenanceFailed: string;
  };
  onboarding: {
    restingHrPlaceholder: string;
    maxHrPlaceholder: string;
    enterDob: string;
    ageLabel: string;
    ageYears: string;
    tanakaUsage: string;
    formulaTanaka: string;
    manual: string;
    calculatedMaxHr: string;
    returnDashboard: string;
    supportedBackups: string;
    brandTitle: string;
    brandSubtitle: string;
    stepRequired: string;
    tabSetup: string;
    tabRestore: string;
    dobLabel: string;
    genderLabel: string;
    genderPlaceholder: string;
    genderHint: string;
    genderPreferNotToSay: string;
    genderMale: string;
    genderFemale: string;
    restingHrLabel: string;
    restingHrHint: string;
    maxHrLabel: string;
    saveAndLaunch: string;
    calibrating: string;
    validationMissing: string;
    restoreDbCardTitle: string;
    restoreDbCardDesc: string;
    dropDbPrompt: string;
    restoreSuccessToast: string;
    /** Fallback when the initial profile save fails with an unmapped code. */
    saveFailed: string;
    localSecurityNote: string;
  };
  footer: {
    offlineEngine: string;
  };
  economyGuide: {
    modalTitle: string;
    speedPart: string;
    hrPart: string;
    formulaResult: string;
    conceptDesc: string;
    tiersTitle: string;
    yourBaseline: string;
    normalizedDesc: string;
    yourCurrentLevel: string;
    nextTarget: string;
    typicalOutput: string;
    developingBase: string;
    developingBaseDesc: string;
    solidRunner: string;
    solidRunnerDesc: string;
    advancedRunner: string;
    advancedRunnerDesc: string;
    competitiveRacer: string;
    competitiveRacerDesc: string;
    eliteMarathoner: string;
    eliteMarathonerDesc: string;
    tipsTitle: string;
    tipLt1Title: string;
    tipLt1Desc: string;
    tipStridesTitle: string;
    tipStridesDesc: string;
    tipLt2Title: string;
    tipLt2Desc: string;
    tipWeatherTitle: string;
    tipWeatherDesc: string;
    gotIt: string;
    paceDeveloping: string;
    paceSolid: string;
    paceAdvanced: string;
    paceCompetitive: string;
    paceElite: string;
    comparisonNote: string;
  };
  vdotGuide: {
    modalTitle: string;
    formulaTitle: string;
    formulaResult: string;
    conceptDesc: string;
    tiersTitle: string;
    estimatedVdot: string;
    yourCurrentLevel: string;
    equivRaceTimes: string;
    recreational: string;
    trainedRunner: string;
    advancedClub: string;
    subElite: string;
    worldClass: string;
    trainingPacesTitle: string;
    easyBase: string;
    marathonPace: string;
    thresholdLt2: string;
    intervalsVo2: string;
    equivHalf: string;
    equivFull: string;
    equivSub15: string;
    equivSub108: string;
    equivSub224: string;
    gotIt: string;
  };
  settingsView: {
    appearanceTitle: string;
    appearanceSubtitle: string;
    themeTitle: string;
    themeSubtitle: string;
    switchToDay: string;
    switchToNight: string;
    fontSizeTitle: string;
    fontSizeSubtitle: string;
    fontCompact: string;
    fontDefault: string;
    fontLarge: string;
    fontXLarge: string;
  };
  garminImport: {
    title: string;
    modalTitle: string;
    description: string;
    pickerTitle: string;
    folderLabel: string;
    chooseFolder: string;
    saveFolder: string;
    scanFolder: string;
    scanning: string;
    saved: string;
    folderUnavailable: string;
    chooseFolderFailed: string;
    saveFailed: string;
    scanFailed: string;
    noFiles: string;
    filesScanned: string;
    resultDetails: string;
    resultImported: string;
    resultDuplicate: string;
    resultNonRunning: string;
    resultError: string;
  };
  trainingLoad: {
    guideTooltip: string;
    acwrValue: string;
    optimalRangeLabel: string;
    maintainingRangeLabel: string;
    recoveryRangeLabel: string;
    overreachingRangeLabel: string;
    loading: string;
    title: string;
    subtitle: string;
    acuteTitle: string;
    acuteDesc: string;
    optimalTitle: string;
    optimalDesc: string;
    chronicTitle: string;
    chronicDesc: string;
    weeklyTitle: string;
    weeklyDesc: string;
    hoverDaily: string;
    hoverAcute: string;
    hoverTunnel: string;
    legend: string;
    guideTitle: string;
    guideIntro: string;
    guideOptimal: string;
    guideMaintaining: string;
    guideRecovery: string;
    guideOverreaching: string;
    gotIt: string;
    /**
     * The API returns status copy as English data, so `en` leaves these maps
     * empty (the payload is used as-is) while `zh` supplies translations keyed
     * by the stable status code. Unknown codes fall back to the API string.
     */
    statusLabels: Record<string, string>;
    statusDescriptions: Record<string, string>;
  };
  periodProgress: {
    bestLt1Tooltip: PluralForms;
    bestLt2Tooltip: PluralForms;
    window3m: string;
    window6m: string;
    window12m: string;
    windowAllTitle: string;
    windowAll: string;
    hoursUnit: string;
    /** Template with `{hours}` and `{pct}` tokens. */
    zone2Summary: string;
    loggedActivities: PluralForms;
    /** Template with a `{count}` token. */
    activeMonthsSuffix: string;
    calibrations: PluralForms;
    calibrationsShort: PluralForms;
    /** Templates with `{shown}` and `{total}` tokens. */
    loadMoreCards: string;
    showAllInChart: string;
    loadPreviousMonths: string;
    collapseCards: string;
    /** Template with a `{year}` token, e.g. `{year} Season`. */
    seasonLabel: string;
    chartRunCount: PluralForms;
    chartPointAriaLabel: string;
    selectedChartPoint: string;
  };
  bestEfforts: {
    measured: string;
    estimated: string;
    measuredDescription: string;
    estimatedDescription: string;
    loading: string;
    title: string;
    subtitle: string;
    allTime: string;
    empty: string;
    /**
     * Overrides for benchmark distance labels returned by the API.
     * `en` leaves this empty (the payload is already English).
     */
    distanceLabels: Record<string, string>;
  };
  thresholdTrends: {
    rollingDesc: string;
    showRolling: string;
    showIndividual: string;
    chartPointAriaLabel: string;
  };
  progressExtras: {
    calibrationRun: string;
    steadyCalibrationRun: string;
    /** Templates with a `{shown}` and `{total}` token. */
    loadMoreCalibrations: string;
    showAllFiltered: string;
  };
  /**
   * Copy for stable API error codes (`ApiRequestError.code`), selected by
   * `apiErrorMessage()` so no component renders the raw server message.
   */
  apiErrors: {
    /** Generic HTTP failure / network error (`ERR_API`). */
    generic: string;
    invalidMaxHr: string;
    invalidRestingHr: string;
    invalidProfileInput: string;
    profileSaveFailed: string;
    invalidTags: string;
    invalidActivityInput: string;
    noFieldsToUpdate: string;
    activityNotFound: string;
    profileNotFound: string;
    coachSummaryNotFound: string;
    invalidResponse: string;
    noGps: string;
    zipInvalid: string;
    devDiagnosticsFailed: string;
  };
}
