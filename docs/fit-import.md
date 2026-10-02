# Garmin FIT and ZIP imports

Import a Garmin original activity FIT file or its ZIP download using **Import Garmin Runs**, drag and drop, or folder scan. No extension, conversion, or cloud service is required. A ZIP must contain exactly one FIT activity; extraction happens in memory and is limited to 64 MB. CSV import remains available.

AEROLAB decodes FIT directly with Garmin's pinned FIT SDK. It retains the original FIT bytes in the same SQLite database, so future parser improvements can reprocess the source. Importing the ZIP and its extracted FIT is detected as a duplicate. Forced CSV reimports retain the archived FIT.

Records retain running power, cadence fractions, vertical ratio, ground-contact balance, step length, respiration, core temperature, and developer/unknown fields when available. Additional messages include laps, timer events, workout prescriptions, device information, RR interval arrays, zones, user profile, training effect, and recorded workout feeling/RPE. RR arrays retain the preceding timestamp for synchronization; they are not converted into invented per-second samples. Absent sensor metrics remain null.

**Export Run CSV** remains available for AI analysis. Exports contain a `FIT Metadata` JSON comment with the additional messages and units, plus quoted JSON cells for custom record data. GCT uses milliseconds, vertical oscillation millimetres, step length metres, and cadence total steps/minute including fractional cadence. FIT metadata's session/lap fields retain SDK units; their raw step lengths are millimetres and workout RPE is stored on Garmin's 0–100 encoding (divide by ten for 0–10).

The optional sibling extension and AEROLAB vendor the identical `fit-core.mjs` with the same pinned SDK and ZIP dependencies. After editing the extension's canonical source, copy it to `src/backend/ingestion/fit-core.mjs`, run its build/tests, and verify parity:

```powershell
node scripts/check-fit-parity.mjs C:/path/to/fit-parser
```

The core validates the original FIT checksum before decoding. It adapts compressed timestamp framing because the JavaScript SDK does not yet support it. Multisport imports select the running session. Files with several running sessions must be split into individual sessions first.

Garmin's SDK and fflate retain their respective licenses in `licenses/`, included in Windows distributions.
