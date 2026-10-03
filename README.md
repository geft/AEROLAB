# AEROLAB 🏃‍♂️ — Physiological Running Analytics

A local-first, high-performance running analytics platform and dashboard designed to ingest Garmin run data from native `.fit` files or activity `.zip` downloads, store it in a single embedded SQLite database, export CSV for analysis, and track real-time physiological adaptations over time:

- **LT1 (Aerobic Threshold / VT1)** pace and heart rate progression
- **LT2 (Lactate / Anaerobic Threshold / VT2)** pace and heart rate progression with dynamic turnpoint modeling
- **Running Economy**: Efficiency Factor (Speed / HR), Meters per Heartbeat, and Aerobic Decoupling (Pa:Hr drift %)
- **Pace-Dependent Economy Curves**: Real-world efficiency curves comparing easy base vs. threshold workouts
- **Automatic Interval & Stride Detection**: Combines telemetry with validated FIT lap boundaries to isolate work reps, recoveries, and strides. Timer pauses are excluded from classification evidence; interval summaries include peak pace/cadence, ground contact time, HR recovery, and measured step length/vertical ratio when available
- **Transparent Physiological Execution Score (3-Tier: Bronze / Silver / Gold)**: Granular 100-point scoring engine with itemized point breakdowns for aerobic stability, cadence discipline, decoupling drift, and pacing adherence
- **Intelligent Physiological Debrief**: Algorithmic coaching summary graded by a **run-type weighted rubric**. Easy runs are graded on **one failure mode — going too hard**: sustained time above the personal LT1 ceiling (measured from per-second telemetry with 60 s smoothing) plus sustained time in the top of Zone 2, with a late-session breach excused **only when the run was both long and hot** (a 1 h breach or a 2 h breach in cool weather still counts). Cardiac drift, city pacing variance, walk breaks and turnover are reported as observations rather than penalties. Quality sessions keep grading **structure, cardiovascular stimulus, intensity control, form/efficiency (turnover and ground contact) and set fatigue** — the last compares the final work rep against the first, with drift tolerances that scale with the set's work time and short-rep sets judged on pace alone (heart-rate lag, not decay). Deliberately short recoveries (which hold heart rate near threshold to extend time-in-zone) are reported rather than penalised, and short reps are anchored on their peak heart rate because an average cannot reach the target in under two minutes. **The anchor always comes from the session's intent**: a threshold session whose heart rate drifts upward is flagged as *Drifted Into VO2 Territory* and loses intensity points rather than being re-graded against a VO2 target, and one that never reaches its anchor is flagged as under-stimulus. Races keep their pacing, finish-strength and turnover rubric. Includes **personal-baseline comparisons** against your own recent history, **walk-break classification** that credits walk breaks used to hold heart rate under the LT1 ceiling or to climb, and a **"biggest lever"** fix for the factor that cost the most points
- **Local Backup Rotation**: Manual SQLite snapshots with up to 3 rotating backups, deletion, download and drop-in restore
- **Full Bilingual Localization (English & 简体中文)**: Key-based dictionaries with `Intl`-driven date and plural formatting (never inline language conditionals), covering the interface, AI coach advice, activity tags, and physiological guides with an instant navbar dropdown switcher
- **Customizable Typography & Font Scaling**: Smooth 25% font-scaling increments (75%, 100%, 125%, 150%, 175%, 200%)
- **Period Progress & Training Volume**: Monthly and annual mileage breakdowns, weekly volume cadence, and 5-zone cardiovascular distribution
- **Calibrated Race Predictions**: Jack Daniels VDOT and Critical Velocity projections for 5K, 10K, Half Marathon, and Marathon based on empirical physiological thresholds
- **Training Load & Best Efforts**: 7-day acute load against a 28-day baseline, plus all-time and current-year best efforts and age- and gender-based race benchmarks
- **Garmin Export Folder Scan**: Import new FIT or Garmin activity ZIP exports from a configured local folder, with duplicate and non-run detection
- **Installable Phone Snapshot**: Export a read-only dashboard for a phone and optionally deploy it to a protected Vercel project
- **Ultra-Lightweight Standalone Windows App**: Compact native Windows installer (`AEROLAB-Setup-v<version>.exe`) running in isolated App Mode using your existing Chrome or Edge browser (0 MB Chromium bloat)

---

## Architecture & Design Principles

### 1. Single SQLite Database
AEROLAB uses a **single SQLite database file** operating in **WAL (Write-Ahead Logging)** mode:
- **Relational Integrity**: Runs, kilometer splits, interval reps, coach summaries, and physiological thresholds are linked by foreign keys and updated in atomic transactions.
- **Cross-Tab Queries**: The `Browse`, `Progress`, and `Stats` views query the same unified dataset without cross-database coordination or synchronization overhead.
- **Sub-Millisecond Speed**: Embedded SQLite queries execute locally in < 1 ms.
- **Zero-Fuss Backup**: Your entire running history is contained in one portable SQLite file. Development defaults to `data/runs.db`; the Windows app defaults to `%APPDATA%\aerolab\runs.db`.

### Store the database separately from the app

Open **Settings → Database location** and click **Choose database location**. In the file picker, select an existing `.db` file or enter a new `.db` filename in a folder outside the app. The action button will say **Use this database** for an existing file, or **Copy current database here** for a new file. Copying creates a consistent SQLite snapshot and leaves the original in place. Restart this app to open the selected file.

Each build stores its own database choice. To use the same file in development and the Windows app, select that file independently in each build's Settings. Neither build configures the other. Close both before switching, and avoid running restore or maintenance from both at once.

The development setting can also be changed from this repository with an absolute path to an existing SQLite file:

```powershell
npm run db:location -- "$env:APPDATA\aerolab\runs.db"
```

The preferences live in `%APPDATA%\aerolab\development-database-location.json` and `%APPDATA%\aerolab\desktop-database-location.json`. Run `npm run db:location` without a path to see the development location. Selecting an existing file changes which database an app opens; it does not merge histories. A `DATABASE_PATH` environment variable overrides that app's saved preference.

### 2. Native Garmin FIT & ZIP Imports
AEROLAB imports Garmin binary `.fit` files and original activity `.zip` downloads:
- **Direct FIT Decoding**: Garmin's pinned FIT SDK decodes activities locally. Original FIT bytes and additional telemetry are retained in SQLite.
- **Web UI Ingestion**: Drag and drop FIT or activity ZIP files for local, in-memory ingestion. CSV is available for export only.
- **Garmin Export Folder Scan**: Point Settings to your Garmin FIT or original activity ZIP download folder. Use **Scan & Import** in the navbar to import new activities; duplicates and non-running files are reported and skipped. No extension is required. **Export CSV** remains available for AI analysis. See [FIT import details](docs/fit-import.md).
- **CLI Ingestion**: The CLI importer supports the `--clean` flag, which ingests files from `data/raw/` and immediately deletes source files once safely committed to SQLite.
- **Git Protection**: `.gitignore` strictly ignores `*.csv`, `*.fit`, and `data/*.db` to keep your git repo ultra-lightweight.

### 3. Telemetry Storage & Location Handling
- **Recorded Resolution**: Imported records retain their original timestamps and sampling resolution; ingestion does not apply blanket five-second downsampling.
- **Running Dynamics**: Speed, cadence, HR, elevation, and additional sensor fields are retained when available for interval and economy analysis.
- **Location Handling**: Typed record coordinates retain the workout centroid on the first record rather than the full GPS trace. Original FIT bytes and raw FIT record fields retain source location data; the local database is not a location-redacted export.

### 4. Accurate Microclimate Weather & Core Centroid
Weather conditions in tropical climates vary dramatically across short distances:
- Rather than sampling weather at the runner's doorstep (which biases every run to the starting location), AEROLAB trims the warmup (first 5 min / 20%) and cooldown (last 3–5 min / 15%) to calculate the **mathematical geographic centroid** of the core workout segment.
- This centroid is stored as `workout_lat` and `workout_lon` on the activity, enabling hyper-local weather lookups while keeping home coordinates private.
- Weather lookup runs only when you press **Fetch ambient weather** on a workout. That action sends the workout centroid and date to Open-Meteo. For Singapore, PM2.5 uses the nearest available NEA regional reading; elsewhere, AEROLAB uses an Open-Meteo model estimate when available. The source is shown in the activity details, and high readings can appear in the coach debrief. Imported Garmin temperature remains a device sensor reading and is not treated as ambient temperature.

### 5. Local Backup Rotation & Restore
- **Manual Backup Rotation**: Create a SQLite snapshot when you choose. The target folder keeps up to 3 recent snapshots, and individual snapshots can be deleted from the list.
- **Manual Snapshot Download**: Download a portable `.db` snapshot at any time via the Settings backup panel (one `.db` file contains the whole history).
- **Drop-In Restore**: Drag a `.db` snapshot back in to restore. Binary uploads stream to disk with a 256 MB default limit (configurable with `MAX_RESTORE_BYTES`), and a safety backup of the current database is written before anything is replaced.
- **Local by Default**: The app and backups work without a cloud service. A hosted phone snapshot is optional and only sent when you explicitly deploy it; protect the deployed site because its static export contains training data.

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
| **Local backups with three-file rotation** | — | ✅ |
| **Bilingual interface (English & 简体中文)** | — | ✅ |
| **Customizable UI font size scaling (75% to 200%)** | — | ✅ |
| **Editable runner's notebook** attached to each session | — | ✅ |
| Cloud account required for core analysis | ✅ | ❌ (local-first) |
| Optional hosted read-only phone snapshot | — | ✅ (explicit deploy) |

**The core gap**: Garmin gives you data. AEROLAB gives you a **physiological verdict** — did this run serve its purpose? Was it a genuine Zone 2 stimulus, or did it quietly drift into grey-zone tempo territory? Are you actually building aerobic capacity, or just accumulating junk miles at the wrong intensity?

---

## Physiological Execution Scoring (3-Tier)

Every workout is evaluated by an algorithmic coach engine that uses a **100-point rubric** tailored to the run type. Scores are normalized over the factors with available evidence; final displayed scores are bounded from 40 to 98.

### Scoring Tiers
| Emblem | Score Band | Execution Standard |
| :---: | :---: | :--- |
| ★★★ Gold | **>= 85** | Strong execution of the run-type-specific rubric with sufficient evidence. |
| ★★☆ Silver | **70–84** | Solid execution with room to improve one or more measured factors. |
| ★☆☆ Bronze | **< 70** | The measured execution falls short of the session's target. |

> **Hard caps**: Accidental tempo caps the score at 69; failed workouts cap it at 60. Threshold sessions without sufficient observed target-zone time cannot earn Gold. Limited telemetry constrains what the rubric can certify.

### Itemized Point Factors
Clicking the Coach AI score pill opens the **Interactive Breakdown Modal**, showing each measured factor's earned points, available weight, and explanation:

- **Easy runs** emphasize aerobic intensity discipline relative to personal LT1. Drift, pace variation, cadence, and walk breaks supply context rather than universal bonus/penalty rules.
- **Quality sessions** assess completion, cardiovascular stimulus, intensity control, form/efficiency, and rep-to-rep fatigue. Threshold sessions also require observed time in their target HR band.
- **Races** use their pacing, finish-strength, and turnover rubric.
- **Coverage** identifies missing evidence, and the coaching summary highlights the factor offering the largest improvement.

---

## Workout Classification Logic

AEROLAB classifies recorded effort using the athlete's historical LT1, LT2, maximum HR, and resting HR profile. Workout intensity comes from HR; segmentation also uses movement telemetry and within-run speed contrast. Titles, fixed training paces, and distance do not determine the label.

The six core categories are:

1. **Recovery Run (`recovery`)**: Up to 50 minutes of observed running with very low cardiovascular strain relative to personal heart-rate reserve and negligible exposure at or above LT1. Walking and stops cannot dilute the running HR evidence.
2. **Easy Aerobic Base (`easy_base`)**: Aerobic running that does not meet the quality, race, long-run, or recovery criteria. Aerobic run/walk sessions and isolated strides can retain this label; tempo exposure is reported through tags.
3. **Long Run (`long_run`)**: At least 110 minutes of session timer duration when quality/race criteria do not take precedence. Distance is not a trigger.
4. **Lactate Threshold (`threshold_lt2`)**: Sustained work intervals or continuous effort with sufficient exposure near or above the athlete's LT2 training band.
5. **VO2 Max Intervals (`intervals_vo2`)**: Repeated work/recovery structure with profile-relative high-intensity HR evidence. Threshold HR alone does not establish VO2 work.
6. **Race / Time Trial (`race`)**: A dominant continuous bout of sufficiently sustained, near-maximal cardiovascular effort. Recoveries, timer pauses, and recording gaps interrupt continuous evidence.

### FIT laps, timer events, and additional telemetry

- **Structure supports segmentation**: Recorded active/recovery/rest/warmup/cooldown laps refine boundaries only when running telemetry and HR validate quality work. Ordinary all-active distance autolaps cannot manufacture repetitions. Both structured and unstructured easy runs remain supported; having structure does not itself imply speedwork.
- **Timer pauses are excluded**: FIT start/stop events separate active traces and prevent paused HR from contributing to classification. Explicit pauses also contribute to the saved pause breakdown. Raw telemetry and original FIT bytes remain available for export.
- **Failed reps and strides remain visible**: Once quality structure is validated, lower-HR late active reps remain work reps so missed stimulus and fatigue can be detected. Telemetry-detected strides inside warmups/recoveries are retained.
- **Measured running dynamics refine summaries**: Valid measured step length and vertical ratio take precedence over derived interval values. They do not independently determine workout intensity.
- **Other telemetry remains supporting data**: Developer fields, device metadata, and HRV do not currently affect classification. Power, respiration rate, core temperature, and ground contact balance are retained for possible future refinements; no new intensity rules use them.
- **Consistent historical replay**: Import and reanalysis share the same FIT-aware classification. A one-time migration creates a safety backup and refreshes existing histories while preserving manual overrides. Older runs or invalid/incomplete lap data use telemetry-only detection.

These timer refinements apply to classification, segmentation, and running-economy summaries. Other raw-record consumers, including coach calculations and training-load recomputation, do not yet reconstruct timer state from FIT metadata themselves.

See [FIT telemetry and classification](docs/fit-classification.md) for the implementation safeguards and telemetry review, and [FIT import details](docs/fit-import.md) for retained fields and units.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Verify Your Change
Type-check, lint, and run the full suite spanning physiology unit tests, binary/CSV ingestion, API integration, and React UI user flows:
```bash
npx tsc --noEmit      # 0 errors
npm run lint          # ESLint: hardcoded labels, hardcoded run stats, empty catches
npm test              # Vitest
npm run test:coverage # optional V8 coverage report
npm run i18n:unused   # fails if a dictionary key is never referenced
```

### Visual Layout Checks

Targeted Playwright screenshots cover the Browse session sidebar, metric cards,
guide cards, and coach summary, plus Progress benchmarks and trends, Stats volume
and guide cards, and Profile thresholds and training zones at desktop and mobile
sizes. They capture those components only, not the full app window. Install
Playwright's Chromium browser automatically, run the checks, and open the combined
HTML report with one command:

```bash
npm run visual
```

The separate `npm run test:visual` and `npm run test:visual:report` commands are
available when you want to run or view those steps independently.

When a UI change intentionally changes a baseline, review the HTML diff and run
`npm run test:visual:update` to accept the new screenshots. Baselines are
platform-specific; these committed images use Chromium on Windows.

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
This produces a single, self-extracting installer executable in `release/AEROLAB-Setup-v<version>.exe` with:
- Zero Chromium download overhead (uses host Chrome or Edge in App Mode)
- Native C# launcher (`AEROLAB.exe`, compiled from `launcher.cs` during packaging — it is a build artifact and is **not** tracked in git)
- Embedded Node runtime and production bundles
- Desktop shortcut creation on install
- A random per-launch local session: the launcher opens a one-time bootstrap URL, and the API requires the resulting HttpOnly cookie. Only the app's origin may make browser API requests.

---

## Data Population & Ingestion Methods

AEROLAB offers multiple flexible ways to populate your running history:

### Method A: Drag & Drop in the Web Dashboard (Recommended)
1. Open `http://localhost:5173` (or launch the desktop app).
2. Click the **"Import FIT / ZIP"** button in the navigation bar.
3. Drag and drop **one or multiple `.fit` or `.zip` files** (batch multi-file upload supported).
4. Ingestion runs in-memory directly into SQLite with SHA-256 deduplication and an optional overwrite toggle. No raw files linger on disk.

### Method B: Terminal Ingestion CLI (FIT & ZIP)
Drop any `.fit` or `.zip` files into `data/raw/` or specify a single file/folder, and run:
```bash
npm run ingest
```
Add `--clean` to automatically delete raw files after successful database ingestion:
```bash
npm run ingest -- --clean
```

### Method C: Scan a Garmin export folder
1. In **Settings → Import Garmin Runs**, choose and save your Garmin FIT or original activity ZIP download folder. No conversion or extension is required.
2. Select **Scan & Import** in the navbar. AEROLAB imports new supported activities and reports duplicates, non-running files, and errors.

### Method D: Python Batch Ingestion Script
For batch-importing from external folders or USB Garmin mounts:
```bash
python scripts/batch_ingest.py --dir "C:/path/to/Garmin/Activities" --clean
```

### Method E: Direct Database Portability (`data/runs.db`)
AEROLAB operates on a **single embedded SQLite WAL database file**. Development defaults to `data/runs.db`; the Windows app defaults to `%APPDATA%\aerolab\runs.db`. Settings shows the active location. To back up or transfer your running history, use **Download Snapshot** in the backup panel so the copy includes committed WAL data.

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
  4. **AI Coach Debrief**: Easy runs are scored on intensity control alone (time above your LT1 ceiling and in the top of Zone 2, with a late breach excused only for long, hot sessions), plus a categorical session-integrity gate; quality sessions score structure, stimulus, intensity control, form/efficiency and set fatigue (deliberately short recoveries are reported, not penalised); races score pacing, finish strength and turnover. The debrief shows each factor's earned points against its weight, rubric coverage, a "biggest lever" fix, and personal-baseline comparisons against your own recent runs.

### 2. Progress View
- **Physiological Threshold Trends (LT1 & LT2)**: Interactive timeline chart visualizing the progression of your Aerobic Base (LT1) and Lactate Threshold (LT2) over time, with instant toggles between **Pace Trend (min/km)** and **Heart Rate Trend (bpm)**, time-range filtering (`All Time`, `6 Months`, `3 Months`), interactive hover tooltips, and active baseline reference lines.
- **Period Progress & Mileage**: View total running volume, month-by-month and year-by-year mileage, and zone breakdown distributions.
- **Pace-Dependent Running Economy Curves**: Plots Moving Speed vs. Heart Rate and Meters per Beat across pace bands, with toggleable filters (`All Runs`, `Easy Base`, `Threshold`).
- **Historical Threshold Calibrations**: Organized milestones and data table bounded in a sleek scroll container with filter pills (`All`, `LT1 Base`, `LT2 Threshold`, `Race`) to easily navigate historical recalibrations.

### 3. Stats View
- **Physiological Benchmark Cards**: Current LT1 Pace & HR, LT2 Pace & HR, VO2 Max estimate, and 30-day baseline Running Economy.
- **Calibrated Heart Rate Zones**: 5-zone cardiovascular distribution dynamically derived from HRR, LT1 ceiling (~148 bpm), and LT2 turnpoint (~172 bpm).
- **Training Load**: Acute 7-day load, 28-day chronic baseline, their optimal range, and a status summary; choose a 7–90 day timeline.
- **Aerobic Turnpoint Margin & Guide**: Measures the pace gap between LT1 easy base and LT2 threshold. Click the info button to open the educational modal featuring benchmark tiers (Optimal <= 50s, Well-Conditioned 50 - 70s, Base Opportunity > 70s).
- **Calibrated Race Time Predictions**: VDOT-derived finish times, average pace, and kilometer splits for 5K, 10K, Half Marathon, and Marathon, with age- and gender-based benchmark tiers when profile details are available.
- **Personal Best Efforts**: Fastest continuous telemetry segments at tracked race distances, shown for all time or the current year.

### 4. Profile View
- **Cardiovascular Baselines**: Resting HR, Max HR engine, and VO2 Max.
- **Max Heart Rate Engine & Auto-Inference**: Automatically infers peak heart rate from your hardest actual workout efforts (e.g. 5K time trial at 203 bpm), with an opt-out toggle to auto-estimate via the Tanaka formula (208 - 0.7 * age) or manual baseline entry.
- **Inferred Physiological Thresholds**: Visual reference card displaying active LT1 and LT2 paces and heart rates calibrated from empirical training sessions.
- **Local Backups**: Manual SQLite snapshots with a configurable folder, three-file rotation, per-snapshot deletion, and immediate database snapshot download.
- **Display & Typography**: Font size selector pills with live typography sample preview.

---

## Database Schema (`data/runs.db`)

| Table | Description |
| :--- | :--- |
| `activities` | Master run records (date, distance, duration, avg pace, HR, cadence, vertical oscillation, stance time, EF, decoupling %, tags, `workout_lat`, `workout_lon`, notes, `run_type`, `auto_run_type`). |
| `activity_splits` | 1km splits (distance, duration, split pace, split HR, split EF, elevation delta). |
| `activity_intervals` | Detected interval reps, strides, and recovery blocks with peak dynamics and recovery drops. |
| `activity_records` | Stored time-series telemetry: elapsed seconds, HR, cadence, speed, distance, elevation, temperature, running dynamics, and additional sensor fields when available. |
| `activity_fit_details` | Original FIT bytes and metadata, including laps, timer events, workout steps, devices, HRV, and developer fields. |
| `activity_coach_summaries` | AI Coach debrief: headline, recommendation, execution score (0–100) from a run-type weighted rubric, stars (1–3), rating5, key insights JSON, itemized `score_breakdown_json` (points vs. weight per factor) and `analysis_json` (personal-baseline context, biggest lever, rubric coverage). |
| `physiological_thresholds` | Historical calibration points for LT1, LT2, and 30-day baseline Running Economy. |
| `athlete_profile` | Athlete configuration: max HR, resting HR, LT1/LT2 baselines, and demographic calibration. |
| `database_settings` | (Reserved; backup folder preference is stored in the athlete profile.) |

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
  - **Zone 1 (Active Recovery)**: Up to the lower of the rounded 54% HRR anchor and LT1 - 14 bpm
  - **Zone 2 (Aerobic Base)**: [Z1 Upper + 1, LT1]
  - **Zone 3 (Tempo / Aerobic Drift)**: Above LT1, with its ceiling capped at the rounded 80% HRR anchor and LT2 - 1, and kept at least one bpm above LT1
  - **Zone 4 (Upper Aerobic / Threshold)**: From the Zone 3 ceiling + 1 to the Zone 5 floor - 1
  - **Zone 5 (High Intensity)**: Starts at the higher of LT2 + 1 and the rounded 90% HRR anchor. Classification separately requires HR above the LT2 training band for VO2 work

### 8. Aerobic Turnpoint Margin
- `Margin = Pace_LT1 - Pace_LT2 (seconds/km)`
- **35 - 50s/km (Optimal Anchor)**: Elite endurance profile; LT1 is ~85 - 90% of LT2 velocity.
- **50 - 70s/km (Well-Conditioned Base)**: Balanced endurance for committed marathoners.
- **> 75s/km (Base Expansion Opportunity)**: Indicates Aerobic Deficiency Syndrome (ADS); easy pace lags significantly behind threshold.

### 9. Tanaka Formula for Estimated Max Heart Rate
- `HR_max = 208 - (0.7 * age)`

### 10. Cruising Block LT1 Detection & Recovery Week Protection
- **Cruising Block Extraction**: Instead of whole-run averages (which dilute sustained aerobic work with warmups and walk breaks), AEROLAB scans for contiguous cruising segments (>= 20 mins, >= 3.5 km) with low aerobic decoupling (-8.0% to +3.8%).
- **Stimulus Floor Gate**: Requires effort near the prior LT1 estimate, using a tolerance scaled to personal heart-rate reserve. Recovery effort does not become a new LT1 calibration simply because its drift is low.

### 11. Early-Session Window & Acceleration Ramp Trimming for LT2
- **Acceleration Ramp Trimming**: Strips the initial 10-12s acceleration ramp from standing/walking starts (< 2.2 m/s), ensuring interval pace reflects true cruising speed matching the athlete's Garmin watch display.
- **Early-Session Window**: LT2 calibration considers qualifying work within the first elapsed hour and evaluates up to 30 minutes of quality work. This limits reliance on late-session drift; it does not guarantee drift-free data.
- **Cardiac Lag Compensation**: For reps lasting at least five minutes, trims 45-90 seconds of initial HR ramp according to the observed recovery drop before evaluating the plateau.

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
   - Or set `DATABASE_PATH` in each process environment to an absolute path. Each build's database location setting is independent.

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

The lint script requires **zero warnings and zero errors**. ESLint also reports the enforced rules as errors in editors: untranslated JSX text and expressions, tooltips and accessibility labels, inline language switches, hardcoded date locales and run metrics, untyped `any` payloads, unused declarations, and React hook patterns. Language-neutral units, symbols, and brand names are allowed; user-facing copy belongs in the bilingual dictionaries.
## Installable phone snapshot

AEROLAB can build a static, read-only copy of the local dashboard for phone use.
The desktop app remains the only database-backed application. Exported data is
personal data: configure Vercel Deployment Protection (or equivalent protection
covering HTML, JSON, assets, and source files) before deploying a real snapshot.
Do not rely on a password prompt in the browser; the exported JSON is downloaded
by the browser. If your Vercel plan cannot protect every artifact, use a host that
can. Never commit `snapshot-data/` or `public/snapshot.json`.

Refresh the snapshot manually after updating runs in desktop AEROLAB:

```bash
npm run snapshot:export
npm run snapshot:validate
npm run build:snapshot
```

The export command follows this checkout's configured database path. If the
desktop app uses a different database file, pass the path from its Database
location settings: `npm run snapshot:export -- --database "C:\\path\\to\\runs.db"`.

The exporter reads the active configured SQLite database in a consistent
read-only transaction, writes schema version 1 with an export timestamp, and
atomically replaces `snapshot-data/snapshot.json`. It allowlists activity and
telemetry fields, omits GPS coordinates, location and notes, and limits profile
data to the fields needed by the read views. The build copies the artifact into
the static site and writes `dist-snapshot/`; only that directory should be sent
to deployment. The snapshot contains personal training information and must
remain access-protected. The viewer displays its export time and has no database
connection or write API. On Android, open the deployed HTTPS URL in Chrome and
choose **Install app** from the browser menu to add the snapshot viewer to the
home screen. The viewer caches its static app shell for reliable launches, but
does not store `snapshot.json` in the browser cache.

`npm run build` continues to build the desktop target. `npm run build:snapshot`
requires a successful export first.

The desktop backend retains its write routes for activity edits/weather refresh,
profile updates, ingestion settings/folder selection/scan/upload, database
selection/location, backup settings/creation, restore, local shutdown, and the
development test-error probe. Snapshot output contains no backend and its client
only fetches `/snapshot.json`; its write functions fail locally without sending
requests. Local browser preferences remain in that browser's storage.

For manual deployment, first enable Vercel Authentication for **All Deployments**
in the target project, then link this checkout to that project and deploy only
the built static folder:

```bash
npx vercel link
npx vercel deploy dist-snapshot --prod --project <linked-project-id>
```

In development, each row in **Settings → Local Snapshots & Rollback** has a
**Deploy this snapshot** action. The confirmation names the selected backup and
states what data will be sent. On first use, the app opens an interactive local
terminal to sign in with Vercel CLI and link this checkout to an existing Vercel
project; choose the right team and project if Vercel asks. The app then
exports from that exact `.db` file, validates it, prepares the packaged static
viewer, and deploys it to the linked project. Vercel credentials stay in the
CLI's local user configuration. The snapshot deployment action is available in
development and packaged desktop builds; diagnostics and test-error routes
remain development-only.
