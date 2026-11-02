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

## Automatic compaction

Imports and reprocessing leave unused space inside pages: a row is written with
its raw FIT JSON and then shrunk once that JSON moves to
`activity_record_archives`. Imports now insert the record rows without the JSON
and archive the fields from the returned row ids in the same transaction, so a
fresh import does not create that free space. Existing databases still need a
repack.

The maintenance worker measures the footprint at startup and vacuums
automatically when the file is at least 64 MB, holds at least 32 MB of unused
page space, and at least 15% of the file is reclaimable. The rewrite runs in the
worker thread after the API is listening; while it runs the app shows an
indeterminate "Compacting database…" status, because a percentage would not be
honest. Status is available from `GET /api/system/maintenance` (with
`compacting: true` and, on completion, `reclaimedBytes`).

There is no manual trigger in the UI: the startup check covers imports and
offline reprocessing on the next launch. To compact immediately with the app
closed, use the script above.

