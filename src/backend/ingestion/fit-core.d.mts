export interface FitMessage { [field: string]: unknown }
export interface FitRecord extends FitMessage { timestamp: string }
export interface FitSession extends FitMessage {
  start_time: string;
  total_distance?: number;
  total_timer_time?: number;
  total_elapsed_time?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  total_calories?: number;
  total_ascent?: number;
  total_descent?: number;
}
export interface FitData {
  records: FitRecord[];
  session: FitSession | null;
  sessions: FitSession[];
  laps: FitMessage[];
  events: FitMessage[];
  workouts: FitMessage[];
  workoutSteps: FitMessage[];
  devices: FitMessage[];
  hrv: FitMessage[];
  developerFields: Record<string, FitMessage>;
  messages: Record<string, FitMessage[]>;
  profileVersion: number;
  sourceFit: Uint8Array;
}
export interface FitExportOptions { id?: string; name?: string; session?: FitSession; utcOffsetSeconds?: number }
export interface FitExport {
  id: string; name: string; date: string; sport: string;
  metadataFields: Record<string, number | null | undefined>;
  metadata: FitMessage; records: FitRecord[]; session: FitSession;
}
export const FIT_EXPORT_VERSION: number;
export function isFitBuffer(input: ArrayBuffer | ArrayBufferView): boolean;
export function isZipBuffer(input: ArrayBuffer | ArrayBufferView): boolean;
export function extractFit(input: ArrayBuffer | ArrayBufferView): Uint8Array;
export function parseFit(input: ArrayBuffer | ArrayBufferView): FitData;
export { parseFit as parse };
export function prepareFitExport(parsed: FitData, activityMeta?: FitMessage, options?: FitExportOptions): FitExport;
export function toCSV(parsed: FitData, activityMeta?: FitMessage, options?: FitExportOptions): string;
