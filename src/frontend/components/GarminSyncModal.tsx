import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, CloudDownload, ExternalLink, KeyRound, RefreshCw, Settings, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { apiErrorMessage } from '../api/errors.js';
import { ApiRequestError, getGarminKeyStatus, syncGarmin } from '../api/client.js';
import { GARMIN_API_KEY_ENV, GARMIN_API_KEY_EXPIRY_ENV, GARMIN_PERSONAL_API_KEY_URL, GARMIN_SYNC_BATCH_SIZE } from '../../shared/garmin.js';
import type { GarminKeyStatus, GarminSyncResponse, GarminSyncResultItem } from '../types/api.js';

interface GarminSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onImportComplete?: () => void;
}

type Phase = 'loading' | 'ready' | 'syncing' | 'done' | 'error';

export const GarminSyncModal: React.FC<GarminSyncModalProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onImportComplete
}) => {
  const { t, format, formatDate } = useTranslation();
  const [status, setStatus] = useState<GarminKeyStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [result, setResult] = useState<GarminSyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const autoSyncRef = useRef(false);
  const inFlightRef = useRef(false);
  const onImportCompleteRef = useRef(onImportComplete);

  useEffect(() => {
    onImportCompleteRef.current = onImportComplete;
  }, [onImportComplete]);

  const runSync = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPhase('syncing');
    setError(null);
    setNeedsKey(false);
    setResult(null);
    try {
      const response = await syncGarmin();
      setResult(response);
      setStatus(response.key);
      setPhase('done');
      if (response.imported > 0) onImportCompleteRef.current?.();
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : null;
      setError(apiErrorMessage(t, err, t.garminSync.syncFailed));
      setNeedsKey(code === 'GARMIN_KEY_MISSING' || code === 'GARMIN_KEY_INVALID');
      setPhase('error');
      if (code === 'GARMIN_KEY_MISSING' || code === 'GARMIN_KEY_INVALID') {
        void getGarminKeyStatus()
          .then(data => setStatus(data?.key ?? null))
          .catch(() => undefined);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [t]);

  useEffect(() => {
    if (!isOpen) {
      autoSyncRef.current = false;
      return;
    }
    let cancelled = false;
    getGarminKeyStatus()
      .then(data => {
        if (cancelled) return;
        setStatus(data?.key ?? null);
        setPhase('ready');
      })
      .catch(err => {
        if (cancelled) return;
        setError(apiErrorMessage(t, err, t.garminSync.syncFailed));
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [isOpen, t]);

  useEffect(() => {
    if (!isOpen || autoSyncRef.current || phase !== 'ready' || !status?.configured) return;
    autoSyncRef.current = true;
    void runSync();
  }, [isOpen, phase, status, runSync]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const openSettings = () => {
    onClose();
    onOpenSettings();
  };

  const resultLabel = (item: GarminSyncResultItem): string => {
    switch (item.status) {
      case 'imported': return t.garminSync.imported;
      case 'skipped_duplicate': return t.garminSync.duplicates;
      case 'skipped_non_running': return t.garminSync.nonRunning;
      case 'skipped_no_file': return t.garminSync.noFile;
      case 'error': return t.garminSync.errors;
    }
  };

  const resultColor = (item: GarminSyncResultItem): string => {
    switch (item.status) {
      case 'imported': return 'var(--accent-emerald)';
      case 'skipped_duplicate': return 'var(--accent-amber)';
      case 'skipped_non_running': return 'var(--text-secondary)';
      case 'skipped_no_file': return 'var(--text-secondary)';
      case 'error': return 'var(--accent-rose)';
    }
  };

  const configured = status?.configured === true;
  const showSetup = status !== null && !configured && phase !== 'loading' && phase !== 'syncing';
  const loading = phase === 'loading' || (phase === 'ready' && configured);
  const fetchAll = result?.results ?? [];
  const noNewRuns = result !== null && result.newerFound + result.olderFound === 0;
  const hasMore = result !== null && (result.hasMoreNewer || result.hasMoreOlder);

  return createPortal(
    <div className="modal-overlay garmin-scan-overlay" onClick={onClose}>
      <div
        className="modal-content garmin-scan-modal garmin-sync-modal"
        role="dialog"
        aria-modal="true"
        aria-busy={phase === 'syncing' || loading}
        aria-labelledby="garmin-sync-modal-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CloudDownload size={20} color="var(--accent-cyan)" />
            <h2 id="garmin-sync-modal-title" className="modal-title" style={{ color: 'var(--text-primary)' }}>
              {t.garminSync.title}
            </h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label={t.common.done} title={t.common.done}>
            <X size={20} />
          </button>
        </div>

        <div className="garmin-sync-body">
          {loading && (
            <div className="garmin-scan-loading" role="status" aria-live="polite">
              <RefreshCw size={22} className="spinning" />
              <span>{t.common.loading}</span>
            </div>
          )}

          {showSetup && (
            <div className="garmin-sync-setup" role="status">
              <div className="garmin-sync-setup-heading">
                <KeyRound size={20} />
                <strong>{status?.expired ? t.garminSync.expiredKeyTitle : t.garminSync.missingKeyTitle}</strong>
              </div>
              <p>{status?.expired ? t.garminSync.expiredKeyDescription : t.garminSync.missingKeyDescription}</p>
              <p>{format(t.garminSync.description, { count: GARMIN_SYNC_BATCH_SIZE })}</p>
              <p className="garmin-sync-hint">{format(t.garminSync.envHint, { env: GARMIN_API_KEY_ENV, expiryEnv: GARMIN_API_KEY_EXPIRY_ENV })}</p>
              <div className="garmin-sync-actions">
                <a className="garmin-sync-link" href={GARMIN_PERSONAL_API_KEY_URL} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> {t.garminSync.getKey}
                </a>
                <button type="button" className="garmin-folder-action" onClick={openSettings}>
                  <Settings size={15} /> {t.garminSync.openSettings}
                </button>
              </div>
            </div>
          )}

          {configured && status?.expired && (
            <div className="garmin-sync-warning" role="alert">
              <TriangleAlert size={18} />
              <span>{format(t.garminSync.expiredEnvironmentKeyDescription, { env: GARMIN_API_KEY_ENV })}</span>
              <button type="button" className="garmin-sync-warning-action" onClick={openSettings}>
                {t.garminSync.openSettings}
              </button>
            </div>
          )}

          {configured && status?.expiringSoon && !status.expired && status.expiresAt && (
            <div className="garmin-sync-warning" role="alert">
              <TriangleAlert size={18} />
              <span>
                {(status.daysUntilExpiry ?? 0) <= 0
                  ? format(t.garminSync.keyExpiringToday, { date: formatDate(status.expiresAt, { dateStyle: 'medium' }) })
                  : format(t.garminSync.keyExpiringSoon, {
                    date: formatDate(status.expiresAt, { dateStyle: 'medium' }),
                    days: status.daysUntilExpiry ?? 0
                  })}
              </span>
              <button type="button" className="garmin-sync-warning-action" onClick={openSettings}>
                {t.garminSync.openSettings}
              </button>
            </div>
          )}

          {phase === 'syncing' && (
            <>
              <p className="garmin-sync-description">
                {format(t.garminSync.syncingDescription, { count: GARMIN_SYNC_BATCH_SIZE })}
              </p>
              <div className="garmin-scan-loading" role="status" aria-live="polite">
                <RefreshCw size={22} className="spinning" />
                <span>{t.garminSync.syncing}</span>
              </div>
            </>
          )}

          {error && (
            <div className="garmin-scan-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              {needsKey && (
                <button type="button" className="garmin-sync-warning-action" onClick={openSettings}>
                  {t.garminSync.openSettings}
                </button>
              )}
            </div>
          )}

          {result && (
            <div className="garmin-scan-results garmin-sync-results">
              <div className="garmin-scan-summary">
                <div
                  className="garmin-scan-summary-heading"
                  style={{ color: result.errors > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)' }}
                >
                  {result.errors > 0 ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
                  <strong>{noNewRuns ? t.garminSync.noNewRuns : t.garminSync.complete}</strong>
                </div>
                <p>{format(t.garminSync.summary, { newer: result.newerFound, older: result.olderFound })}</p>
                <div className="garmin-scan-counts">
                  <div><strong style={{ color: 'var(--accent-emerald)' }}>{result.imported}</strong><span>{t.garminSync.imported}</span></div>
                  <div><strong style={{ color: 'var(--accent-amber)' }}>{result.duplicates}</strong><span>{t.garminSync.duplicates}</span></div>
                  <div><strong>{result.nonRunning}</strong><span>{t.garminSync.nonRunning}</span></div>
                  {result.noFile > 0 && (
                    <div><strong style={{ color: 'var(--text-secondary)' }}>{result.noFile}</strong><span>{t.garminSync.noFile}</span></div>
                  )}
                  <div><strong style={{ color: result.errors > 0 ? 'var(--accent-rose)' : 'var(--text-muted)' }}>{result.errors}</strong><span>{t.garminSync.errors}</span></div>
                </div>
                {hasMore && <p>{format(t.garminSync.hasMore, { count: result.batchLimit })}</p>}
              </div>

              {fetchAll.length > 0 && (
                <div className="garmin-scan-file-list" aria-label={t.garminSync.resultsLabel}>
                  {fetchAll.map((item, index) => (
                    <div className="garmin-scan-file" key={`${item.filename}-${index}`}>
                      <div className="garmin-scan-file-name" title={item.error ?? item.filename}>
                        {item.activityName || item.filename}
                      </div>
                      <span className="garmin-scan-file-status" style={{ color: resultColor(item) }}>
                        {resultLabel(item)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {(phase === 'done' || (phase === 'error' && !needsKey) || (phase === 'error' && needsKey && configured)) && (
          <div className="garmin-scan-footer garmin-sync-footer">
            <button type="button" className="outline-btn" onClick={onClose}>{t.common.done}</button>
            <button type="button" className="garmin-folder-action" onClick={() => void runSync()}>
              <RefreshCw size={15} /> {t.garminSync.syncAgain}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
