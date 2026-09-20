# AEROLAB 🏃‍♂️ — Physiological Running Analytics

A local-first, high-performance running analytics platform and dashboard designed to ingest Garmin run data (both native `.fit` binary files and exported `.csv` files), store it in a single embedded SQLite database, and track real-time physiological adaptations over time:
- **LT1 (Aerobic Threshold / VT1)** pace and heart rate progression
- **LT2 (Lactate / Anaerobic Threshold / VT2)** pace and heart rate progression with dynamic turnpoint modeling
- **Running Economy**: Efficiency Factor (Speed / HR), Meters per Heartbeat, and Aerobic Decoupling (Pa:Hr drift %)
- **Pace-Dependent Economy Curves**: Real-world efficiency curves comparing easy base vs. threshold workouts
- **Automatic Interval & Stride Detection**: Isolates structured work reps, recoveries, and explosive strides (15–40s bursts), recording Peak Pace, Peak Cadence, Min Ground Contact Time (GCT), and Heart Rate Recovery (HRR) drop
- **Transparent Physiological Execution Score (3-Tier: Bronze / Silver / Gold)**: Granular 100-point scoring engine with itemized point breakdowns for aerobic stability, cadence discipline, decoupling drift, and pacing adherence
- **Intelligent Physiological Debrief**: Algorithmic coaching summary that flags "accidental tempos" (grey-zone cardiac drift), identifies failed or aborted workouts, detects uphill ramp walks, and provides actionable recovery recommendations
- **Built-in Google Drive Cloud Sync**: 1-click Google sign-in with zero manual credentials setup; syncs database snapshots to Google Drive and supports 1-click cloud restoration
- **Automated Local Backup Rotation**: Scheduled weekly SQLite snapshots with a rolling 10-backup retention policy
- **Full Bilingual Localization (English & 简体中文)**: Key-based dictionaries with `Intl`-driven date and plural formatting (never inline language conditionals), covering the interface, AI coach advice, activity tags, and physiological guides with an instant navbar dropdown switcher
- **Customizable Typography & Font Scaling**: Smooth 25% font-scaling increments (75%, 100%, 125%, 150%, 175%, 200%)
- **Period Progress & Training Volume**: Monthly and annual mileage breakdowns, weekly volume cadence, and 5-zone cardiovascular distribution
- **Calibrated Race Predictions**: Jack Daniels VDOT and Critical Velocity projections for 5K, 10K, Half Marathon, and Marathon based on empirical physiological thresholds
- **Ultra-Lightweight Standalone Windows App**: 47 MB native Windows installer (`AEROLAB-Setup.exe`) running in isolated App Mode using your existing Chrome or Edge browser (0 MB Chromium bloat)

---

## Architecture & Design Principles

### 1. Single SQLite Database (`data/runs.db`) vs. Multi-DB
AEROLAB uses a **single SQLite database file** operating in **WAL (Write-Ahead Logging)** mode:
- **Relational Integrity**: Runs, kilometer splits, interval reps, coach summaries, and physiological thresholds are linked by foreign keys and updated in atomic transactions.
- **Cross-Tab Queries**: The `Browse`, `Progress`, and `Stats` views query the same unified dataset without cross-database coordination or synchronization overhead.
- **Sub-Millisecond Speed**: Embedded SQLite queries execute locally in < 1 ms.
- **Zero-Fuss Backup**: Your entire running history is contained in one portable file (`data/runs.db`).

### 2. Dual Ingestion: Native FIT & CSV Support with Zero Raw Bloat
AEROLAB supports both native Garmin binary `.fit` files and exported `.csv` files:
- **Direct FIT Decoding**: Built-in FIT binary stream parser (`fit-decoder`) decodes native compressed Garmin FIT files directly without third-party cloud uploaders.
- **Web UI Ingestion**: Drag-and-drop CSV or FIT files are parsed **in-memory** in the browser and transmitted directly to SQLite. No raw files linger on disk.
- **CLI Ingestion**: The CLI importer supports the `--clean` flag, which ingests files from `data/raw/` and immediately deletes source files once safely committed to SQLite.
- **Git Protection**: `.gitignore` strictly ignores `*.csv`, `*.fit`, and `data/*.db` to keep your git repo ultra-lightweight.

### 3. Smart Downsampling & Compact Storage
High-frequency 1Hz time-series data is compacted by ~75% before saving to SQLite:
- **Steady-State Runs**: Downsampled to 5-second intervals, preserving physiological trends without storing redundant 1Hz data.
- **Strides & Fast Intervals**: Automatically preserved at 1–2 second resolution to accurately record peak sprint velocity, cadence spikes, and ground contact time minima.
- **Elevation Preservation**: Altitude (`altitude_m`) is strictly preserved across all samples to track gradients, bridges, and uphill ramp walking.
- **Stripped GPS**: High-frequency GPS latitude and longitude are discarded from time-series points to save space and protect runner privacy.

### 4. Accurate Microclimate Weather & Core Centroid
Weather conditions in tropical climates vary dramatically across short distances:
- Rather than sampling weather at the runner's doorstep (which biases every run to the starting location), AEROLAB trims the warmup (first 5 min / 20%) and cooldown (last 3–5 min / 15%) to calculate the **mathematical geographic centroid** of the core workout segment.
- This centroid is stored as `workout_lat` and `workout_lon` on the activity, enabling hyper-local weather lookups while keeping home coordinates private.

### 5. Google Drive Cloud Sync & Local Backup Rotation
- **Zero-Config Google OAuth**: Comes with a pre-configured Google OAuth Client ID out of the box. Athletes simply click **Sign in with Google** to authorize without setting up cloud credentials.
- **Google Drive Backup Folder**: Snapshots are synced automatically to an `AEROLAB_Backups` folder in the user's personal Google Drive.
- **1-Click Restore**: Restore any past database snapshot directly from Google Drive or local file drops. A safety backup of the current database is automatically created before any restore operation.
- **Rolling Local Backup Retention**: Automatic rolling retention policy retains the 10 most recent backups and automatically prunes older files to prevent disk clutter.

---

## How AEROLAB Differs from Garmin Connect

Garmin Connect gives you a great overview of what you did. AEROLAB tells you **how well you executed it** and whether the work is actually building the fitness you're targeting.

| Capability | Garmin Connect | AEROLAB |
| :--- | :---: | :---: |
| Activity map, HR, pace, cadence charts | ✅ | ✅ |
| Weekly / monthly mileage totals | ✅ | ✅ |
| Zone distribution (5-zone HR model) | ✅ | ✅ |
| Garmin "Training Status" / body battery | ✅ | — |
| **Aerobic decoupling (Pa:Hr drift %)** | — | ✅ |
| **Efficiency Factor & Meters per Beat trends** | — | ✅ |
| **LT1 / LT2 threshold pace & HR progression over time** | — | ✅ |
| **Automatic "accidental tempo" flagging** (easy run that drifted grey-zone) | — | ✅ |
| **Transparent execution scoring with itemized point breakdown** | — | ✅ |
| **Stride detection with peak cadence, min GCT, HR recovery drop** | — | ✅ |
| **Traffic stop & walk break isolation** (prevents stop-light distortion) | — | ✅ |
| **VDOT race predictions from actual physiological thresholds** (not just recent pace) | — | ✅ |
| **Workout centroid weather** (tracks conditions where you actually ran, not your doorstep) | — | ✅ |
| **Google Drive automatic cloud sync & 1-click restore** | — | ✅ |
| **Bilingual interface (English & 简体中文)** | — | ✅ |
| **Customizable UI font size scaling (75% to 200%)** | — | ✅ |
| **Editable runner's notebook** attached to each session | — | ✅ |
| Your data leaves your machine | ✅ | ❌ (local-first) |

**The core gap**: Garmin gives you data. AEROLAB gives you a **physiological verdict** — did this run serve its purpose? Was it a genuine Zone 2 stimulus, or did it quietly drift into grey-zone tempo territory? Are you actually building aerobic capacity, or just accumulating junk miles at the wrong intensity?

---

## Physiological Execution Scoring (3-Tier)

Every workout is evaluated by an algorithmic coach engine that computes a transparent **0–100 Physiological Execution Score** based on objective biomechanical and cardiovascular criteria:

### Scoring Tiers
| Emblem | Score Band | Execution Standard |
| :---: | :---: | :--- |
| ★★★ Gold | **85–100** | **Near-Perfect Execution**: Stable HR under LT1, decoupling < 3.5%, optimal cadence (>= 174 spm), tight pacing adherence. |
| ★★☆ Silver | **70–84** | **Solid Stimulus**: Productive aerobic work; minor thermal drift (< 6%) or slight cadence variance without compromising intent. |
| ★☆☆ Bronze | **< 70** | **Compromised Session**: Accidental tempo grey-zone creep, heavy cardiac drift (> 8%), aborted interval set, or pace collapse. |

> **Hard caps**: Accidental tempo runs and aborted workouts are capped at Bronze (max 69 / 100) regardless of other factors.

### Itemized Point Factors
Clicking the Coach AI score pill in the dashboard opens the **Interactive Breakdown Modal**, displaying exact point additions and deductions:
- **Baseline Intent**: Starts at **85 points** for steady aerobic base runs or completed interval sets.
- **Aerobic Decoupling (Pa:Hr)**:
  - Drift < 3%: **+5 points** (aerobic rock)
  - Drift < 5%: **+3 points** (stable)
  - Drift 5–8%: **-8 points** (moderate thermal/cardiac drift)
  - Drift > 8%: **-14 points** (severe drift)
- **Biomechanical Cadence**:
  - Steady running cadence >= 175 spm: **+4 points**
  - High cadence variance (SD > 8 spm): **-5 points**
  - Low cadence (< 164 spm): **-3 points**
- **Pacing Intent Violations ("Accidental Tempos")**:
  - If an easy run creeps into Zone 4 / LT2 (> 164 bpm), a **-15 point pacing penalty** is applied and the score is hard-capped at **Bronze**.
- **Strides & Neuromuscular Sharpening**:
  - Strides with peak cadence >= 190 spm and crisp recovery drop: **+4 points**.

---

## Workout Classification Logic

AEROLAB automatically classifies each activity into one of six core categories:
1. **Recovery Run (`recovery`)**:
   - Short shakeouts (<= 50 minutes).
   - Low cardiovascular strain: Average HR <= 136 bpm (or < 72% of max HR).
   - Governed by **duration and HR only** — distance is irrelevant for recovery classification.
2. **Easy Aerobic Base (`easy_base`)**:
   - Standard aerobic endurance runs sustained below LT1 (~138 - 150 bpm).
   - Monitored for aerobic decoupling (Pa:Hr) and steady-state efficiency factor.
   - **Galloway Method Support**: Automatically detects runs with structured run/walk intervals (>= 4 walk breaks with low cadence/pace) and preserves their easy base classification.
   - **Surge Protection**: Isolated strides or short surges (<= 3 surges) are recognized without falsely labeling the session as VO2 max intervals.
3. **Long Run (`long_run`)**:
   - Extended endurance volume (>= 75 minutes on feet).
   - Governed by **duration only** — distance is not a trigger.
4. **Lactate Threshold (`threshold_lt2`)**:
   - Sustained intervals or continuous tempo in Zone 4 (>= 165 bpm, work reps >= 6 - 8 minutes).
5. **VO2 Max Intervals (`intervals_vo2`)**:
   - Repetitions sustained at high intensity (1 - 5 minutes) with Zone 5 HR peaks (> 85% max HR).
6. **Race / Time Trial (`race`)**:
   - Competitive races, parkruns, or benchmark all-out time trials.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Verify Your Change
Type-check, lint, and run the full suite (54 test files, 365 automated tests, 100% passing) spanning physiology unit tests, binary/CSV ingestion, API integration, and React UI user flows:
```bash
npx tsc --noEmit      # 0 errors
npm run lint          # ESLint: hardcoded labels, hardcoded run stats, empty catches
npm test              # Vitest
npm run test:coverage # optional V8 coverage report
npm run i18n:unused   # fails if a dictionary key is never referenced
```

### 3. Start Backend & Frontend Concurrently (Development Mode)
```bash
npm run dev
```
Starts both the Express REST API (`http://localhost:3001`) and the Vite React UI (`http://localhost:5173`) concurrently in a single terminal on Windows, macOS, or Linux.
- Backend API: `http://localhost:3001`
- Frontend Dashboard: `http://localhost:5173`

### 4. Updating to the Latest Build
```bash
npm run update
```
This cross-platform script executes `git pull`, `npm install`, and recompiles both frontend and backend bundles.

### 5. Packaging the Chromium-Free Windows Desktop Installer
To build the standalone Windows installer on your machine:
```bash
npm run package:chromium-free
```
This produces a single, self-extracting installer executable in `release/AEROLAB-Setup.exe` (~47 MB) with:
- Zero Chromium download overhead (uses host Chrome or Edge in App Mode)
- Native C# launcher (`AEROLAB.exe`, compiled from `launcher.cs` during packaging — it is a build artifact and is **not** tracked in git)
- Embedded Node runtime and production bundles
- Desktop shortcut creation on install

---

## Data Population & Ingestion Methods

AEROLAB offers multiple flexible ways to populate your running history:

### Method A: Drag & Drop in the Web Dashboard (Recommended)
1. Open `http://localhost:5173` (or launch the desktop app).
2. Click the **"Import FIT / CSV"** button in the navigation bar.
3. Drag and drop **one or multiple `.fit` or `.csv` files** (batch multi-file upload supported).
4. Ingestion runs in-memory directly into SQLite with SHA-256 deduplication and an optional overwrite toggle. No raw files linger on disk.

### Method B: Terminal Ingestion CLI (FIT & CSV)
Drop any `.fit` or `.csv` files into `data/raw/` or specify a single file/folder, and run:
```bash
npm run ingest
```
Add `--clean` to automatically delete raw files after successful database ingestion:
```bash
npm run ingest -- --clean
```

### Method C: Python Batch Ingestion Script
For batch-importing from external folders or USB Garmin mounts:
```bash
python scripts/batch_ingest.py --dir "C:/path/to/Garmin/Activities" --clean
```

### Method D: Direct Database Portability (`data/runs.db`)
AEROLAB operates on a **single embedded SQLite WAL database file** (`data/runs.db`). To back up or transfer your running history, simply copy `data/runs.db` or use the built-in **Google Drive Sync / Download Snapshot** buttons in the Profile tab.

---

## Dashboard Views & Features

### 0. Day / Night Mode & Typography Customization
- **Theme Switcher**: Instantly toggle between Night Mode (`#07090e`) and Day Mode (`#f1f5f9` / pure white cards).
- **Font Size Customization**: Change UI font scaling across 6 levels (75%, 100%, 125%, 150%, 175%, 200%) directly from the top navbar or the Profile settings tab.
- **Language Switcher**: Switch smoothly between **English** and **简体中文** via the navbar dropdown.

### 1. Browse View
- **Session List & Calendar**: Scrollable chronological list of runs grouped by date with pace, distance, duration, and dynamic tags.
- **Editable Activity Title**: Clean, uncluttered naming. Click the pencil icon to rename any session.
- **Standardized Multi-Tagging**: Tag sessions with presets (`Easy Base`, `Long Run`, `Recovery`, `Threshold`, `VO2 Max`, `Tempo`, `Marathon Pace`, `Strides`, `Race`).
- **Core Segment Filter**: Toggle between "Full Session" and "Core (Minus Warmup/Cooldown)" to inspect steady-state workout telemetry without warmup/cooldown skew.
- **Four Sub-Tabs**:
  1. **Telemetry & Chart**: Interactive canvas scrub chart plotting Pace (cyan), Heart Rate (amber), and Elevation fill, plus key physiological chips and a compact 1km splits preview.
  2. **KM Splits**: Interactive Kilometer Split Visualizer with proportional horizontal bars, pacing dynamics insights (Fastest/Slowest Split, Pace Spread, and Negative/Positive split strategy classifier), with on-the-fly metric switching across **Pace**, **Heart Rate**, **Efficiency Factor**, and **Elevation**.
  3. **Strides & Intervals**: Dedicated breakdown of detected strides and interval work reps with Rep #, Type, Duration, Distance, Avg & Peak Pace, Avg & Peak Cadence, Min Ground Contact Time, and Recovery HR Drop.
  4. **Notes & AI Coach**: Intelligent physiological debrief with clickable **Score Breakdown Modal**, grading rubric, and an editable, auto-saving runner's notebook.

### 2. Progress View
- **Physiological Threshold Trends (LT1 & LT2)**: Interactive timeline chart visualizing the progression of your Aerobic Base (LT1) and Lactate Threshold (LT2) over time, with instant toggles between **Pace Trend (min/km)** and **Heart Rate Trend (bpm)**, time-range filtering (`All Time`, `6 Months`, `3 Months`), interactive hover tooltips, and active baseline reference lines.
- **Period Progress & Mileage**: View total running volume, month-by-month and year-by-year mileage, and zone breakdown distributions.
- **Pace-Dependent Running Economy Curves**: Plots Moving Speed vs. Heart Rate and Meters per Beat across pace bands, with toggleable filters (`All Runs`, `Easy Base`, `Threshold`).
- **Historical Threshold Calibrations**: Organized milestones and data table bounded in a sleek scroll container with filter pills (`All`, `LT1 Base`, `LT2 Threshold`, `Race`) to easily navigate historical recalibrations.

### 3. Stats View
- **Physiological Benchmark Cards**: Current LT1 Pace & HR, LT2 Pace & HR, VO2 Max estimate, and 30-day baseline Running Economy.
- **Calibrated Heart Rate Zones**: 5-zone cardiovascular distribution dynamically derived from HRR, LT1 ceiling (~148 bpm), and LT2 turnpoint (~172 bpm).
- **Aerobic Turnpoint Margin & Guide**: Measures the pace gap between LT1 easy base and LT2 threshold. Click the info button to open the educational modal featuring benchmark tiers (Optimal <= 50s, Well-Conditioned 50 - 70s, Base Opportunity > 70s).
- **Calibrated Race Time Predictions**: VDOT-derived finish times, average pace, and kilometer splits for 5K, 10K, Half Marathon, and Marathon.

### 4. Profile View
- **Cardiovascular Baselines**: Resting HR, Max HR engine, and VO2 Max.
- **Max Heart Rate Engine & Auto-Inference**: Automatically infers peak heart rate from your hardest actual workout efforts (e.g. 5K time trial at 203 bpm), with an opt-out toggle to auto-estimate via the Tanaka formula (208 - 0.7 * age) or manual baseline entry.
- **Inferred Physiological Thresholds**: Visual reference card displaying active LT1 and LT2 paces and heart rates calibrated from empirical training sessions.
- **Google Drive Cloud Sync & Local Backups**: One-click Google sign-in, instant Google Drive backup/restore, local backup directory setting, and immediate database snapshot download.
- **Display & Typography**: Font size selector pills with live typography sample preview.

---

## Database Schema (`data/runs.db`)

| Table | Description |
| :--- | :--- |
| `activities` | Master run records (date, distance, duration, avg pace, HR, cadence, vertical oscillation, stance time, EF, decoupling %, tags, `workout_lat`, `workout_lon`, notes, `run_type`, `auto_run_type`). |
| `activity_splits` | 1km splits (distance, duration, split pace, split HR, split EF, elevation delta). |
| `activity_intervals` | Detected interval reps, strides, and recovery blocks with peak dynamics and recovery drops. |
| `activity_records` | Compacted time-series telemetry (elapsed seconds, HR, cadence, speed, distance, elevation, temperature). High-frequency GPS stripped. |
| `activity_coach_summaries` | AI Coach debrief: headline, recommendation, effectiveness score (0–100), stars (1–3), rating5, key insights JSON, and itemized `score_breakdown_json`. |
| `physiological_thresholds` | Historical calibration points for LT1, LT2, and 30-day baseline Running Economy. |
| `athlete_profile` | Athlete configuration: max HR, resting HR, LT1/LT2 baselines, and demographic calibration. |
| `google_auth` | OAuth token cache and configuration for Google Drive cloud synchronization. |
| `database_settings` | Configuration for automated local backup cadence and retention policies. |

---

## Physiological Metrics & Formulations

### 1. Running Economy (Efficiency Factor)
- `EF = Moving Speed (m/min) / Average Heart Rate (bpm)`
- Measures output speed per heartbeat.
- Pauses, red lights, and zero-cadence intervals are automatically excluded to prevent idle distortion.

### 2. Aerobic Decoupling (Pa:Hr Drift %)
- `Decoupling = ((EF_first_half - EF_second_half) / EF_first_half) * 100%`
- **< 3.5%**: Superior aerobic endurance base. Cardiac drift is virtually absent.
- **3.5 - 5.0%**: Stable aerobic condition.
- **> 5.0%**: Cardiovascular drift occurred (pacing too fast, dehydration, tropical heat, or premature threshold crossing).

### 3. Meters per Beat
- `Meters/Beat = Total Distance (m) / Total Heartbeats`
- Direct biomechanical indicator of stroke volume and cardiac efficiency.

### 4. Interval Dynamics & Recovery Drop (HRR)
- **Peak Speed & Peak Cadence**: Peak values recorded during stride and interval bursts.
- **Min Ground Contact Time (GCT)**: Measures running elasticity and stiffness during high-speed surges.
- **Heart Rate Recovery (HRR) Drop**: Absolute drop in BPM during recovery intervals (e.g., 162 -> 134 bpm = -28 bpm in 60s), reflecting parasympathetic reactivation.

### 5. Jack Daniels VDOT & Oxygen Cost Formula
AEROLAB models maximal oxygen uptake (VDOT) using the Daniels and Gilbert equations:
- Velocity oxygen cost and fractional utilization curves calibrated to empirical race and threshold times.

### 6. Calibrated Race Time Predictions (Critical Velocity & Riegel)
Finish times for 5K, 10K, Half Marathon, and Marathon are modeled by combining Riegel's power-law endurance equation with empirical threshold pacing:
- `T2 = T1 * (D2 / D1)^1.06`
- Calibrated against actual LT1 and LT2 thresholds to prevent overly optimistic projections when aerobic decoupling is elevated.

### 7. Heart Rate Reserve (Karvonen HRR) & Dynamic Zone Model
- `HRR = HR_max - HR_rest`
- Dynamic physiological zones:
  - **Zone 1 (Active Recovery)**: < 54% HRR or < LT1 - 14 bpm
  - **Zone 2 (Aerobic Base)**: [Z1 Upper + 1, LT1]
  - **Zone 3 (Tempo / Aerobic Drift)**: [LT1 + 1, LT2 - 1]
  - **Zone 4 (Lactate Threshold)**: [LT2, ~90% HRR]
  - **Zone 5 (VO2 Max & Anaerobic)**: [> 90% HRR, HR_max]

### 8. Aerobic Turnpoint Margin
- `Margin = Pace_LT1 - Pace_LT2 (seconds/km)`
- **35 - 50s/km (Optimal Anchor)**: Elite endurance profile; LT1 is ~85 - 90% of LT2 velocity.
- **50 - 70s/km (Well-Conditioned Base)**: Balanced endurance for committed marathoners.
- **> 75s/km (Base Expansion Opportunity)**: Indicates Aerobic Deficiency Syndrome (ADS); easy pace lags significantly behind threshold.

### 9. Tanaka Formula for Estimated Max Heart Rate
- `HR_max = 208 - (0.7 * age)`

### 10. Cruising Block LT1 Detection & Recovery Week Protection
- **Cruising Block Extraction**: Instead of whole-run averages (which dilute sustained aerobic work with warmups and walk breaks), AEROLAB scans for contiguous cruising segments (>= 20 mins, >= 3.5 km) with low aerobic decoupling (-8.0% to +3.8%).
- **Stimulus Floor Gate**: Enforces `stimulusFloorHr = Math.max(145, currentLt1 - 5)`. Slower recovery runs (e.g. 130-138 bpm) never touch or depress the athlete's calibrated aerobic threshold.

### 11. Tropical Window & Acceleration Ramp Trimming for LT2
- **Acceleration Ramp Trimming**: Strips the initial 10-12s acceleration ramp from standing/walking starts (< 2.2 m/s), ensuring interval pace reflects true cruising speed matching the athlete's Garmin watch display.
- **Tropical Window (30-Minute Quality Cap)**: High ambient heat and humidity induce progressive hyperthermia and dehydration drift after 30+ minutes of quality work. Quality work evaluation is capped at 1800s (30 mins) to capture the true uncorrupted threshold plateau.
- **Cardiac Lag Compensation**: Evaluates plateau heart rate after recovery drops rather than averaging the initial 60-90s climbing phase.

### 12. Rolling Confidence- & Recency-Weighted Threshold Aggregation
- **Multi-Session Smoothing**: Replaces volatile single-session `LIMIT 1` jumping with a multi-session weighted moving baseline across up to 5 qualifying sessions over a 45-day window.
- **Weighting Formula**: `Weight = Confidence * max(0.25, 1 - (DaysAgo / 45))`.
- **Protocol Confidence**: Awards higher confidence (0.90 - 0.92) to tight-rest threshold intervals (<= 90s) and long aerobic cruising blocks (>= 40m), while applying continuous penalties for extended recoveries (>= 150s).
- **Smooth Profile Sync**: Continuously keeps `athlete_profile` training zones synchronized with the athlete's stable biological baseline without abrupt week-to-week whiplash.

---

## Multi-User Isolation & Database Privacy

AEROLAB is designed with local-first data isolation:
1. **Git Protection**: `data/*.db` and `data/*.db-*` are strictly listed in `.gitignore`.
2. **Fresh Clone**: When a running partner or family member clones the repository on their own machine, they receive an empty `data/` folder and start with a fresh database on first run.
3. **Shared PC Setup**:
   - Keep separate folders (e.g. `C:\gemini-projects\run-progress-GJ` and `C:\gemini-projects\run-progress-partner`).
   - Or configure the `DATABASE_PATH` environment variable in `.env`:
     ```bash
     DATABASE_PATH=data/partner_runs.db
     ```

---

## Contributing & Code Rules

Full rules live in [`AGENTS.md`](AGENTS.md) (`.clinerules` points there). The essentials:

### Localization
All user-facing copy lives in dictionaries — the web equivalent of Android's `values/` and `values-zh/` folders:

| File | Purpose |
| --- | --- |
| `src/frontend/i18n/types.ts` | Typed key surface (`Translations` interface) |
| `src/frontend/i18n/en.ts` | English values |
| `src/frontend/i18n/zh.ts` | Chinese values |
| `src/frontend/i18n/LanguageContext.tsx` | `t`, `format`, `plural`, `formatDate`, `locale` |

```tsx
const { t, format, plural, formatDate } = useTranslation();

t.browse.title                                     // plain lookup
format(t.periodProgress.zone2Summary, { hours: 12, pct: 68 })  // {token} interpolation
plural(count, t.periodProgress.calibrations)       // Intl.PluralRules selection
formatDate(row.start_time, { month: 'short', day: 'numeric' })
```

**Never** write an inline language conditional (`language === 'zh' ? … : …`) and never hardcode a locale such as `'zh-CN'` in a component. Locale identifiers belong in `LOCALES`; adding a language is a one-line change plus one dictionary file. Hardcoded run statistics are equally disallowed — metrics must come from the API payload or a shared helper so they cannot drift from the backend.

### Developer tooling never ships
The diagnostics drawer, the floating dev-mode button, and the whole `/api/dev/*` surface are development-only. The frontend gates them behind `import.meta.env.DEV` (so Vite tree-shakes them out of the release bundle), and the backend refuses to mount the dev router unless `isDevToolsEnabled()` passes. The packaged launcher starts the engine with `NODE_ENV=production`.

### Verification
`npx tsc --noEmit`, `npm run lint`, `npm test`, and `npm run i18n:unused` must all pass before a commit. Use the `gh` CLI for GitHub work (`gh run list`, `gh workflow run release.yml`).

The ESLint config surfaces the remaining pre-existing backlog as **warnings** (currently ~240: hardcoded UI strings, untyped `any` payloads, and React effect patterns) so lint stays a useful, non-blocking signal while it is burned down. Genuinely broken code — including an unannotated empty `catch` — is an **error** and fails the lint.
