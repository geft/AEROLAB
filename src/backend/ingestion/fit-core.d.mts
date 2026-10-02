export interface FitMessage { [field: string]: any }
export interface FitData {
  records: FitMessage[];
  session: FitMessage | null;
  sessions: FitMessage[];
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
export interface FitExportOptions { id?: string; name?: string; session?: FitMessage; utcOffsetSeconds?: number }
export interface FitExport {
  id: string; name: string; date: string; sport: string;
  metadataFields: Record<string, number | null | undefined>;
  metadata: FitMessage; records: FitMessage[]; session: FitMessage;
}
export const FIT_EXPORT_VERSION: number;
export function isFitBuffer(input: ArrayBuffer | ArrayBufferView): boolean;
export function isZipBuffer(input: ArrayBuffer | ArrayBufferView): boolean;
export function extractFit(input: ArrayBuffer | ArrayBufferView): Uint8Array;
export function parseFit(input: ArrayBuffer | ArrayBufferView): FitData;
export { parseFit as parse };
export function prepareFitExport(parsed: FitData, activityMeta?: FitMessage, options?: FitExportOptions): FitExport;
export function toCSV(parsed: FitData, activityMeta?: FitMessage, options?: FitExportOptions): string;
