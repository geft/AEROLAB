import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, X, Check, Files } from 'lucide-react';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (importedActivityId?: string) => void;
}

interface FileError {
  filename: string;
  error: string;
}

interface BatchSummary {
  total: number;
  imported: number;
  skipped: number;
  skippedNonRun: number;
  errors: number;
  errorDetails: FileError[];
  skippedDetails: Array<{ filename: string; reason: string }>;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onUploadSuccess }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentFileName: string } | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const allFiles = Array.from(fileList);
    const validFiles = allFiles.filter(f => {
      const l = f.name.toLowerCase();
      return l.endsWith('.csv') || l.endsWith('.fit');
    });

    if (validFiles.length === 0) {
      setError('Please upload .fit or .csv file(s) exported from your Garmin device or run-parser.');
      return;
    }

    setUploading(true);
    setError(null);
    setSummary(null);
    setStatusMessage(null);

    let imported = 0;
    let skipped = 0;
    let skippedNonRun = 0;
    let errors = 0;
    let singleActivityId: string | undefined = undefined;
    const errorDetails: FileError[] = [];
    const skippedDetails: Array<{ filename: string; reason: string }> = [];

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setProgress({
        current: i + 1,
        total: validFiles.length,
        currentFileName: file.name
      });

      try {
        let content: string;
        if (file.name.toLowerCase().endsWith('.fit')) {
          const buffer = await file.arrayBuffer();
          let binary = '';
          const bytes = new Uint8Array(buffer);
          const len = bytes.byteLength;
          for (let b = 0; b < len; b++) {
            binary += String.fromCharCode(bytes[b]);
          }
          content = btoa(binary);
        } else {
          content = await file.text();
        }

        const res = await fetch('/api/ingest/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            filename: file.name,
            force: overwrite
          })
        });

        const data = await res.json();
        if (!res.ok) {
          errors++;
          errorDetails.push({
            filename: file.name,
            error: data.error || `Server returned HTTP ${res.status}`
          });
        } else if (data.result?.status === 'skipped_non_running') {
          skippedNonRun++;
        } else if (data.result?.status === 'skipped_duplicate') {
          skipped++;
          if (validFiles.length === 1 && data.result?.activityId) {
            singleActivityId = data.result.activityId;
          }
          skippedDetails.push({
            filename: file.name,
            reason: 'Already imported in database'
          });
        } else if (data.result?.status === 'error') {
          errors++;
          errorDetails.push({
            filename: file.name,
            error: data.result.error || 'Ingestion failed'
          });
        } else {
          imported++;
          if (validFiles.length === 1 && data.result?.activityId) {
            singleActivityId = data.result.activityId;
          }
        }
      } catch (err: any) {
        errors++;
        errorDetails.push({
          filename: file.name,
          error: err.message || 'Network error or file read failure'
        });
      }
    }

    setUploading(false);
    setProgress(null);
    const batchSummary: BatchSummary = {
      total: validFiles.length,
      imported,
      skipped,
      skippedNonRun,
      errors,
      errorDetails,
      skippedDetails
    };
    setSummary(batchSummary);
    if (imported > 0 || (validFiles.length === 1 && singleActivityId)) {
      onUploadSuccess(validFiles.length === 1 ? singleActivityId : undefined);
    }

    // If single file and successfully imported without error, auto-close after a short preview
    if (validFiles.length === 1 && imported === 1 && errors === 0) {
      setStatusMessage('Activity successfully imported!');
      setTimeout(() => {
        handleClose();
      }, 750);
    }
  };


  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
  };

  const handleClose = () => {
    setError(null);
    setStatusMessage(null);
    setSummary(null);
    setProgress(null);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Files size={20} color="var(--accent-cyan)" />
            <h2 className="modal-title" style={{ color: 'var(--text-primary)' }}>Import Garmin Runs (FIT or CSV)</h2>
          </div>
          <button className="modal-close-btn" onClick={handleClose}><X size={20} /></button>
        </div>

        {!uploading && !summary && (
          <>
            <div
              className={`drop-area-large ${isDragging ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud size={44} color="var(--accent-cyan)" />
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                  Drag & Drop one or multiple FIT or CSV files here
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Supports multi-file batch upload — native Garmin .FIT and exported .CSV
                </p>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".csv,.fit,.FIT"
                multiple
                style={{ display: 'none' }}
              />
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              userSelect: 'none'
            }}>
              <input
                type="checkbox"
                checked={overwrite}
                onChange={e => setOverwrite(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: 'var(--accent-cyan)' }}
              />
              <span>Overwrite / re-calculate if activity was already imported</span>
            </label>
          </>
        )}

        {/* Live Progress Bar */}
        {uploading && progress && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                Importing {progress.current} of {progress.total} run{progress.total > 1 ? 's' : ''}...
              </span>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>
                {Math.round((progress.current / progress.total) * 100)}%
              </span>
            </div>

            <div style={{ width: '100%', height: 8, background: 'var(--bg-surface)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-emerald))',
                  borderRadius: 999,
                  transition: 'width 0.2s ease'
                }}
              />
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Current: {progress.currentFileName}
            </p>
          </div>
        )}

        {/* Batch Completion Summary */}
        {summary && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            background: 'var(--tag-pill-bg)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            padding: '1.25rem'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: summary.errors > 0 ? (summary.imported > 0 ? 'var(--accent-amber)' : 'var(--accent-rose)') : 'var(--accent-emerald)',
              fontWeight: 700,
              fontSize: '0.95rem'
            }}>
              {summary.errors > 0 ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
              <span>
                {summary.errors > 0
                  ? summary.imported > 0
                    ? 'Batch Ingestion Completed with Warnings'
                    : 'Batch Ingestion Failed'
                  : 'Batch Ingestion Completed Successfully'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: summary.skippedNonRun > 0 ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: '0.5rem', textAlign: 'center' }}>
              <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>{summary.imported}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Imported</div>
              </div>

              <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-amber)' }}>{summary.skipped}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Skipped (Dup)</div>
              </div>

              {summary.skippedNonRun > 0 && (
                <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-secondary)' }}>{summary.skippedNonRun}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Non-Run / Sleep</div>
                </div>
              )}

              <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: summary.errors > 0 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>{summary.errors}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Errors</div>
              </div>
            </div>

            {/* Detailed Error Breakdown List */}
            {summary.errorDetails && summary.errorDetails.length > 0 && (
              <div style={{
                background: 'rgba(244, 63, 94, 0.08)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                borderRadius: 8,
                padding: '0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-rose)', fontWeight: 700, fontSize: '0.82rem' }}>
                  <AlertCircle size={15} />
                  <span>Error Details ({summary.errorDetails.length} file{summary.errorDetails.length > 1 ? 's' : ''}):</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: '160px', overflowY: 'auto' }}>
                  {summary.errorDetails.map((item, idx) => {
                    const isUniqueError = item.error.toLowerCase().includes('unique') || item.error.toLowerCase().includes('already exists');
                    return (
                      <div
                        key={idx}
                        style={{
                          fontSize: '0.78rem',
                          background: 'var(--bg-card)',
                          padding: '0.5rem 0.65rem',
                          borderRadius: 6,
                          border: '1px solid rgba(244, 63, 94, 0.2)'
                        }}
                      >
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
                          📄 {item.filename}
                        </div>
                        <div style={{ color: 'var(--accent-rose)', marginTop: '0.2rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                          {item.error}
                        </div>
                        {isUniqueError && (
                          <div style={{ color: 'var(--accent-amber)', fontSize: '0.72rem', marginTop: '0.25rem' }}>
                            💡 Tip: This activity already exists in the database. Enable the <b>"Overwrite / re-calculate"</b> option to replace it.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Skipped Duplicates Informational Note */}
            {summary.skipped > 0 && (
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                background: 'var(--bg-surface)',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)'
              }}>
                ℹ️ {summary.skipped} file{summary.skipped > 1 ? 's were' : ' was'} skipped because the activity ID already exists. Check <b>"Overwrite / re-calculate"</b> if you wish to re-import.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              {summary.errors > 0 && (
                <button
                  onClick={() => {
                    setSummary(null);
                    setOverwrite(true);
                  }}
                  style={{
                    background: 'transparent',
                    color: 'var(--accent-cyan)',
                    border: '1px solid var(--accent-cyan)',
                    borderRadius: 6,
                    padding: '0.45rem 1rem',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  Retry with Overwrite
                </button>
              )}

              <button
                onClick={handleClose}
                style={{
                  background: 'var(--accent-cyan)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '0.45rem 1.25rem',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {statusMessage && !uploading && !summary && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-emerald)', fontSize: '0.85rem' }}>
            <CheckCircle size={16} />
            <span>{statusMessage}</span>
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-rose)', fontSize: '0.85rem' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
