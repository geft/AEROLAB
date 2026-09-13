# AEROLAB 🏃‍♂️ — Physiological Running Analytics

A local-first, high-performance running analytics platform and dashboard designed to ingest Garmin run data (exported as CSVs from `run-parser`), store it in a single embedded SQLite database, and track real-time physiological adaptations over time:
- **LT1 (Aerobic Threshold / VT1)** pace and heart rate progression
- **LT2 (Lactate / Anaerobic Threshold / VT2)** pace and heart rate progression
- **Running Economy**: Efficiency Factor ($Speed / HR$), Meters per Heartbeat, and Aerobic Decoupling ($Pa:Hr$ drift %)
- **Pace-Dependent Economy Curves**: Real-world efficiency curves comparing easy base vs. threshold workouts
- **Automatic Interval & Stride Detection**: Isolates structured work reps, recoveries, and explosive strides ($15\text{--}40\text{s}$ bursts), recording Peak Pace, Peak Cadence, Min Ground Contact Time ($GCT$), and Heart Rate Recovery ($HRR$) drop
- **Intelligent Physiological Debrief**: Algorithmic coaching summary that flags "accidental tempos" (grey-zone cardiac drift), detects uphill ramp walks, and scores pacing adherence
- **Calibrated Race Predictions**: Jack Daniels VDOT and Critical Velocity projections for 5K, 10K, Half Marathon, and Marathon based on physiological thresholds

---

## Architecture & Design Principles

### 1. Single SQLite Database (`data/runs.db`) vs. Multi-DB
AEROLAB uses a **single SQLite database file** operating in **WAL (Write-Ahead Logging)** mode.
- **Relational Integrity**: Runs, kilometer splits, interval reps, and physiological thresholds are linked by foreign keys and updated in atomic transactions.
- **Cross-Tab Queries**: The `Browse`, `Progress`, and `Stats` views query the same unified dataset without cross-database coordination or synchronization overhead.
- **Sub-Millisecond Speed**: Embedded SQLite queries execute locally in $<1\text{ms}$.
- **Zero-Fuss Backup**: Your entire running history is contained in one portable file (`data/runs.db`).

### 2. Zero Raw File Retention (Zero Disk Footprint)
Raw 1Hz CSV files from sports watches are 100KB–1MB+ each. Over hundreds of runs, keeping raw files bloats repositories and risks hitting GitHub file or storage limits.
- **Web UI Ingestion**: Drag-and-drop CSV files are parsed **in-memory** in the browser and transmitted directly to SQLite. No raw CSV is written to disk.
- **CLI Ingestion**: The CLI importer supports the `--clean` flag, which ingests files from `data/raw/` and immediately deletes the source CSVs once safely committed to SQLite.
- **Git Protection**: `.gitignore` strictly ignores `*.csv` and `data/*.db` to keep your git repo ultra-lightweight.

### 3. Smart Downsampling & Compact Storage
High-frequency 1Hz time-series data is compacted by ~75% before saving to SQLite:
- **Steady-State Runs**: Downsampled to 5-second intervals, preserving physiological trends without storing redundant 1Hz data.
- **Strides & Fast Intervals**: Automatically preserved at 1–2 second resolution to accurately record peak sprint velocity, cadence spikes, and ground contact time minima.
- **Elevation Preservation**: Altitude (`altitude_m`) is strictly preserved across all samples to track gradients, bridges, and uphill ramp walking.
- **Stripped GPS**: High-frequency GPS latitude and longitude are discarded from time-series points to save space.

### 4. Accurate Microclimate Weather & Core Centroid
Weather conditions in tropical climates like Singapore vary dramatically across short distances—for example, a breezy riverside Park Connector Network (PCN) offers significant evaporative cooling compared to concrete HDB housing estates.
- Rather than sampling weather at the runner's doorstep (which biases every run to the starting location), AEROLAB trims the warmup (first 5 min / 20%) and cooldown (last 3–5 min / 15%) to calculate the **mathematical geographic centroid ($\bar{\text{lat}}, \bar{\text{lon}}$)** of the core workout segment.
- This centroid is stored as `workout_lat` and `workout_lon` on the activity, enabling hyper-local weather lookups while keeping home coordinates private.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Tests
Runs the comprehensive test suite (16 test suites, 66 automated tests) spanning physiology unit tests, API integration, and React UI user flows:
```bash
npm test
```
- **Physiology & Ingestion Unit Tests**: `coach-summary`, `threshold-tracker`, `zones`, `weather`, `downsampler`, `classifier`, `csv-parser`, `economy`, `predictions`, `interval-detector`.
- **API & Ingestion Integration**: In-memory SQLite testing, SHA-256 deduplication, force overwrite, `PATCH /api/activities/:id` title/notes/tags updates, and type filters.
- **Frontend UI / User Flow Integration**: `navbar-theme` (Day/Night mode & tabs), `upload-modal` (batch multi-file drag-and-drop & progress), `browse-flow` (subtabs, AI Coach card, tag manager, inline rename), and `app-integration` (end-to-end multi-view navigation).


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
3. Drag and drop **one or multiple `.csv` files** from `run-parser` (batch upload supported).
4. A live progress bar tracks batch ingestion in-memory directly into SQLite with SHA-256 deduplication and an optional overwrite checkbox. No raw CSVs are saved to disk.

### Method B: Terminal Ingestion CLI
Place CSV files into `data/raw/` and run:
```bash
# Ingest and automatically delete the raw CSVs once saved into SQLite
npm run ingest -- --clean
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
  3. **Notes & AI Coach**: An intelligent physiological debrief (scoring pacing adherence, alerting to accidental tempos or ramp walks) alongside an editable, auto-saving runner's notebook.

### 2. Progress View
- **Pace-Dependent Running Economy Curves**: Plots Moving Speed vs. Heart Rate and Meters per Beat across pace bands, with toggleable filters (`All Runs`, `Easy Base`, `Threshold`).
- **LT1 / LT2 Progression**: Tracks pace and speed at aerobic and anaerobic thresholds over time.

### 3. Stats View
- **Physiological Benchmark Cards**: Current LT1 Pace & HR, LT2 Pace & HR, VO2 Max estimate, and 30-day baseline Running Economy.
- **Calibrated Race Time Predictions**: VDOT-derived finish times, average pace, and kilometer splits for 5K, 10K, Half Marathon, and Marathon.

---

## Folder Structure

```
run-progress/
├── data/
│   ├── raw/                      # Optional folder to drop CSV files for CLI import
│   │   └── .gitkeep
│   └── runs.db                   # Single embedded SQLite database (WAL mode)
│
├── src/
│   ├── backend/
│   │   ├── db/
│   │   │   ├── client.ts         # better-sqlite3 connection in WAL mode
│   │   │   └── schema.sql        # Database tables, indexes & relations
│   │   ├── ingestion/
│   │   │   ├── classifier.ts     # Classifies run type (easy_base, tempo, vo2, etc.)
│   │   │   ├── csv-parser.ts     # Parses Garmin metadata headers + time-series
│   │   │   ├── downsampler.ts    # Smart downsampling (5s steady, 1-2s strides)
│   │   │   ├── importer.ts       # Central deterministic ingestion pipeline & centroid
│   │   │   └── interval-detector.ts # Detects work reps, recoveries, and strides
│   │   ├── physiology/
│   │   │   ├── coach-summary.ts  # Physiological coach debrief & anomaly alerts
│   │   │   ├── economy.ts        # Efficiency Factor, Pa:Hr Decoupling, Meters/Beat
│   │   │   ├── predictions.ts    # Jack Daniels VDOT / Critical Velocity race predictor
│   │   │   ├── threshold-tracker.ts # Evolving LT1/LT2 calibration & 30-day baseline
│   │   │   ├── weather.ts        # Microclimate weather retrieval & caching
│   │   │   └── zones.ts          # Individualized 5-zone HR distributions
│   │   ├── routes/
│   │   │   ├── activities.ts     # GET /api/activities, GET /api/activities/:id, PATCH
│   │   │   ├── thresholds.ts     # GET /api/thresholds (LT1/LT2 timeline & trend)
│   │   │   └── ingest.ts         # POST /api/ingest/upload, POST /api/ingest/scan
│   │   └── server.ts             # Express REST API server
│   │
│   └── frontend/                 # Vite + React (TypeScript) dashboard UI
│       ├── components/
│       │   ├── BrowseView.tsx    # Session browser, multi-tags, sub-tabs & splits
│       │   ├── CanvasRunChart.tsx # High-performance canvas chart (Pace/HR/Elevation)
│       │   ├── Footer.tsx        # Dashboard footer & metadata
│       │   ├── Navbar.tsx        # Navigation bar with tab toggles & import modal
│       │   ├── ProgressView.tsx  # Running economy curves & threshold timeline
│       │   ├── StatsView.tsx     # Current physiology status & race predictions
│       │   └── UploadModal.tsx   # In-memory drag & drop CSV file uploader
│       ├── styles/
│       │   └── index.css         # Dark-mode design system with glassmorphism
│       ├── App.tsx               # Main application routing & tab state
│       └── main.tsx              # React DOM entry point
│
├── scripts/
│   └── ingest.ts                 # CLI runner: `npm run ingest`
│
├── tests/
│   ├── fixtures/sample-run.csv   # Real Garmin Singapore run fixture
│   ├── unit/                     # Unit tests for parser, physiology, and predictions
│   └── integration/              # In-memory SQLite ingestion and API route tests
│
├── .gitignore                    # Configured to ignore CSVs and SQLite databases
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── README.md
```

---

## Physiological Metrics & Mathematical Formulations

### 1. Running Economy (Efficiency Factor)
$$\text{EF} = \frac{\text{Moving Speed (m/min)}}{\text{Average Heart Rate (bpm)}}$$
- Measures output speed per heartbeat.
- Pauses, red lights, and zero-cadence intervals are automatically excluded to prevent idle distortion.

### 2. Aerobic Decoupling ($Pa:Hr$ Drift %)
$$\text{Decoupling} = \frac{\text{EF}_{\text{first half}} - \text{EF}_{\text{second half}}}{\text{EF}_{\text{first half}}} \times 100\%$$
- **$< 4.5\%$**: Solid aerobic endurance base at or below LT1. Cardiac drift is minimal.
- **$> 5.0\%$**: Cardiac drift occurred (misjudged pacing, dehydration, tropical heat, or running above LT1).

### 3. Meters per Beat
$$\text{Meters/Beat} = \frac{\text{Total Distance (m)}}{\text{Total Heartbeats}}$$
- Direct biomechanical indicator of stroke volume and cardiac efficiency.

### 4. Interval Dynamics & Recovery Drop ($HRR$)
- **Peak Speed & Peak Cadence**: Peak values recorded during stride and interval bursts.
- **Min Ground Contact Time ($GCT$)**: Measures running elasticity and stiffness during high-speed surges.
- **Heart Rate Recovery ($HRR$) Drop**: Absolute drop in BPM during recovery intervals (e.g., $162 \to 134\text{ bpm} = -28\text{ bpm}$ in 60s), reflecting parasympathetic reactivation.

---

## Database Schema (`data/runs.db`)

| Table | Description |
| :--- | :--- |
| `activities` | Master run records (date, distance, duration, avg pace, HR, cadence, vertical oscillation, stance time, EF, decoupling %, tags, `workout_lat`, `workout_lon`, notes). |
| `activity_splits` | 1km splits (distance, duration, split pace, split HR, split EF, elevation delta). |
| `activity_intervals` | Detected interval reps, strides, and recovery blocks with peak dynamics and recovery drops. |
| `activity_records` | Compacted time-series telemetry (elapsed seconds, HR, cadence, speed, distance, elevation, temperature). High-frequency GPS stripped. |
| `physiological_thresholds` | Historical calibration points for LT1, LT2, and 30-day baseline Running Economy. |

---

## API Endpoints Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Health status and database check |
| `GET` | `/api/activities` | List all runs (supports `?type=easy_base`, etc.) |
| `GET` | `/api/activities/:id` | Full run detail (splits, intervals, downsampled records, AI coach debrief) |
| `PATCH` | `/api/activities/:id` | Update run name, tags, run_type, or notes |
| `GET` | `/api/thresholds` | Latest LT1/LT2 thresholds, historical progression, and economy curves |
| `POST` | `/api/ingest/upload` | In-memory upload of CSV content from web UI |
| `POST` | `/api/ingest/scan` | Scan `data/raw/` directory for CLI ingestion |
