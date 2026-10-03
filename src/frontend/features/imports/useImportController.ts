import React, { useState, useRef } from 'react';
import { uploadActivity, uploadActivities } from '../../api/client.js';
import { IMPORT_BATCH_BYTES, IMPORT_BATCH_SIZE } from '../../../shared/import-batch.js';
import { encodeUploadFile, importJobPercent, uploadImportJob } from '../../utils/import-job.js';
import type { UploadResult } from '../../types/api.js';
import { apiErrorMessage } from '../../api/errors.js';
import { useTranslation } from '../../i18n/LanguageContext.js';
import type { UploadModalProps, BatchSummary, FileError } from './types.js';

export function useImportController(onClose: UploadModalProps['onClose'], onUploadSuccess: UploadModalProps['onUploadSuccess']) {
  const { t } = useTranslation();
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

  return { isDragging, uploading, progress, summary, setSummary, statusMessage, error, overwrite, setOverwrite,
    lastSingleActivityId, fileInputRef, handleDragOver, handleDragLeave, handleDrop, handleFileSelect, handleClose };
}
