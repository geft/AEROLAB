export type ImportJobPhase = 'uploading' | 'decoding' | 'importing' | 'reanalysing' | 'complete' | 'failed';
export interface ImportJobResult {
  status: 'imported' | 'skipped_duplicate' | 'skipped_non_running' | 'error';
  activityId?: string;
  error?: string;
  reason?: string;
}
export interface ImportJobStatus {
  jobId: string;
  phase: ImportJobPhase;
  completed: number;
  total: number;
  uploaded: number;
  totalFiles: number;
  results?: ImportJobResult[];
  error?: string;
}
export interface StagedImportFile { filename: string; inputPath: string; outputPath: string }
export interface DecodedImportFile { index: number; date?: string; result?: ImportJobResult }
