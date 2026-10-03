# Database storage

AEROLAB keeps one local SQLite database in WAL mode. Telemetry columns remain
queryable and retain their original precision. Bulky FIT data uses lossless gzip:

- `activity_record_archives.fields_gzip` stores exact raw record JSON strings
  paired with record IDs, grouped by activity. `activity_records.fit_fields_json`
  is the legacy input column and is cleared only in the same transaction that
  writes the archive. Archives cascade when their activity is deleted.
- `activity_fit_details.metadata_json` accepts legacy TEXT or a gzip BLOB.
- `activity_fit_details.source_fit` accepts original FIT bytes or a versioned
  `AEROLAB-FIT-GZIP-v1` marker followed by gzip bytes.

Readers use `db/compression.ts` to decode legacy and compressed values. Analysis
reads numeric columns and compressed metadata; activity detail/CSV export also
restores raw record fields. Imports compress inside their existing transaction.
The `lossless-fit-gzip-v1` schema migration snapshots existing data, compresses it
once, then startup vacuums once to reclaim unused pages. This format requires the
updated application; earlier builds cannot decode compressed FIT data. Restore
the pre-migration backup when reverting to an earlier application build.

SQLite checkpoints automatically every 1,000 WAL pages. Connections set a 16 MiB
journal reuse limit. The main connection checks every 30 seconds and attempts a
nonblocking truncate checkpoint when WAL size reaches 16 MiB. Startup, connection
switching, shutdown, and import worker cleanup also attempt a truncate checkpoint.
An active reader/writer can delay cleanup; the next idle check retries. The limit
is a cleanup target, not a hard cap during a long transaction or active reader.
Never remove WAL files manually.

For a verified one-off compaction, close app instances and run:

```powershell
npx tsx scripts/compact-database.ts --apply
```

The command resolves the configured database, creates a safety backup, verifies
compression on a temporary copy, then migrates in place. It compares hashes of
all logical rows, decoding raw JSON and FIT bytes for comparison, and checks
SQLite integrity and foreign keys. Omitting `--apply` verifies only the copy.
Safety backups are retained separately and still consume disk space.
