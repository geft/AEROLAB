export interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (importedActivityId?: string) => void;
}

export interface FileError {
  filename: string;
  error: string;
}

export interface BatchSummary {
  total: number;
  imported: number;
  skipped: number;
  skippedNonRun: number;
  errors: number;
  errorDetails: FileError[];
  skippedDetails: Array<{ filename: string; reason: string }>;
}
