import React, { useState, useEffect, useRef } from 'react';
import type { DatabaseStatus, DatabaseSnapshot } from '../types/api.js';
import {
  HardDrive, Download, FileUp, RefreshCw, FolderOpen,
  CheckCircle2, AlertCircle, FolderSync, Check, CloudUpload,
  LoaderCircle, TriangleAlert
} from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import {
  ApiRequestError, backupDatabase, deleteDatabaseSnapshot, deploySnapshotToVercel,
  getDatabaseStatus, getSnapshotDeploymentStatus, restoreDatabase, restoreDatabaseSnapshot,
  saveBackupSettings, selectBackupFolder, openBackupFolder,
  type SnapshotDeploymentPhase
} from '../api/client.js';
import { apiErrorMessage } from '../api/errors.js';

const DEPLOYMENT_STEPS: Exclude<SnapshotDeploymentPhase, 'failed'>[] = [
  'checking', 'login', 'linking', 'exporting', 'validating', 'building', 'deploying', 'complete'
];

interface SnapshotHistoryRowProps {
  snapshot: DatabaseSnapshot;
  isRestoring: boolean;
  deletingFilename: string | null;
  onRestore: (filename: string) => void;
  onDelete: (filename: string) => void;
}

const SnapshotHistoryRow: React.FC<SnapshotHistoryRowProps> = ({
  snapshot, isRestoring, deletingFilename, onRestore, onDelete
}) => {
  const { t, format } = useTranslation();
  const [deploying, setDeploying] = useState(false);
  const [deployment, setDeployment] = useState<{
    phase: SnapshotDeploymentPhase;
    deploymentUrl?: string;
    error?: string;
  } | null>(null);

  const handleDeploy = async () => {
    if (!window.confirm(format(t.snapshot.deployProtectionConfirmation, { filename: snapshot.filename }))) return;
    setDeploying(true);
    setDeployment({ phase: 'checking' });
    try {
      const { jobId } = await deploySnapshotToVercel(snapshot.filename);
      while (true) {
        const status = await getSnapshotDeploymentStatus(jobId);
        if (status.phase === 'complete' && status.deploymentUrl) {
          setDeployment({ phase: 'complete', deploymentUrl: status.deploymentUrl });
          break;
        }
        if (status.phase === 'failed') {
          setDeployment({ phase: 'failed', error: status.error || t.snapshot.deployFailed });
          break;
        }
        setDeployment({ phase: status.phase });
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    } catch (err) {
      const error = err instanceof ApiRequestError && err.code === 'ERR_SNAPSHOT_NOT_FOUND'
        ? t.snapshot.deploySnapshotMissing
        : `${t.snapshot.deployFailed} ${err instanceof Error ? err.message : ''}`.trim();
      setDeployment({ phase: 'failed', error });
    } finally {
      setDeploying(false);
    }
  };

  const sizeMb = snapshot.sizeMb ?? (snapshot.sizeBytes ? (snapshot.sizeBytes / (1024 * 1024)).toFixed(2) : '0.00');
  const activeStep = deployment && deployment.phase !== 'failed' ? DEPLOYMENT_STEPS.indexOf(deployment.phase) : -1;

  return (
    <>
      <tr className="backup-snapshot-row" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{snapshot.filename}</td>
        <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-secondary)' }}>{new Date(snapshot.createdAt).toLocaleString()}</td>
        <td style={{ padding: '0.65rem 0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{sizeMb} MB</td>
        <td style={{ padding: '0.5rem 0.75rem' }}>
          <div className="backup-snapshot-actions">
            <button type="button" className="snapshot-deploy-button" onClick={() => void handleDeploy()} disabled={deploying}>
              {deploying
                ? <LoaderCircle size={14} className="snapshot-deploy-spinner" aria-hidden="true" />
                : <CloudUpload size={14} aria-hidden="true" />}
              {deploying ? t.snapshot.deploying : t.snapshot.deployRowButton}
            </button>
            <button type="button" className="snapshot-row-action" onClick={() => onRestore(snapshot.filename)} disabled={isRestoring}>
              {isRestoring ? t.backup.restoring : t.backup.rollback}
            </button>
            <button
              type="button"
              className="snapshot-row-action snapshot-row-action-danger"
              onClick={() => onDelete(snapshot.filename)}
              disabled={deletingFilename !== null}
            >
              {deletingFilename === snapshot.filename ? t.backup.deletingSnapshot : t.backup.deleteAction}
            </button>
          </div>
        </td>
      </tr>
      {deployment && (
        <tr className="snapshot-deploy-details-row">
          <td colSpan={4}>
            <div className={`snapshot-deploy-stepper${deployment.phase === 'failed' ? ' is-failed' : ''}`}>
              <div className="snapshot-deploy-stepper-header">
                <span className="snapshot-deploy-provider">Vercel</span>
                {deployment.phase === 'failed' ? (
                  <span className="snapshot-deploy-error-text" role="alert"><TriangleAlert size={14} aria-hidden="true" />{deployment.error}</span>
                ) : deployment.phase === 'complete' ? (
                  <span className="snapshot-deploy-complete-text" role="status"><CheckCircle2 size={14} aria-hidden="true" />{t.snapshot.deploySuccess}</span>
                ) : (
                  <span className="snapshot-deploy-current-phase" role="status">{t.snapshot.deployPhases[deployment.phase]}</span>
                )}
                {deployment.phase === 'complete' && deployment.deploymentUrl && (
                  <a className="snapshot-deploy-open" href={deployment.deploymentUrl} target="_blank" rel="noreferrer">{t.snapshot.deployOpen}</a>
                )}
              </div>
              {deployment.phase !== 'failed' && (
                <ol className="snapshot-deploy-steps" aria-label={t.snapshot.deployStepsLabel}>
                  {DEPLOYMENT_STEPS.map((step, index) => (
                    <li key={step} className={index < activeStep ? 'is-done' : index === activeStep ? 'is-active' : ''}>
                      <span className="snapshot-deploy-step-marker">{index < activeStep ? <Check size={11} aria-hidden="true" /> : index + 1}</span>
                      <span>{t.snapshot.deploySteps[step]}</span>
                    </li>
                  ))}
                </ol>
              )}
              {(deployment.phase === 'login' || deployment.phase === 'linking') && (
                <p className="snapshot-deploy-terminal-hint">{t.snapshot.deploySetupTerminalHint}</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

export interface BackupManagementPanelProps {
  onRestoreComplete?: () => void;
  isFullPage?: boolean;
}

export const BackupManagementPanel: React.FC<BackupManagementPanelProps> = ({
  onRestoreComplete,
  isFullPage = false
}) => {
  const { t, format } = useTranslation();

  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [backupDirectory, setBackupDirectory] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isOpeningSnapshotFolder, setIsOpeningSnapshotFolder] = useState(false);
  const [backupStatusMessage, setBackupStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isRestoring, setIsRestoring] = useState(false);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchDbStatus = async () => {
    try {
      {
        const data = await getDatabaseStatus();
        setDbStatus(data);
        if (data.settings) {
          setBackupDirectory(data.settings.backupDirectory || '');
        }
      }
    } catch { /* intentionally ignored: non-fatal */ }
  };


  useEffect(() => {
    fetchDbStatus();
  }, []);

  const handleDownloadSnapshot = () => {
    window.open('/api/database/download', '_blank');
  };

  const handleOpenSnapshotFolder = async () => {
    setIsOpeningSnapshotFolder(true);
    try {
      await openBackupFolder();
      setBackupStatusMessage(null);
    } catch (err) {
      setBackupStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : t.backup.folderSelectionFailed
      });
    } finally {
      setIsOpeningSnapshotFolder(false);
    }
  };


  const handleRestoreFromSnapshot = async (filename: string) => {
    if (!confirm(t.backup.restoreConfirm)) return;
    setIsRestoring(true);
    setRestoreMessage(null);
    try {
      const data = await restoreDatabaseSnapshot(filename);
      if (data.success) {
        setRestoreMessage({ type: 'success', text: format(t.backup.restoreSuccessWithCount, { count: data.activityCount ?? 0 }) });
        fetchDbStatus();
        if (onRestoreComplete) await onRestoreComplete();
      } else {
        setRestoreMessage({ type: 'error', text: t.backup.restoreFailed });
      }
    } catch (err) {
      setRestoreMessage({ type: 'error', text: apiErrorMessage(t, err, t.backup.restoreFailed) });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreFile = async (file: File) => {
    if (!confirm(t.backup.restoreConfirm)) return;
    setIsRestoring(true);
    setRestoreMessage(null);

    try {
      // Raw binary body: the server streams it to disk, so a large snapshot is no
      // longer rejected by the JSON body limit.
      const data = await restoreDatabase(file);
      if (data.status === 'ok') {
        setRestoreMessage({
          type: 'success',
          text: format(t.backup.restoreSuccessWithCount, { count: data.activityCount ?? 0 })
        });
        fetchDbStatus();
        if (onRestoreComplete) await onRestoreComplete();
      } else {
        setRestoreMessage({ type: 'error', text: t.backup.restoreFailed });
      }
    } catch (err) {
      setRestoreMessage({ type: 'error', text: apiErrorMessage(t, err, t.backup.restoreFailed) });
    } finally {
      setIsRestoring(false);
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
    }
  };

  const handleTriggerLocalBackup = async () => {
    setIsBackingUp(true);
    setBackupStatusMessage(null);
    try {
      await saveBackupSettings({ backupDirectory });
      const data = await backupDatabase(backupDirectory);
      if (data.status === 'ok') {
        setBackupStatusMessage({ type: 'success', text: t.backup.backupSuccess });
        fetchDbStatus();
      } else {
        setBackupStatusMessage({ type: 'error', text: t.backup.backupFailed });
      }
    } catch (err) {
      setBackupStatusMessage({ type: 'error', text: apiErrorMessage(t, err, t.backup.backupFailed) });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleSaveBackupSettings = async () => {
    try {
      await saveBackupSettings({ backupDirectory });
      setBackupStatusMessage({ type: 'success', text: t.backup.settingsSaved });
      fetchDbStatus();
    } catch (err) {
      setBackupStatusMessage({ type: 'error', text: apiErrorMessage(t, err, t.backup.backupFailed) });
    }
  };

  const handleDeleteSnapshot = async (filename: string) => {
    if (!window.confirm(format(t.backup.deleteSnapshotConfirm, { filename }))) return;
    setDeletingFilename(filename);
    setBackupStatusMessage(null);
    try {
      await deleteDatabaseSnapshot(filename);
      setBackupStatusMessage({ type: 'success', text: t.backup.deleteSnapshotSuccess });
      await fetchDbStatus();
    } catch (err) {
      setBackupStatusMessage({ type: 'error', text: apiErrorMessage(t, err, t.backup.deleteSnapshotFailed) });
    } finally {
      setDeletingFilename(null);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const data = await selectBackupFolder();
      if (data.folder) {
        setBackupDirectory(data.folder);
      }
    } catch (err) {
      setBackupStatusMessage({ type: 'error', text: apiErrorMessage(t, err, t.backup.folderSelectionFailed) });
    }
  };

  return (
    <div className="backup-management-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Global status messages */}
      {restoreMessage && (
        <div style={{
          padding: '0.75rem 1rem',
          borderRadius: 10,
          fontSize: '0.85rem',
          background: restoreMessage.type === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${restoreMessage.type === 'success' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
          color: restoreMessage.type === 'success' ? '#4ade80' : '#f87171',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          {restoreMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{restoreMessage.text}</span>
        </div>
      )}

      {/* Offline Snapshot & File Restore */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1.25rem' }}>
        {/* Column 1: Local Snapshot & File Restore */}
        <div style={{
          background: 'var(--bg-surface)',
          padding: '1.25rem',
          borderRadius: 12,
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '1rem'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
              <Download size={16} style={{ color: '#38bdf8' }} />
              <span>{t.backup.downloadSnapshot}</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, margin: '0 0 0.85rem' }}>
              {t.backup.downloadSnapshotDesc}
            </p>

            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--bg-card)', padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t.backup.dbSize}: </span>
                <strong style={{ color: '#38bdf8' }}>{dbStatus ? `${dbStatus.sizeMb} MB` : '—'}</strong>
              </div>
              <div style={{ background: 'var(--bg-card)', padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.78rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t.backup.totalRuns}: </span>
                <strong style={{ color: 'var(--accent-emerald)' }}>{dbStatus ? `${dbStatus.activityCount}` : '—'}</strong>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              id="modal-download-db-btn"
              onClick={handleDownloadSnapshot}
              style={{
                flex: '1 1 140px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                background: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                padding: '0.65rem 0.85rem',
                borderRadius: 8,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: '44px',
                whiteSpace: 'nowrap'
              }}
            >
              <Download size={14} />
              <span>{t.backup.downloadButton}</span>
            </button>

            <input
              type="file"
              ref={restoreFileInputRef}
              accept=".db,.sqlite"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleRestoreFile(file);
              }}
            />

            <button
              type="button"
              onClick={() => restoreFileInputRef.current?.click()}
              disabled={isRestoring}
              style={{
                flex: '1 1 140px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.45rem',
                background: 'rgba(168, 85, 247, 0.12)',
                color: '#c084fc',
                border: '1px solid rgba(168, 85, 247, 0.35)',
                padding: '0.65rem 0.85rem',
                borderRadius: 8,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: isRestoring ? 'wait' : 'pointer',
                minHeight: '44px',
                whiteSpace: 'nowrap'
              }}
            >
              <FileUp size={14} />
              <span>{isRestoring ? t.backup.restoring : t.backup.restoreFileButton}</span>
            </button>
          </div>
        </div>

      </div>


      {/* Manual Backup & Directory Configuration */}
      <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
          <FolderSync size={16} style={{ color: 'var(--accent-cyan)' }} />
          <span>{t.backup.manualBackupTitle}</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, margin: '0 0 1rem' }}>
          {t.backup.manualBackupDesc}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={backupDirectory}
              onChange={e => setBackupDirectory(e.target.value)}
              placeholder="e.g. C:\Users\YourName\Dropbox\AEROLAB_Backups"
              style={{
                flex: '1 1 240px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                padding: '0.5rem 0.75rem',
                fontSize: '0.8rem',
                color: 'var(--text-primary)'
              }}
            />
            <button
              type="button"
              onClick={handleSelectDirectory}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                borderRadius: 6,
                padding: '0.5rem 0.85rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {t.backup.selectFolder}
            </button>
            <button
              type="button"
              onClick={handleSaveBackupSettings}
              style={{
                background: 'rgba(6, 182, 212, 0.15)',
                color: 'var(--accent-cyan)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                borderRadius: 6,
                padding: '0.5rem 1rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <Check size={13} />
              <span>{t.backup.saveSettings}</span>
            </button>
            <button
              type="button"
              id="modal-backup-now-btn"
              onClick={handleTriggerLocalBackup}
              disabled={isBackingUp}
              style={{
                background: 'var(--accent-cyan)',
                color: '#07090e',
                border: 'none',
                borderRadius: 6,
                padding: '0.5rem 1rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: isBackingUp ? 'wait' : 'pointer'
              }}
            >
              {isBackingUp ? t.backup.backingUp : (t.backup.backupNowButton || 'Backup Now to Folder')}
            </button>
          </div>

          {backupStatusMessage && (
            <div style={{
              padding: '0.45rem 0.75rem',
              borderRadius: 6,
              fontSize: '0.75rem',
              background: backupStatusMessage.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: backupStatusMessage.type === 'success' ? '#4ade80' : '#f87171'
            }}>
              {backupStatusMessage.text}
            </div>
          )}
        </div>
      </div>

      {/* Snapshot History Table */}
      <div className="backup-snapshot-section" style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
        <div className="backup-snapshot-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t.backup.localSnapshots || 'Local Snapshots & Rollback'}</span>
            {t.backup.retentionPolicy ? (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({t.backup.retentionPolicy})</span>
            ) : null}
          </div>
          <div className="backup-snapshot-header-actions">
            <button type="button" className="backup-open-folder-button" onClick={() => void handleOpenSnapshotFolder()} disabled={isOpeningSnapshotFolder}>
              <FolderOpen size={13} />
              <span>{t.backup.openFolderAction}</span>
            </button>
            <button type="button" className="backup-refresh-button" onClick={fetchDbStatus}>
              <RefreshCw size={12} />
              <span>{t.backup.refreshAction}</span>
            </button>
          </div>
        </div>

        {(() => {
          const snapshots = dbStatus?.snapshots || dbStatus?.recentBackups || [];
          if (snapshots.length === 0) {
            return (
              <div style={{
                padding: '2rem 1.5rem',
                textAlign: 'center',
                background: 'var(--bg-card)',
                borderRadius: 8,
                border: '1px dashed var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.6rem'
              }}>
                <HardDrive size={24} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600 }}>
                  {t.backup.noSnapshots || 'No local database snapshots found. Click "Backup Now to Folder" above to create one.'}
                </div>
              </div>
            );
          }

          return (
            <div className="backup-snapshot-table-wrap" style={{ maxHeight: isFullPage ? '400px' : '220px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              <table className="backup-snapshot-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                    <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{t.backup.tableSnapshotName || 'Snapshot File'}</th>
                    <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{t.backup.tableCreated || 'Created At'}</th>
                    <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{t.backup.tableSize || 'Size'}</th>
                    <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>{t.backup.tableAction || 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((snapshot: DatabaseSnapshot) => (
                    <SnapshotHistoryRow
                      key={snapshot.filename}
                      snapshot={snapshot}
                      isRestoring={isRestoring}
                      deletingFilename={deletingFilename}
                      onRestore={filename => void handleRestoreFromSnapshot(filename)}
                      onDelete={filename => void handleDeleteSnapshot(filename)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
