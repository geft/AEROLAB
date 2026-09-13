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
Runs the complete test suite (19 test suites, 78 automated tests) spanning physiology unit tests, API integration, and React UI user flows:
```bash
npm test
```
- **Physiology & Scoring**: `coach-summary`, `threshold-tracker`, `zones`, `weather`, `downsampler`, `classifier`, `csv-parser`, `economy`, `predictions`, `interval-detector`.
- **API & Ingestion Integration**: In-memory SQLite testing, SHA-256 deduplication, force overwrite, `PATCH /api/activities/:id` title/notes/tags updates, and type filters.
- **Frontend UI / User Flow Integration**: `navbar-theme` (Day/Night mode & tabs), `upload-modal` (batch multi-file drag-and-drop & progress), `browse-flow` (subtabs, AI Coach card, tag manager, score breakdown, inline rename), and `app-integration` (end-to-end multi-view navigation).

### 3. Start Backend API Server
```bash
npm run dev:backend
```
The REST API server runs at `http://localhost:3001`:
- Health check: `http://localhost:3001/api/health`
- Activities list: `http://localhost:3001/api/activities`
- Single run detail: `http://localhost:3001/api/activities/:id`
- Physiological thresholds: `http://localhost:3001/api/thresholds`

### 4. Start Frontend Dashboard
```bash
npm run dev:frontend
```
Frontend runs at `http://localhost:5173`.

---

## How to Import Runs

### Method A: Drag & Drop in the Web Dashboard (Recommended)
1. Open `http://localhost:5173` in your browser.
2. Click the **"Import CSV"** button in the navigation bar.
3. Drag and drop **one or multiple `.csv` or `.fit` files** (batch upload supported).
4. A live progress bar tracks batch ingestion in-memory directly into SQLite with SHA-256 deduplication and an optional overwrite checkbox. No raw files are saved to disk.

### Method B: Terminal Ingestion CLI
```bash
npm run ingest
```

---

## Dashboard Views & Features

### 0. Day Mode / Night Mode Theme Switcher
- **Top Navigation Switch**: Instantly toggle between Night Mode (dark neon slate `#07090e`) and Day Mode (clean crisp slate `#f1f5f9` and pure white `#ffffff` cards).
- **Adaptive Telemetry Canvas**: Canvas curves (HR, Pace, Elevation) and grid lines automatically re-stroke with high-contrast color palettes for bright sunlight environments.
- **Persistent Preference**: Saved in `localStorage` under `aerolab_theme`.

### 1. Browse View
- **Session List & Calendar**: Scrollable chronological list of runs grouped by date with pace, distance, duration, and dynamic tags.
- **Editable Activity Title**: Clean, uncluttered naming (no redundant "Singapore Running" prefixes). Click the pencil icon to rename any session.
- **Dynamic Multi-Tagging**: Add or remove multiple tags per session using quick presets (`Easy Base`, `Accidental Tempo`, `Hill Strides`, `Flat Strides`, `Ramp Walk`, `VO2 Max`, `Threshold`, `Long Run`, `Recovery`) or type custom tags on the fly.
- **Core Segment Filter**: Toggle between "Full Session" and "Core (Minus Warmup/Cooldown)" to inspect pure steady-state workout telemetry without warmup/cooldown skew.
- **Three Sub-Tabs**:
  1. **Telemetry & Chart**: Interactive canvas scrub chart plotting Pace (cyan), Heart Rate (amber), and Elevation fill, plus key physiological chips and a 1km splits table.
  2. **Strides & Intervals**: Dedicated breakdown of detected strides and interval work reps with Rep #, Type, Duration, Distance, Avg & Peak Pace, Avg & Peak Cadence, Min Ground Contact Time, and Recovery HR Drop.
  3. **Notes & AI Coach**: Intelligent physiological debrief with clickable **Score Breakdown Modal**, grading rubric, and an editable, auto-saving runner's notebook.

### 2. Progress View
- **Period Progress & Mileage**: View total running volume, month-by-month and year-by-year mileage, and zone breakdown distributions.
- **Pace-Dependent Running Economy Curves**: Plots Moving Speed vs. Heart Rate and Meters per Beat across pace bands, with toggleable filters (`All Runs`, `Easy Base`, `Threshold`).
- **LT1 / LT2 Progression**: Tracks pace and speed at aerobic and anaerobic thresholds over time.

### 3. Stats View
- **Physiological Benchmark Cards**: Current LT1 Pace & HR, LT2 Pace & HR, VO2 Max estimate, and 30-day baseline Running Economy.
- **Calibrated Race Time Predictions**: VDOT-derived finish times, average pace, and kilometer splits for 5K, 10K, Half Marathon, and Marathon.

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
