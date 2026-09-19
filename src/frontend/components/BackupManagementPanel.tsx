import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive, Download, FileUp, UploadCloud, RefreshCw,
  CheckCircle2, AlertCircle, LogOut, FolderSync, Check
} from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';

export interface BackupManagementPanelProps {
  onRestoreComplete?: () => void;
  isFullPage?: boolean;
}

export const BackupManagementPanel: React.FC<BackupManagementPanelProps> = ({
  onRestoreComplete,
  isFullPage = false
}) => {
  const { t } = useTranslation();

  const [dbStatus, setDbStatus] = useState<any>(null);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);
  const [backupDirectory, setBackupDirectory] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupStatusMessage, setBackupStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Google Auth & Cloud Sync state
  const [googleStatus, setGoogleStatus] = useState<any>(null);
  const [isSyncingGdrive, setIsSyncingGdrive] = useState(false);
  const [gdriveStatusMessage, setGdriveStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [gdriveBackups, setGdriveBackups] = useState<any[]>([]);
  const [showGdriveRestoreList, setShowGdriveRestoreList] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchDbStatus = async () => {
    try {
      const res = await fetch('/api/database/status');
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data);
        if (data.settings) {
          setAutoBackupEnabled(Boolean(data.settings.autoBackupEnabled));
          setBackupDirectory(data.settings.backupDirectory || '');
        }
        if (data.googleStatus) {
          setGoogleStatus(data.googleStatus);
        }
      }
    } catch {}
  };

  const fetchGoogleStatus = async () => {
    try {
      const res = await fetch('/api/auth/google/status');
      if (res.ok) {
        const data = await res.json();
        setGoogleStatus(data.status);
      }
    } catch {}
  };

  useEffect(() => {
    fetchDbStatus();
    fetchGoogleStatus();
  }, []);

  const handleDownloadSnapshot = () => {
    window.open('/api/database/download', '_blank');
  };

  const handleGoogleConnect = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setGdriveStatusMessage({ type: 'error', text: data.error || 'Failed to initiate Google OAuth.' });
        return;
      }
      const data = await res.json();
      if (data.url) {
        const popup = window.open(data.url, 'google_oauth_popup', 'width=540,height=650');
        const handleMessage = (e: MessageEvent) => {
          if (e.data?.type === 'AEROLAB_GOOGLE_AUTH_SUCCESS') {
            window.removeEventListener('message', handleMessage);
            popup?.close();
            fetchGoogleStatus();
            setGdriveStatusMessage({ type: 'success', text: t.backup.googleConnected });
          }
        };
        window.addEventListener('message', handleMessage);
      }
    } catch {
      setGdriveStatusMessage({ type: 'error', text: 'Network error connecting to Google Auth.' });
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      const res = await fetch('/api/auth/google/disconnect', { method: 'POST' });
      if (res.ok) {
        fetchGoogleStatus();
        setGdriveStatusMessage({ type: 'success', text: t.backup.googleDisconnected });
        setGdriveBackups([]);
        setShowGdriveRestoreList(false);
      }
    } catch {}
  };

  const handleSyncToGoogleDrive = async () => {
    setIsSyncingGdrive(true);
    setGdriveStatusMessage(null);
    try {
      const res = await fetch('/api/backup/google/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setGdriveStatusMessage({ type: 'success', text: `${t.backup.syncSuccess} (${data.fileName})` });
        fetchGoogleStatus();
      } else {
        setGdriveStatusMessage({ type: 'error', text: data.error || t.backup.syncFailed });
      }
    } catch {
      setGdriveStatusMessage({ type: 'error', text: t.backup.syncFailed });
    } finally {
      setIsSyncingGdrive(false);
    }
  };

  const handleFetchGdriveBackups = async () => {
    try {
      const res = await fetch('/api/backup/google/list');
      if (res.ok) {
        const data = await res.json();
        setGdriveBackups(data.files || []);
        setShowGdriveRestoreList(true);
      }
    } catch {}
  };

  const handleRestoreFromGoogleDrive = async (fileId: string) => {
    if (!confirm(t.backup.restoreConfirm)) return;
    setIsRestoring(true);
    setRestoreMessage(null);
    try {
      const res = await fetch('/api/backup/google/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRestoreMessage({ type: 'success', text: `${t.backup.restoreSuccess} (${data.activityCount} activities restored)` });
        fetchDbStatus();
        if (onRestoreComplete) onRestoreComplete();
      } else {
        setRestoreMessage({ type: 'error', text: data.error || t.backup.restoreFailed });
      }
    } catch {
      setRestoreMessage({ type: 'error', text: t.backup.restoreFailed });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreFromSnapshot = async (filename: string) => {
    if (!confirm(t.backup.restoreConfirm)) return;
    setIsRestoring(true);
    setRestoreMessage(null);
    try {
      const res = await fetch('/api/database/restore-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRestoreMessage({ type: 'success', text: `${t.backup.restoreSuccess} (${data.activityCount} activities restored)` });
        fetchDbStatus();
        if (onRestoreComplete) onRestoreComplete();
      } else {
        setRestoreMessage({ type: 'error', text: data.error || t.backup.restoreFailed });
      }
    } catch {
      setRestoreMessage({ type: 'error', text: t.backup.restoreFailed });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleRestoreFile = async (file: File) => {
    if (!confirm(t.backup.restoreConfirm)) return;
    setIsRestoring(true);
    setRestoreMessage(null);
    const formData = new FormData();
    formData.append('database', file);

    try {
      const res = await fetch('/api/database/restore', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRestoreMessage({ type: 'success', text: `${t.backup.restoreSuccess} (${data.activityCount} activities restored & realigned)` });
        fetchDbStatus();
        if (onRestoreComplete) onRestoreComplete();
      } else {
        setRestoreMessage({ type: 'error', text: data.error || t.backup.restoreFailed });
      }
    } catch {
      setRestoreMessage({ type: 'error', text: t.backup.restoreFailed });
    } finally {
      setIsRestoring(false);
      if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
    }
  };

  const handleTriggerLocalBackup = async () => {
    setIsBackingUp(true);
    setBackupStatusMessage(null);
    try {
      const res = await fetch('/api/database/backup', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setBackupStatusMessage({ type: 'success', text: t.backup.backupSuccess });
        fetchDbStatus();
      } else {
        setBackupStatusMessage({ type: 'error', text: data.error || t.backup.backupFailed });
      }
    } catch {
      setBackupStatusMessage({ type: 'error', text: t.backup.backupFailed });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleSaveBackupSettings = async () => {
    try {
      const res = await fetch('/api/database/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoBackupEnabled, backupDirectory })
      });
      if (res.ok) {
        setBackupStatusMessage({ type: 'success', text: t.backup.settingsSaved });
        fetchDbStatus();
      }
    } catch {
      setBackupStatusMessage({ type: 'error', text: 'Failed to save backup settings.' });
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const res = await fetch('/api/database/select-folder', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.folder) {
        setBackupDirectory(data.folder);
      }
    } catch {}
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

      {/* Top 2-Column Grid: Offline Snapshot & Google Drive */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
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
                minHeight: '38px',
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
                minHeight: '38px',
                whiteSpace: 'nowrap'
              }}
            >
              <FileUp size={14} />
              <span>{isRestoring ? t.backup.restoring : t.backup.restoreFileButton}</span>
            </button>
          </div>
        </div>

        {/* Column 2: Google Drive Cloud Sync */}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                <UploadCloud size={16} style={{ color: 'var(--accent-emerald)' }} />
                <span>{t.backup.googleTitle}</span>
              </div>
              {googleStatus?.isConnected && (
                <button
                  type="button"
                  onClick={handleGoogleDisconnect}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '0.72rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                >
                  <LogOut size={12} />
                  <span>{t.backup.disconnect}</span>
                </button>
              )}
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, margin: '0 0 0.85rem' }}>
              {t.backup.googleDesc}
            </p>

            {googleStatus?.isConnected ? (
              <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  {googleStatus.picture ? (
                    <img src={googleStatus.picture} alt="Avatar" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', fontSize: '0.75rem', fontWeight: 700 }}>
                      {googleStatus.name ? googleStatus.name[0] : 'G'}
                    </div>
                  )}
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {googleStatus.email}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <CheckCircle2 size={11} />
                      <span>Connected to Google Drive</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGoogleConnect}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.6rem',
                  background: '#ffffff',
                  color: '#1f2937',
                  border: '1px solid #d1d5db',
                  padding: '0.65rem',
                  borderRadius: 8,
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginBottom: '0.75rem'
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>{t.backup.connectGoogle}</span>
              </button>
            )}

            {gdriveStatusMessage && (
              <div style={{
                padding: '0.45rem 0.65rem',
                borderRadius: 6,
                fontSize: '0.72rem',
                background: gdriveStatusMessage.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: gdriveStatusMessage.type === 'success' ? '#4ade80' : '#f87171',
                marginBottom: '0.5rem'
              }}>
                {gdriveStatusMessage.text}
              </div>
            )}
          </div>

          {googleStatus?.isConnected && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleSyncToGoogleDrive}
                disabled={isSyncingGdrive}
                style={{
                  flex: '1 1 140px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: 'var(--accent-emerald)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '0.55rem',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: isSyncingGdrive ? 'wait' : 'pointer'
                }}
              >
                <RefreshCw size={13} className={isSyncingGdrive ? 'spin' : ''} />
                <span>{isSyncingGdrive ? t.backup.syncing : t.backup.syncButton}</span>
              </button>

              <button
                type="button"
                onClick={handleFetchGdriveBackups}
                style={{
                  flex: '1 1 140px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  background: 'var(--bg-card)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  padding: '0.55rem',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Download size={13} />
                <span>{t.backup.restoreFromCloud}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cloud Backups Restore List */}
      {showGdriveRestoreList && (
        <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Available Google Drive Snapshots</span>
            <button type="button" onClick={() => setShowGdriveRestoreList(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem' }}>Hide</button>
          </div>
          {gdriveBackups.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No backups found in Google Drive yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {gdriveBackups.map(file => (
                <div key={file.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.78rem' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{file.name}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({new Date(file.createdTime).toLocaleString()})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestoreFromGoogleDrive(file.id)}
                    disabled={isRestoring}
                    style={{
                      background: 'rgba(6, 182, 212, 0.15)',
                      color: 'var(--accent-cyan)',
                      border: '1px solid rgba(6, 182, 212, 0.3)',
                      padding: '0.25rem 0.6rem',
                      borderRadius: 4,
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: isRestoring ? 'wait' : 'pointer'
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Auto-Backup & Directory Configuration */}
      <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
          <FolderSync size={16} style={{ color: 'var(--accent-cyan)' }} />
          <span>{t.backup.autoBackupTitle}</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, margin: '0 0 1rem' }}>
          {t.backup.autoBackupDesc}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoBackupEnabled}
              onChange={e => setAutoBackupEnabled(e.target.checked)}
              style={{ accentColor: 'var(--accent-cyan)' }}
            />
            <span>{t.backup.enableAutoBackup}</span>
          </label>

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
      <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t.backup.localSnapshots}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>({t.backup.retentionPolicy})</span>
          </div>
          <button type="button" onClick={fetchDbStatus} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}>
            <RefreshCw size={12} />
            <span>Refresh</span>
          </button>
        </div>

        {(!dbStatus?.snapshots || dbStatus.snapshots.length === 0) ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            {t.backup.noSnapshots}
          </div>
        ) : (
          <div style={{ maxHeight: isFullPage ? '400px' : '220px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{t.backup.tableSnapshotName}</th>
                  <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{t.backup.tableCreated}</th>
                  <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{t.backup.tableSize}</th>
                  <th style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>{t.backup.tableAction}</th>
                </tr>
              </thead>
              <tbody>
                {dbStatus.snapshots.map((s: any) => (
                  <tr key={s.filename} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{s.filename}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{new Date(s.createdAt).toLocaleString()}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)' }}>{s.sizeMb} MB</td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() => handleRestoreFromSnapshot(s.filename)}
                          disabled={isRestoring}
                          style={{
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#f87171',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 4,
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: isRestoring ? 'wait' : 'pointer'
                          }}
                        >
                          {t.backup.rollback}
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(`/api/database/download?filename=${encodeURIComponent(s.filename)}`, '_blank')}
                          style={{
                            background: 'var(--bg-card)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 4,
                            padding: '0.2rem 0.5rem',
                            fontSize: '0.72rem',
                            cursor: 'pointer'
                          }}
                        >
                          {t.backup.downloadAction}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
