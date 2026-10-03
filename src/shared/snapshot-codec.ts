import { decode, encode } from '@msgpack/msgpack';
import { gunzipSync } from 'fflate';

export const SNAPSHOT_SCHEMA_VERSION = 2;
export const SNAPSHOT_FILENAME = 'snapshot.msgpack.gz';
export const SNAPSHOT_RECORD_FIELDS = ['elapsed_seconds', 'heart_rate', 'speed_mps', 'altitude_m', 'distance_m'] as const;

type SnapshotObject = Record<string, unknown>;
interface SnapshotActivity extends SnapshotObject { id: string; start_time: string }
interface SnapshotRecord extends SnapshotObject { elapsed_seconds: number }
interface SnapshotDetail extends SnapshotObject { activity: SnapshotActivity; records: SnapshotRecord[] }
export interface SnapshotDocument extends SnapshotObject {
  schemaVersion: number;
  generatedAt: string;
  activities: SnapshotActivity[];
  details: Record<string, SnapshotDetail>;
  profile: SnapshotObject;
  bestEfforts: SnapshotObject;
  progressByRunType: SnapshotObject;
  thresholdsByRunType: SnapshotObject;
  volume: SnapshotObject;
  trainingLoadByDays: SnapshotObject;
}
interface PackedDetail extends SnapshotObject {
  records: Array<Array<number | null>>;
  activityDelta: SnapshotObject;
  activityDeleted: string[];
}
interface PackedSnapshot extends SnapshotObject {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  generatedAt: string;
  activities: SnapshotActivity[];
  details: Record<string, PackedDetail>;
  recordFields: typeof SNAPSHOT_RECORD_FIELDS;
}
export type SnapshotArchive = PackedSnapshot;

export class SnapshotDecodeError extends Error {
  constructor(public readonly code: 'ERR_SNAPSHOT_VERSION' | 'ERR_SNAPSHOT_INVALID', message: string) {
    super(message);
    this.name = 'SnapshotDecodeError';
  }
}

function object(value: unknown): value is SnapshotObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateSnapshotDocument(value: unknown): asserts value is SnapshotDocument {
  if (!object(value)) throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', 'Snapshot must be an object.');
  if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotDecodeError('ERR_SNAPSHOT_VERSION', `Unsupported snapshot schema version: ${value.schemaVersion}`);
  }
  if (typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) {
    throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', 'Snapshot generatedAt must be a valid ISO timestamp.');
  }
  for (const section of ['details', 'profile', 'bestEfforts', 'progressByRunType', 'thresholdsByRunType', 'volume', 'trainingLoadByDays']) {
    if (!object(value[section])) throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', `Snapshot is missing required section: ${section}`);
  }
  if (!Array.isArray(value.activities)) throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', 'Snapshot activities must be an array.');
  const ids = new Set<string>();
  for (const activity of value.activities) {
    if (!object(activity) || typeof activity.id !== 'string' || !activity.id || ids.has(activity.id)) {
      throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', 'Snapshot activity IDs must be unique non-empty strings.');
    }
    if (typeof activity.start_time !== 'string' || Number.isNaN(Date.parse(activity.start_time))) {
      throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', `Snapshot activity ${activity.id} has an invalid start_time.`);
    }
    ids.add(activity.id);
  }
  const details = value.details as SnapshotObject;
  for (const id of ids) if (!object(details[id])) throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', `Snapshot is missing detail data for activity ${id}.`);
}

/** Raw MessagePack; the exporter applies gzip level 9 with Node's zlib. */
export function encodeSnapshot(snapshot: unknown): Uint8Array {
  validateSnapshotDocument(snapshot);
  const activities = new Map(snapshot.activities.map(activity => [activity.id, activity]));
  const details = Object.fromEntries(Object.entries(snapshot.details).map(([id, detail]) => {
    const activity = activities.get(id);
    if (!activity) throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', `Snapshot detail has no activity: ${id}.`);
    const { activity: detailActivity, records, fitMetadata: _fitMetadata, ...summary } = detail;
    const activityDelta = Object.fromEntries(Object.entries(detailActivity)
      .filter(([key, value]) => value !== undefined && JSON.stringify(value) !== JSON.stringify(activity[key])));
    const activityDeleted = Object.keys(activity).filter(key => !Object.hasOwn(detailActivity, key) || detailActivity[key] === undefined);
    const columns = SNAPSHOT_RECORD_FIELDS.map(field => records.map(record => {
      const value = record[field];
      if (value == null && field !== 'elapsed_seconds') return null;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', `Invalid telemetry ${field} in ${id}.`);
      return value;
    }));
    return [id, { ...summary, records: columns, activityDelta, activityDeleted }];
  }));
  return encode({ ...snapshot, schemaVersion: SNAPSHOT_SCHEMA_VERSION, recordFields: SNAPSHOT_RECORD_FIELDS, details }, { ignoreUndefined: true });
}

/** Keep telemetry columnar until an individual detail is requested by the viewer. */
export function decodeSnapshotArchive(bytes: Uint8Array): SnapshotArchive {
  try {
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
    // Fetch may already decompress gzip when the host supplies Content-Encoding.
    const value: unknown = decode(raw);
    validateSnapshotDocument(value);
    const archive = value as unknown as SnapshotArchive;
    if (!Object.hasOwn(archive, 'recordFields')) throw new Error('Snapshot is missing its telemetry format.');
    if (JSON.stringify(archive.recordFields) !== JSON.stringify(SNAPSHOT_RECORD_FIELDS)) throw new Error('Unsupported telemetry columns.');
    for (const [id, detail] of Object.entries(archive.details)) {
      if (!object(detail.activityDelta) || !Array.isArray(detail.activityDeleted) || !detail.activityDeleted.every(key => typeof key === 'string')) throw new Error(`Invalid activity reference: ${id}.`);
      const columns = detail.records;
      if (!Array.isArray(columns) || columns.length !== SNAPSHOT_RECORD_FIELDS.length || !columns.every(Array.isArray)) throw new Error(`Invalid telemetry columns: ${id}.`);
      const count = columns[0].length;
      for (let column = 0; column < columns.length; column++) {
        if (columns[column].length !== count || !columns[column].every(value => (column > 0 && value === null) || (typeof value === 'number' && Number.isFinite(value)))) throw new Error(`Invalid telemetry values: ${id}.`);
      }
    }
    return archive;
  } catch (error) {
    if (error instanceof SnapshotDecodeError) throw error;
    throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', error instanceof Error ? error.message : 'Invalid snapshot data.');
  }
}

function expandDetail(snapshot: PackedSnapshot, id: string): SnapshotDetail | undefined {
  const detail = snapshot.details[id];
  if (!detail) return undefined;
  const activity = snapshot.activities.find(activity => activity.id === id);
  if (!activity) throw new SnapshotDecodeError('ERR_SNAPSHOT_INVALID', `Snapshot detail has no activity: ${id}.`);
  const { records: columns, activityDelta, activityDeleted, ...summary } = detail;
  const deleted = new Set(activityDeleted);
  const base = Object.fromEntries(Object.entries(activity).filter(([key]) => !deleted.has(key)));
  const records = Array.from({ length: columns[0].length }, (_, index) => ({
    elapsed_seconds: columns[0][index]!, heart_rate: columns[1][index],
    speed_mps: columns[2][index], altitude_m: columns[3][index], distance_m: columns[4][index],
    cadence: null,
  }));
  return { ...summary, activity: { ...base, ...activityDelta } as SnapshotActivity, records };
}

export function readSnapshotSection(snapshot: SnapshotArchive, section: string, key?: string): unknown {
  if (section === 'details') {
    return key === undefined
      ? Object.fromEntries(Object.keys(snapshot.details).map(id => [id, expandDetail(snapshot, id)]))
      : expandDetail(snapshot, key);
  }
  const value = snapshot[section];
  return key === undefined ? value : object(value) ? value[key] : undefined;
}

/** Export validation and tools can explicitly expand the complete document. */
export function decodeSnapshot(bytes: Uint8Array): SnapshotDocument {
  const snapshot = decodeSnapshotArchive(bytes);
  const { recordFields: _recordFields, ...document } = snapshot;
  return { ...document, details: readSnapshotSection(snapshot, 'details') } as SnapshotDocument;
}
