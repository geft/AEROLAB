import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle, Files, RefreshCw, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { apiErrorMessage } from '../api/errors.js';
import { scanImportFolder } from '../api/client.js';
import type { IngestResultItem } from '../types/api.js';

interface GarminScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

export const GarminScanModal: React.FC<GarminScanModalProps> = ({ isOpen, onClose, onImportComplete }) => {
  const { t, format } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<IngestResultItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestInFlight = useRef(false);
  const onImportCompleteRef = useRef(onImportComplete);

  useEffect(() => {
    onImportCompleteRef.current = onImportComplete;
  }, [onImportComplete]);

  useEffect(() => {
    if (!isOpen || requestInFlight.current) return;
    requestInFlight.current = true;
    setScanning(true);
    setResults(null);
    setError(null);
    scanImportFolder()
      .then(data => {
        setResults(data.results);
        if (data.results.some(result => result.status === 'imported')) onImportCompleteRef.current?.();
      })
      .catch(err => setError(apiErrorMessage(t, err, t.garminImport.scanFailed)))
      .finally(() => {
        requestInFlight.current = false;
        setScanning(false);
      });
  }, [isOpen, t]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const imported = results?.filter(result => result.status === 'imported').length ?? 0;
  const duplicates = results?.filter(result => result.status === 'skipped_duplicate').length ?? 0;
  const nonRunning = results?.filter(result => result.status === 'skipped_non_running').length ?? 0;
  const errors = results?.filter(result => result.status === 'error').length ?? 0;
  const heading = errors > 0
    ? (imported > 0 ? t.upload.batchWarnings : t.upload.batchFailed)
    : (imported === 0
      ? (duplicates > 0 ? t.upload.alreadyInDatabase : t.upload.nonRunCard)
      : t.upload.batchSuccess);

  const resultLabel = (result: IngestResultItem): string => {
    switch (result.status) {
      case 'imported': return t.garminImport.resultImported;
      case 'skipped_duplicate': return t.garminImport.resultDuplicate;
      case 'skipped_non_running': return t.garminImport.resultNonRunning;
      case 'error': return t.garminImport.resultError;
    }
  };

  const resultColor = (result: IngestResultItem): string => {
    switch (result.status) {
      case 'imported': return 'var(--accent-emerald)';
      case 'skipped_duplicate': return 'var(--accent-amber)';
      case 'skipped_non_running': return 'var(--text-secondary)';
      case 'error': return 'var(--accent-rose)';
    }
  };

  return createPortal(
    <div className="modal-overlay garmin-scan-overlay" onClick={onClose}>
      <div className="modal-content garmin-scan-modal" role="dialog" aria-modal="true" aria-busy={scanning} aria-labelledby="garmin-scan-modal-title" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Files size={20} color="var(--accent-cyan)" />
            <h2 id="garmin-scan-modal-title" className="modal-title" style={{ color: 'var(--text-primary)' }}>{t.garminImport.modalTitle}</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t.upload.done} title={t.upload.done}>
            <X size={20} />
          </button>
        </div>

        {scanning && (
          <div className="garmin-scan-loading" role="status" aria-live="polite">
            <RefreshCw size={22} className="spinning" />
            <span>{t.garminImport.scanning}</span>
          </div>
        )}

        {error && (
          <div className="garmin-scan-error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {results && results.length === 0 && <p className="garmin-scan-empty">{t.garminImport.noFiles}</p>}

        {results && results.length > 0 && (
          <div className="garmin-scan-results">
            <div className="garmin-scan-summary">
              <div className="garmin-scan-summary-heading" style={{ color: errors > 0 ? (imported > 0 ? 'var(--accent-amber)' : 'var(--accent-rose)') : 'var(--accent-emerald)' }}>
                {errors > 0 ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
                <strong>{heading}</strong>
              </div>
              <div className="garmin-scan-counts">
                <div><strong style={{ color: 'var(--accent-emerald)' }}>{imported}</strong><span>{t.upload.importedCard}</span></div>
                <div><strong style={{ color: 'var(--accent-amber)' }}>{duplicates}</strong><span>{t.upload.skippedCard}</span></div>
                <div><strong>{nonRunning}</strong><span>{t.upload.nonRunCard}</span></div>
                <div><strong style={{ color: errors > 0 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>{errors}</strong><span>{t.upload.errorsCard}</span></div>
              </div>
              <p>{format(t.garminImport.filesScanned, { count: results.length })}</p>
            </div>

            <div className="garmin-scan-file-list" aria-label={t.garminImport.resultDetails}>
              {results.map((result, index) => (
                <div className="garmin-scan-file" key={`${result.filename}-${index}`}>
                  <div className="garmin-scan-file-name" title={result.filename}>{result.filename}</div>
                  <span className="garmin-scan-file-status" style={{ color: resultColor(result) }}>
                    {resultLabel(result)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(results || error) && (
          <div className="garmin-scan-footer">
            <button type="button" onClick={onClose}>{t.upload.done}</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
