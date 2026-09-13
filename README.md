# AEROLAB 🏃‍♂️ — Physiological Running Analytics

A local-first, high-performance running analytics platform and dashboard designed to ingest Garmin run data (both native `.fit` binary files and exported `.csv` files), store it in a single embedded SQLite database, and track real-time physiological adaptations over time:
- **LT1 (Aerobic Threshold / VT1)** pace and heart rate progression
- **LT2 (Lactate / Anaerobic Threshold / VT2)** pace and heart rate progression
- **Running Economy**: Efficiency Factor ($Speed / HR$), Meters per Heartbeat, and Aerobic Decoupling ($Pa:Hr$ drift %)
- **Pace-Dependent Economy Curves**: Real-world efficiency curves comparing easy base vs. threshold workouts
- **Automatic Interval & Stride Detection**: Isolates structured work reps, recoveries, and explosive strides ($15\text{--}40\text{s}$ bursts), recording Peak Pace, Peak Cadence, Min Ground Contact Time ($GCT$), and Heart Rate Recovery ($HRR$) drop
- **Transparent Physiological Execution Score (3-Tier: Bronze / Silver / Gold)**: Granular 100-point scoring engine with itemized point breakdowns for aerobic stability, cadence discipline, decoupling drift, and pacing adherence
- **Intelligent Physiological Debrief**: Algorithmic coaching summary that flags "accidental tempos" (grey-zone cardiac drift), identifies failed or aborted workouts, detects uphill ramp walks, and provides actionable recovery recommendations
- **Period Progress & Training Volume**: Monthly and annual mileage breakdowns, weekly volume cadence, and 5-zone cardiovascular distribution
- **Calibrated Race Predictions**: Jack Daniels VDOT and Critical Velocity projections for 5K, 10K, Half Marathon, and Marathon based on empirical physiological thresholds

---

## Architecture & Design Principles

### 1. Single SQLite Database (`data/runs.db`) vs. Multi-DB
AEROLAB uses a **single SQLite database file** operating in **WAL (Write-Ahead Logging)** mode:
- **Relational Integrity**: Runs, kilometer splits, interval reps, coach summaries, and physiological thresholds are linked by foreign keys and updated in atomic transactions.
- **Cross-Tab Queries**: The `Browse`, `Progress`, and `Stats` views query the same unified dataset without cross-database coordination or synchronization overhead.
- **Sub-Millisecond Speed**: Embedded SQLite queries execute locally in $<1\text{ms}$.
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
- **Stripped GPS**: High-frequency GPS latitude and longitude are discarded from time-series points to save space.

### 4. Accurate Microclimate Weather & Core Centroid
Weather conditions in tropical climates vary dramatically across short distances—for example, a breezy seaside park connector offers significant evaporative cooling compared to dense urban corridors.
- Rather than sampling weather at the runner's doorstep (which biases every run to the starting location), AEROLAB trims the warmup (first 5 min / 20%) and cooldown (last 3–5 min / 15%) to calculate the **mathematical geographic centroid ($\bar{\text{lat}}, \bar{\text{lon}}$)** of the core workout segment.
- This centroid is stored as `workout_lat` and `workout_lon` on the activity, enabling hyper-local weather lookups while keeping home coordinates private.

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
| **Transparent execution scoring with itemised point breakdown** | — | ✅ |
| **Stride detection with peak cadence, min GCT, HR recovery drop** | — | ✅ |
| **Traffic stop & walk break isolation** (prevents stop-light distortion) | — | ✅ |
| **VDOT race predictions from actual physiological thresholds** (not just recent pace) | — | ✅ |
| **Workout centroid weather** (tracks conditions where you actually ran, not your doorstep) | — | ✅ |
| **Editable runner's notebook** attached to each session | — | ✅ |
| Your data leaves your machine | ✅ | ❌ (local-first) |

**The core gap**: Garmin gives you data. AEROLAB gives you a **physiological verdict** — did this run serve its purpose? Was it a genuine Zone 2 stimulus, or did it quietly drift into grey-zone tempo territory? Are you actually building aerobic capacity, or just accumulating junk miles at the wrong intensity?

---

## Physiological Execution Scoring (3-Tier)

Every workout is evaluated by an algorithmic coach engine that computes a transparent **0–100 Physiological Execution Score** based on objective biomechanical and cardiovascular criteria:

### Scoring Tiers
| Emblem | Score Band | Execution Standard |
| :---: | :---: | :--- |
| ★★★ Gold | **85–100** | **Near-Perfect Execution**: Stable HR under LT1, decoupling $< 3.5\%$, optimal cadence ($\ge 174$ spm), tight pacing adherence. |
| ★★☆ Silver | **70–84** | **Solid Stimulus**: Productive aerobic work; minor thermal drift ($< 6\%$) or slight cadence variance without compromising intent. |
| ★☆☆ Bronze | **< 70** | **Compromised Session**: Accidental tempo grey-zone creep, heavy cardiac drift ($> 8\%$), aborted interval set, or pace collapse. |

> **Hard caps**: Accidental tempo runs and aborted workouts are capped at Bronze (max 69 / 100) regardless of other factors.

### Itemized Point Factors
Clicking the Coach AI score pill in the dashboard opens the **Interactive Breakdown Modal**, displaying exact point additions and deductions:
- **Baseline Intent**: Starts at **85 points** for steady aerobic base runs or completed interval sets.
- **Aerobic Decoupling ($Pa:Hr$)**:
  - Drift $< 3\%$: **+5 points** (aerobic rock)
  - Drift $< 5\%$: **+3 points** (stable)
  - Drift $5\text{--}8\%$: **-8 points** (moderate thermal/cardiac drift)
  - Drift $> 8\%$: **-14 points** (severe drift)
- **Biomechanical Cadence**:
  - Steady running cadence $\ge 175$ spm: **+4 points**
  - High cadence variance ($SD > 8$ spm): **-5 points**
  - Low cadence ($< 164$ spm): **-3 points**
- **Pacing Intent Violations ("Accidental Tempos")**:
  - If an easy run creeps into Zone 4 / LT2 ($> 164$ bpm), a **-15 point pacing penalty** is applied and the score is hard-capped at **Bronze**.
- **Strides & Neuromuscular Sharpening**:
  - Strides with peak cadence $\ge 190$ spm and crisp recovery drop: **+4 points**.

---

## Workout Classification Logic

AEROLAB automatically classifies each activity into one of six core categories:
1. **Recovery Run (`recovery`)**:
   - Short shakeouts ($\le 50$ minutes).
   - Low cardiovascular strain: Average HR $\le 136$ bpm (or $< 72\%$ of max HR).
   - Governed by **duration and HR only** — distance is irrelevant for recovery classification.
2. **Easy Aerobic Base (`easy_base`)**:
   - Standard aerobic endurance runs sustained below LT1 ($\approx 138\text{--}150$ bpm).
   - Monitored for aerobic decoupling ($Pa:Hr$) and steady-state efficiency factor.
3. **Long Run (`long_run`)**:
   - Extended endurance volume ($\ge 75$ minutes on feet).
   - Governed by **duration only** — distance is not a trigger.
4. **Lactate Threshold (`threshold_lt2`)**:
   - Sustained intervals or continuous tempo in Zone 4 ($\ge 165$ bpm, work reps $\ge 6\text{--}8$ minutes).
5. **VO2 Max Intervals (`intervals_vo2`)**:
   - Repetitions sustained at high intensity ($1\text{--}5$ minutes) with Zone 5 HR peaks ($> 85\%$ max HR).
6. **Race / Time Trial (`race`)**:
   - Competitive races, parkruns, or benchmark all-out time trials.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Tests
Runs the complete test suite (21 test suites, 115 automated tests) spanning physiology unit tests, binary/CSV ingestion, API integration, and React UI user flows:
```bash
npm test
```
- **Physiology & Parser Unit Tests (12 suites)**: `fit-parser` (Garmin binary protocol, session/record definitions, sport detection), `threshold-tracker` (LT1/LT2 continuous calibration, sub-LT1 baseline preservation), `coach-summary`, `zones` (Karvonen HRR & 5-tier physiological zones), `weather`, `downsampler`, `classifier`, `csv-parser`, `economy` (EF & decoupling), `predictions` (Daniels VDOT & Riegel), `interval-detector`, and `formatters`.
- **API & Ingestion Integration Tests (2 suites)**: In-memory SQLite testing, binary `.fit` Base64 upload & CSV parsing, SHA-256 deduplication, force overwrite, `PATCH /api/profile` with Tanaka auto-estimation, `PATCH /api/activities/:id` title/notes/tags updates, and type filters.
- **Frontend UI / User Flow Integration Tests (7 suites)**:
  - `profile-view`: Runner demographics, Tanaka auto-estimation on age change, non-editable inferred physiological thresholds, gender selector, and marathon race goals.
  - `stats-view`: Volume analytics, month picker dropdown, and Aerobic Turnpoint Margin educational guide modal.
  - `progress-view`: VDOT & Economy guide modals, milestone cards vs data table, LT1 Base vs LT2 Threshold filters, and dynamic count badges.
  - `upload-modal`: Batch multi-file drag-and-drop (`.fit` and `.csv`), progress tracking, and error diagnostics.
  - `navbar-theme`: Day/Night mode theme toggle and navigation tabs.
  - `browse-flow`: Subtabs, AI Coach card, tag manager, score breakdown, and inline activity rename.
  - `app-integration`: End-to-end multi-view navigation across Browse, Progress, Stats, and Profile tabs.

### 3. Start Backend & Frontend Concurrently (Recommended)
```bash
npm run dev
```
Starts both the Express REST API (`http://localhost:3001`) and the Vite React UI (`http://localhost:5173`) concurrently in a single terminal on Windows, macOS, or Linux.
- Backend API: `http://localhost:3001`
- Frontend Dashboard: `http://localhost:5173`

> [!NOTE]
> **Why `npm run dev`?** In the Node.js / npm ecosystem, `run` is a built-in CLI command keyword of npm itself (like `npm test` or `npm install`). It is an internal directive that tells npm to execute the script named `dev` from `package.json`. It does **not** reference, require, or conflict with any npm package, module, or directory named "run".

Alternatively, you can run them in separate terminal windows:
```bash
npm run dev:backend   # Express API server (port 3001)
npm run dev:frontend  # Vite React dev server (port 5173)
```

### 4. Updating to the Latest Build
To update your local setup to the latest build, install any new dependencies, and compile the production bundle:
```bash
npm run update
```
This cross-platform script executes:
1. `git pull` (fetches the latest code)
2. `npm install` (installs any newly added dependencies)
3. `npm run build:all` (compiles both frontend and backend production bundles)

### 5. Running as a Standalone Desktop App (Electron)
AEROLAB can run locally as a native desktop application with an embedded Node.js/SQLite engine and dedicated window:
```bash
npm run electron:start
```
To bundle a local Windows executable (`.exe` installer and portable build) on your machine:
```bash
npm run electron:build
```
The output executable will be placed in the `release/` directory.

### 6. Automated Windows `.exe` Releases via GitHub Actions
For non-technical users who want to run AEROLAB without installing Node.js, Git, or touching a terminal:
1. **Triggering a Build**:
   - **Via Git Tag**: Push a release tag, e.g. `git tag v1.0.0 && git push origin v1.0.0`.
   - **Via GitHub Web UI**: Go to the **Actions** tab on GitHub, select **Release Windows Desktop App**, and click **Run workflow**.
2. **Download & Install**:
   - GitHub Actions automatically runs the automated tests, compiles the frontend/backend bundles, packages the Windows installer (`AEROLAB-Setup-x64.exe`), and attaches it to the repository **Releases** page.
   - Simply download `AEROLAB-Setup-x64.exe` and double-click to install.
3. **Data Isolation & Privacy**:
   - When running as an installed desktop app, each user's running database is safely stored in their personal Windows AppData folder (`%APPDATA%/aerolab/runs.db`).
   - Updating or reinstalling the application never overwrites or deletes the athlete's local running data.

## Data Population & Ingestion Methods

AEROLAB offers multiple flexible ways to populate your running history from native Garmin `.fit` binary files or exported `.csv` files:

### Method A: Drag & Drop in the Web Dashboard (Recommended)
1. Open `http://localhost:5173` in your browser.
2. Click the **"Import FIT / CSV"** button in the navigation bar.
3. Drag and drop **one or multiple `.fit` or `.csv` files** (batch multi-file upload supported).
4. The system automatically determines the parser algorithm (native Garmin `.FIT` binary protocol vs. `.CSV` time-series). A live progress bar tracks batch ingestion in-memory directly into SQLite with SHA-256 deduplication and an optional overwrite checkbox. No raw files are saved to disk.

### Method B: Terminal Ingestion CLI (FIT & CSV)
Drop any `.fit` or `.csv` files into `data/raw/` or specify a single file/folder, and run:
```bash
npm run ingest
```
The script automatically determines the algorithm (FIT binary parser vs. CSV parser) using binary magic bytes and file extensions.
Add `--clean` to automatically delete raw files after successful database ingestion:
```bash
npm run ingest -- --clean
```

### Method C: Python Batch Ingestion Script
For users or family members who prefer a standalone Python script to batch-import from any folder or USB mount:
```bash
# Ingest default data/raw/ folder (auto-detects FIT vs CSV algorithms):
python scripts/batch_ingest.py

# Ingest an external folder (e.g. Garmin watch export or USB drive):
python scripts/batch_ingest.py --dir "C:/Users/name/Garmin/Activities"

# Ingest a single activity file directly:
python scripts/batch_ingest.py "C:/path/to/activity.fit"

# Ingest and auto-clean processed files:
python scripts/batch_ingest.py --dir "data/raw" --clean
```

### Method D: Bulk FIT Processor & Archive Converter
If you have a large library of historical `.fit` files, drop them into a `fit/` folder in the root and run:
```bash
npm run process:fit
```
This batch parses all `.fit` files, generates normalized `.csv` files in `csv/`, and populates your SQLite database with full physiological tracking and AI coach summaries.

### Method E: Direct Database Portability (`data/runs.db`)
AEROLAB operates on a **single embedded SQLite WAL database file** (`data/runs.db`). To back up or transfer your entire running history, simply copy `data/runs.db` to another machine or cloud backup.

---

## Dashboard Views & Features

### 0. Day Mode / Night Mode Theme Switcher
- **Top Navigation Switch**: Instantly toggle between Night Mode (dark neon slate `#07090e`) and Day Mode (clean crisp slate `#f1f5f9` and pure white `#ffffff` cards).
- **Adaptive Telemetry Canvas**: Canvas curves (HR, Pace, Elevation) and grid lines automatically re-stroke with high-contrast color palettes for bright sunlight environments.
- **Persistent Preference**: Saved in `localStorage` under `aerolab_theme`.

### 1. Browse View
- **Session List & Calendar**: Scrollable chronological list of runs grouped by date with pace, distance, duration, and dynamic tags.
- **Editable Activity Title**: Clean, uncluttered naming (no redundant "Singapore Running" prefixes). Click the pencil icon to rename any session.
- **Standardized Multi-Tagging**: Add or remove workout tags per session using standard presets (`Easy Base`, `Long Run`, `Recovery`, `Threshold`, `VO2 Max`, `Tempo`, `Marathon Pace`, `Strides`, `Race`). Free-form arbitrary tags are restricted to maintain clean and reliable physiological analytics.
- **Core Segment Filter**: Toggle between "Full Session" and "Core (Minus Warmup/Cooldown)" to inspect pure steady-state workout telemetry without warmup/cooldown skew.
- **Four Sub-Tabs**:
  1. **Telemetry & Chart**: Interactive canvas scrub chart plotting Pace (cyan), Heart Rate (amber), and Elevation fill, plus key physiological chips and a compact 1km splits preview.
  2. **KM Splits**: Interactive Kilometer Split Visualizer with proportional horizontal bars, pacing dynamics insights (Fastest/Slowest Split, Pace Spread $\Delta$, and Negative/Positive split strategy classifier), with on-the-fly metric switching across **Pace**, **Heart Rate**, **Efficiency Factor**, and **Elevation**.
  3. **Strides & Intervals**: Dedicated breakdown of detected strides and interval work reps with Rep #, Type, Duration, Distance, Avg & Peak Pace, Avg & Peak Cadence, Min Ground Contact Time, and Recovery HR Drop.
  4. **Notes & AI Coach**: Intelligent physiological debrief with clickable **Score Breakdown Modal**, grading rubric, and an editable, auto-saving runner's notebook.

### 2. Progress View
- **Period Progress & Mileage**: View total running volume, month-by-month and year-by-year mileage, and zone breakdown distributions.
- **Pace-Dependent Running Economy Curves**: Plots Moving Speed vs. Heart Rate and Meters per Beat across pace bands, with toggleable filters (`All Runs`, `Easy Base`, `Threshold`).
- **Historical Threshold Calibrations**: Organized milestones and data table bounded in a sleek scroll container with filter pills (`All`, `LT1 Base`, `LT2 Threshold`, `Race`) to easily navigate 100+ recalibrations without endless scrolling.

### 3. Stats View
- **Physiological Benchmark Cards**: Current LT1 Pace & HR, LT2 Pace & HR, VO2 Max estimate, and 30-day baseline Running Economy.
- **Calibrated Heart Rate Zones**: 5-zone cardiovascular distribution dynamically derived from HRR, LT1 ceiling (~148 bpm), and LT2 turnpoint (~172 bpm).
- **Aerobic Turnpoint Margin & Guide**: Measures the pace gap between LT1 easy base and LT2 threshold. Click the info button to open the educational modal featuring benchmark tiers (Optimal $\le 50$s, Well-Conditioned $50\text{--}70$s, Base Opportunity $>70$s) and training recommendations.
- **Calibrated Race Time Predictions**: VDOT-derived finish times, average pace, and kilometer splits for 5K, 10K, Half Marathon, and Marathon.

### 4. Profile View
- **Cardiovascular Baselines**: Streamlined strictly to core cardio metrics (Resting HR, Max HR engine, and VO2 Max).
- **Max Heart Rate Engine & Auto-Inference**: Automatically infers peak heart rate from your hardest actual workout efforts (e.g. 5K time trial at 203 bpm), with an opt-out toggle to auto-estimate via the Tanaka formula ($208 - 0.7 \times \text{age}$) or manual baseline entry.
- **Continuously Inferred Lactate Thresholds**: LT1 and LT2 are kept strictly separate from manual profile inputs; they are continuously calibrated from actual steady and threshold runs.
- **Upcoming Benchmark Target**: Set upcoming race or benchmark target (e.g., '10k Garmin Race Oct 2026').

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

---

## Physiological Metrics & Mathematical Formulations

### 1. Running Economy (Efficiency Factor)
$$\text{EF} = \frac{\text{Moving Speed (m/min)}}{\text{Average Heart Rate (bpm)}}$$
- Measures output speed per heartbeat.
- Pauses, red lights, and zero-cadence intervals are automatically excluded to prevent idle distortion.

### 2. Aerobic Decoupling ($Pa:Hr$ Drift %)
$$\text{Decoupling} = \frac{\text{EF}_{\text{first half}} - \text{EF}_{\text{second half}}}{\text{EF}_{\text{first half}}} \times 100\%$$
- **$< 3.5\%$**: Superior aerobic endurance base. Cardiac drift is virtually absent.
- **$3.5\text{--}5.0\%$**: Stable aerobic condition.
- **$> 5.0\%$**: Cardiovascular drift occurred (pacing too fast, dehydration, tropical heat, or premature threshold crossing).

### 3. Meters per Beat
$$\text{Meters/Beat} = \frac{\text{Total Distance (m)}}{\text{Total Heartbeats}}$$
- Direct biomechanical indicator of stroke volume and cardiac efficiency.

### 4. Interval Dynamics & Recovery Drop ($HRR$)
- **Peak Speed & Peak Cadence**: Peak values recorded during stride and interval bursts.
- **Min Ground Contact Time ($GCT$)**: Measures running elasticity and stiffness during high-speed surges.
- **Heart Rate Recovery ($HRR$) Drop**: Absolute drop in BPM during recovery intervals (e.g., $162 \to 134\text{ bpm} = -28\text{ bpm}$ in 60s), reflecting parasympathetic reactivation.

### 5. Jack Daniels VDOT & Oxygen Cost Formula
AEROLAB models maximal oxygen uptake ($VDOT$) using the Daniels and Gilbert equations:
- **Oxygen Cost of Velocity** ($v$ in meters/minute):
  $$VO_2 = -4.60 + 0.182258 \cdot v + 0.000104 \cdot v^2$$
- **Fraction of $VO_2\max$ Sustained Over Duration** ($t$ in minutes):
  $$\%VO_2\max = 0.8 + 0.1894393 \cdot e^{-0.012778 \cdot t} + 0.2989558 \cdot e^{-0.1932605 \cdot t}$$
- **Resulting VDOT Metric**:
  $$VDOT = \frac{VO_2}{\%VO_2\max}$$

### 6. Calibrated Race Time Predictions (Critical Velocity & Riegel)
Finish times for 5K, 10K, Half Marathon, and Marathon are modeled by combining Riegel's power-law endurance equation with empirical threshold pacing:
$$T_2 = T_1 \cdot \left(\frac{D_2}{D_1}\right)^{1.06}$$
Target paces for longer distances are calibrated against your actual $LT1$ and $LT2$ thresholds to prevent overly optimistic projections when aerobic decoupling is elevated.

### 7. Heart Rate Reserve (Karvonen HRR) & Dynamic Zone Model
Heart rate reserve defines cardiovascular operating range:
$$HRR = HR_{\max} - HR_{\text{rest}}$$
Cardiovascular zones dynamically update as thresholds recalibrate:
- **Zone 1 (Active Recovery)**: $< 54\% HRR$ or $< LT1 - 14\text{ bpm}$ (metabolite clearance)
- **Zone 2 (Aerobic Base)**: $[\text{Z1 Upper} + 1, LT1]$ (pure lipid oxidation, zero lactate accumulation)
- **Zone 3 (Tempo / Aerobic Drift)**: $[LT1 + 1, LT2 - 1]$ (marathon pace, glycogen utilization rises)
- **Zone 4 (Lactate Threshold)**: $[LT2, \sim 90\% HRR]$ (1-hour maximum sustainable velocity)
- **Zone 5 (VO2 Max & Anaerobic)**: $[> 90\% HRR, HR_{\max}]$ (neuromuscular and maximal cardiac output)

### 8. Aerobic Turnpoint Margin
$$\Delta \text{Pace} = \text{Pace}_{LT1} - \text{Pace}_{LT2} \quad (\text{seconds/km})$$
Measures how closely your aerobic base (easy running) tracks your anaerobic threshold:
- **$35\text{--}50\text{s/km}$ (Optimal Anchor)**: Elite endurance profile; $LT1$ is $\approx 85\text{--}90\%$ of $LT2$ velocity.
- **$50\text{--}70\text{s/km}$ (Well-Conditioned Base)**: Balanced endurance for committed marathoners.
- **$> 75\text{s/km}$ (Base Expansion Opportunity)**: Indicates Aerobic Deficiency Syndrome (ADS); easy pace lags significantly behind threshold, indicating a need for dedicated high-volume Zone 2 mileage.

### 9. Tanaka Formula for Estimated Max Heart Rate
For runners who opt out of manual Max HR testing:
$$HR_{\max} = 208 - (0.7 \times \text{age})$$
AEROLAB uses this evidence-based equation (superior to Fox's $220 - \text{age}$) to prevent artificially truncated HR zones.

### 10. Geographic Workout Centroid
$$\bar{\text{lat}} = \frac{1}{N}\sum_{i \in \text{core}} \text{lat}_i, \quad \bar{\text{lon}} = \frac{1}{N}\sum_{i \in \text{core}} \text{lon}_i$$
Calculated after trimming the first 20% (warmup) and final 15% (cooldown) to query weather conditions exactly where the workout was executed.

---

## Multi-User Isolation & Database Privacy

AEROLAB is designed with local-first data isolation:
1. **Git Protection**: `data/*.db` and `data/*.db-*` are strictly listed in `.gitignore`.
2. **Fresh Clone**: When your spouse or running partner clones the repository on their own machine, they receive an empty `data/` folder and start with a fresh, clean database on first run.
### 3. Shared Machine Setup: If you share the same PC:
   - Keep two separate project clones (e.g. `C:\gemini-projects\run-progress-GJ` and `C:\gemini-projects\run-progress-wife`).
   - Or configure the `DATABASE_PATH` environment variable in `.env`:
     ```bash
     DATABASE_PATH=data/wife_runs.db
     ```

---

## First-Launch Onboarding & Baseline Calibration

When launching AEROLAB on a fresh install (or with a clean database):
1. **Mandatory Baseline Wizard**: AEROLAB prompts the athlete to configure their physiological baseline before accessing empty dashboards:
   - **Date of Birth (`dob`)**: Automatically derives current age year after year without manual updates.
   - **Biological Gender**: Calibrates normative aerobic ranges.
   - **Resting & Maximum Heart Rate**: Custom benchmark or auto-calculated via the Tanaka formula ($208 - 0.7 \times \text{age}$).
   - **Starting VO2 Max & Training Focus**: Informs race prediction models.
2. **Zero-Name Privacy**: No athlete name or personal identifiers are stored or required.
3. **Empty State Guidance**: Once configured, the activity list guides new users to import their initial `.FIT` or `.CSV` workout via the primary navigation or quick-action cards.

---

## Custom Local Hostname Setup (Local Only)

Want to browse to `http://aerolab.local:5173` instead of typing `localhost:5173`?

1. Open your Windows **Notepad as Administrator** (Right-click Notepad $\to$ Run as Administrator).
2. Open the file `C:\Windows\System32\drivers\etc\hosts`.
3. Add this line at the bottom and save:
   ```text
   127.0.0.1  aerolab
   127.0.0.1  aerolab.local
   ```
4. Now you can access AEROLAB directly at:
   - `http://aerolab.local:5173` or `http://aerolab:5173`

> [!NOTE]
> **Why is `:5173` still required?**
> The `hosts` file only maps names (`aerolab.local`) to IP addresses (`127.0.0.1`); it does not redirect port numbers. Since Vite's development server runs on port `5173`, the browser must connect to port `5173`.
>
> **Want to browse to `http://aerolab.local` with NO port number at all?**
> Standard HTTP defaults to port `80`. If you configure Vite to listen on port 80 in `vite.config.ts`:
> ```typescript
> export default defineConfig({
>   server: {
>     port: 80,
>     host: true
>   }
> });
> ```
> *(Note: Binding to port 80 on Windows requires launching your terminal with Administrator privileges if port 80 is not already occupied by IIS or another web server).*


