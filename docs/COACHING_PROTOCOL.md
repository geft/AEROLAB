# Coaching identifiers

New rubric factors carry `categoryId` and `findingId` alongside their English
`category` and `label`. The shared contract lives in `src/shared/coaching.ts`;
backend English vocabulary lives in `src/backend/domain/coaching/vocabulary.ts`.
Grading branches emit identifiers directly. Verdicts and focus-advice selection
use identifiers, so editing presentation wording cannot alter assessment.

Summary headlines and recommendations carry `messages` containing a stable ID,
English text, and interpolation parameters. The backend owns the English
templates in `domain/coaching/messages.ts`. These objects are stored in existing
`analysis_json`, returned by activity services, and included in activity-detail
contracts. No schema migration or forced database rewrite is needed.

The frontend reads Chinese overrides from the typed dictionaries using IDs and
formats parameters through `useTranslation`. English override maps remain empty:
the API text is the English source of truth. Keep identifiers unchanged when
editing copy; a new semantic finding needs a new identifier and translations.

## Compatibility and scope

Identifiers and messages are optional on persisted/public contracts because old
databases and snapshots omit them. The verdict adapter recognizes legacy English
factors only when identifiers are absent. Message parsing rejects malformed or
unknown message objects, allowing existing presentation text to remain usable.
The UI retains its old translation adapters for payloads without identifiers.

Dynamic insight prose, factor descriptions, and historical focus-advice prose
still use existing translation adapters. Their migration is independent of the
verdict protocol and is not included in this checkpoint. Classifier thresholds,
rubric scores, and existing English copy are unchanged.

Regression coverage checks wording-independent verdicts, factor identifiers
across run families, Chinese rendering and interpolation, message validation,
and persistence/API round trips including text-only legacy summaries.

## Follow-up structure and stored analysis

`physiology/coach-rubric.ts` remains the compatibility entry point and orchestrates
`coaching/{evidence,aerobic,quality,race,focus}.ts`. The split preserves scoring
weights and thresholds. Shared concrete detail/coaching DTOs now live in
`shared/contracts/activity-detail.ts`; stored JSON validators reject malformed
scores, tones, context and evidence rather than expose `unknown` response fields.

Classifier results carry a stable rule ID, observed measurements, applicable HR
policy and explicitly heuristic confidence. Import/replay store that evidence in
summary `analysis_json` and return it with historical HR-profile/telemetry-policy
provenance. Weather and cosmetic summary refreshes preserve classifier evidence.
Summary revision `telemetry-policy-v1` drives freshness and the grouped derived
upgrade. Read-only legacy snapshots remain usable without the new fields.

Dynamic insight sentences, factor descriptions and focus prose remain on the
legacy adapter. Migrating those emissions and relocating their Chinese copy to
typed dictionaries is still open; the module split does not close that protocol
work.
