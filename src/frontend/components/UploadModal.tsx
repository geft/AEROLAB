import React, { useState, useRef } from 'react';
import { uploadActivity, uploadActivities } from '../api/client.js';
import { IMPORT_BATCH_BYTES, IMPORT_BATCH_SIZE } from '../../shared/import-batch.js';
import { encodeUploadFile, importJobPercent, uploadImportJob } from '../utils/import-job.js';
import type { UploadResult } from '../types/api.js';
import { apiErrorMessage } from '../api/errors.js';
import { UploadCloud, CheckCircle, AlertCircle, X, Files } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';

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
  const { t, plural, format } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; currentFileName: string; label: string; percent: number } | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [, setLastUploadedFiles] = useState<File[]>([]);
  const [lastSingleActivityId, setLastSingleActivityId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFiles = async (fileList: FileList | File[], forceOverwrite?: boolean) => {
    const allFiles = Array.from(fileList);
    const validFiles = allFiles.filter(f => {
      const l = f.name.toLowerCase();
      return l.endsWith('.fit') || l.endsWith('.zip');
    });

    if (validFiles.length === 0) {
      setError(t.upload.fitZipOnly);
      return;
    }

    const effectiveOverwrite = forceOverwrite !== undefined ? forceOverwrite : overwrite;
    if (forceOverwrite) {
      setOverwrite(true);
    }
    setLastUploadedFiles(validFiles);
    setUploading(true);
    setError(null);
    setSummary(null);
    setStatusMessage(null);
    setProgress({ current: 0, total: validFiles.length, currentFileName: validFiles[0].name,
      label: t.upload.uploadingFiles, percent: 0 });

    let imported = 0;
    let skipped = 0;
    let skippedNonRun = 0;
    let errors = 0;
    let singleActivityId: string | undefined = undefined;
    const errorDetails: FileError[] = [];
    const skippedDetails: Array<{ filename: string; reason: string }> = [];

    const acceptResult = (result: UploadResult, filename: string) => {
      if (result.status === 'imported') {
        imported++;
        if (validFiles.length === 1) singleActivityId = result.activityId;
      } else if (result.status === 'skipped' || result.status === 'skipped_duplicate') {
        skipped++;
        if (validFiles.length === 1) singleActivityId = result.activityId;
        if (result.reason === 'non_run') skippedNonRun++;
        skippedDetails.push({ filename, reason: result.message || t.upload.alreadyInDatabase });
      } else if (result.status === 'skipped_non_run' || result.status === 'skipped_non_running') {
        skippedNonRun++;
        skippedDetails.push({ filename, reason: t.upload.nonRunCard });
      } else {
        errors++;
        errorDetails.push({ filename, error: t.upload.importFailed });
      }
    };

    if (validFiles.length > IMPORT_BATCH_SIZE) {
      try {
        const results = await uploadImportJob(validFiles, effectiveOverwrite, status => {
          const phaseCopy = { uploading: t.upload.uploadingFiles, decoding: t.upload.decodingFiles,
            importing: t.upload.importingCount, reanalysing: t.upload.reanalysingRuns,
            complete: t.upload.importingCount, failed: t.upload.importFailed };
          setProgress(previous => ({ current: status.completed, total: Math.max(1, status.total),
            currentFileName: phaseCopy[status.phase], label: phaseCopy[status.phase],
            percent: Math.max(previous?.percent ?? 0, importJobPercent(status)) }));
        });
        results.forEach((result, index) => acceptResult(result, validFiles[index].name));
      } catch (err) {
        errors = validFiles.length;
        validFiles.forEach(file => errorDetails.push({ filename: file.name, error: apiErrorMessage(t, err, t.upload.importFailed) }));
      }
    } else {

      for (let i = 0; i < validFiles.length;) {
        const batch: File[] = [];
        let batchBytes = 0;
        while (i + batch.length < validFiles.length && batch.length < IMPORT_BATCH_SIZE) {
          const next = validFiles[i + batch.length];
          if (batch.length && batchBytes + next.size > IMPORT_BATCH_BYTES) break;
          batch.push(next);
          batchBytes += next.size;
        }
        setProgress({
          current: i,
          total: validFiles.length,
          currentFileName: batch[0].name,
          label: t.upload.importingCount,
          percent: Math.floor(i / validFiles.length * 100)
        });

        // Prepare a bounded group concurrently; each file retains its own result.
        const prepared = await Promise.allSettled(batch.map(encodeUploadFile));
        const payloads: Array<{ content: string; filename: string }> = [];
        prepared.forEach((item, index) => {
          if (item.status === 'fulfilled') payloads.push(item.value);
          else {
            errors++;
            errorDetails.push({ filename: batch[index].name, error: apiErrorMessage(t, item.reason, t.upload.importFailed) });
          }
        });
        try {
          const results = payloads.length === 0 ? [] : validFiles.length === 1
            ? [(await uploadActivity({ ...payloads[0], force: effectiveOverwrite, overwrite: effectiveOverwrite })).result]
            : (await uploadActivities({ files: payloads, force: effectiveOverwrite })).results;
          for (let index = 0; index < results.length; index++) {
            acceptResult(results[index], payloads[index].filename);
          }
        } catch (err) {
          errors += payloads.length;
          payloads.forEach(file => errorDetails.push({ filename: file.filename, error: apiErrorMessage(t, err, t.upload.importFailed) }));
        }
        i += batch.length;
      }
    }

    setUploading(false);
    setProgress(null);
    setLastSingleActivityId(validFiles.length === 1 ? (singleActivityId || null) : null);

    setSummary({
      total: validFiles.length,
      imported,
      skipped,
      skippedNonRun,
      errors,
      errorDetails,
      skippedDetails
    });

    if (imported > 0 || (validFiles.length === 1 && singleActivityId)) {
      onUploadSuccess(validFiles.length === 1 ? singleActivityId : undefined);
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
    if (uploading) return;
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
            <h2 className="modal-title" style={{ color: 'var(--text-primary)' }}>{t.upload.title}</h2>
          </div>
          <button className="modal-close-btn" onClick={handleClose} disabled={uploading}><X size={20} /></button>
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
                  {t.upload.dragDrop}
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {t.upload.selectFiles}
                </p>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".fit,.FIT,.zip,.ZIP"
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
              <span>{t.upload.overwriteTip}</span>
            </label>
          </>
        )}

        {/* Live Progress Bar */}
        {uploading && progress && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1rem 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {progress.label} ({progress.current}/{progress.total})
              </span>
              <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>
                {progress.percent}%
              </span>
            </div>

            <div role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} style={{ width: '100%', height: 8, background: 'var(--bg-surface)', borderRadius: 999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progress.percent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-emerald))',
                  borderRadius: 999,
                  transition: 'width 0.2s ease'
                }}
              />
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {format(t.upload.currentFile, { filename: progress.currentFileName })}
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
              color: summary.errors > 0
                ? (summary.imported > 0 ? 'var(--accent-amber)' : 'var(--accent-rose)')
                : (summary.imported === 0 && summary.skipped > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)'),
              fontWeight: 700,
              fontSize: '0.95rem'
            }}>
              {summary.errors > 0 ? (
                <AlertCircle size={18} />
              ) : summary.imported === 0 && summary.skipped > 0 ? (
                <AlertCircle size={18} />
              ) : (
                <CheckCircle size={18} />
              )}
              <span>
                {summary.errors > 0
                  ? summary.imported > 0
                    ? t.upload.batchWarnings
                    : t.upload.batchFailed
                  : summary.imported === 0 && summary.skipped > 0
                    ? t.upload.alreadyInDatabase
                    : t.upload.batchSuccess}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: summary.skippedNonRun > 0 ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)', gap: '0.5rem', textAlign: 'center' }}>
              <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>{summary.imported}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t.upload.importedCard}</div>
              </div>

              <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-amber)' }}>{summary.skipped}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t.upload.skippedCard}</div>
              </div>

              {summary.skippedNonRun > 0 && (
                <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-secondary)' }}>{summary.skippedNonRun}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t.upload.nonRunCard}</div>
                </div>
              )}

              <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: summary.errors > 0 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>{summary.errors}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t.upload.errorsCard}</div>
              </div>
            </div>

            {/* Detailed Errors Section */}
            {summary.errorDetails && summary.errorDetails.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-rose)', fontWeight: 700, fontSize: '0.82rem' }}>
                  <AlertCircle size={15} />
                  <span>{t.upload.errorDetails} ({summary.errorDetails.length}):</span>
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
                            {t.upload.dupTip}
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
                {plural(summary.skipped, t.upload.skippedFiles)}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              {(summary.skipped > 0 || summary.errors > 0) && (
                <button
                  type="button"
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
                  {t.upload.retryWithOverwrite}
                </button>
              )}

              {lastSingleActivityId && (
                <button
                  type="button"
                  onClick={() => {
                    onUploadSuccess(lastSingleActivityId);
                    handleClose();
                  }}
                  style={{
                    background: 'var(--accent-emerald)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '0.45rem 1rem',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  {t.upload.viewRun}
                </button>
              )}

              <button
                type="button"
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
                {t.upload.done}
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
