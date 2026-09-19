import React, { useState, useEffect, useRef } from 'react';
import {
  HardDrive, Download, FileUp, UploadCloud, RefreshCw,
  CheckCircle2, AlertCircle, LogOut, X, FolderSync, Check
} from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreComplete?: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  onRestoreComplete
}) => {
  const { t, language } = useTranslation();

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
    if (isOpen) {
      fetchDbStatus();
      fetchGoogleStatus();
      setBackupStatusMessage(null);
      setGdriveStatusMessage(null);
      setRestoreMessage(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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

  const handleRestoreFromGdrive = async (fileId: string, fileName: string) => {
    const confirmMsg = language === 'zh'
      ? `确定要从云端备份 "${fileName}" 恢复数据库吗？当前未备份的活动可能会被覆盖。`
      : `Are you sure you want to restore from "${fileName}"? Unsaved activities will be replaced.`;
    if (!window.confirm(confirmMsg)) return;

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
        setRestoreMessage({ type: 'success', text: `${t.backup.restoreSuccess} (${data.activityCount} activities)` });
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
    const confirmMsg = language === 'zh'
      ? `确定要从本地文件 "${file.name}" 恢复数据库吗？恢复将自动校验并对齐所有活动与阈值指标。`
      : `Are you sure you want to restore from "${file.name}"? This will validate and realign all activities and physiological thresholds.`;
    if (!window.confirm(confirmMsg)) return;

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

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
    >
      <div
        className="overview-card"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          padding: '1.75rem',
          maxWidth: 720,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
          position: 'relative'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'rgba(6, 182, 212, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-cyan)'
            }}>
              <HardDrive size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.backup.cardTitle}
              </h2>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {t.backup.cardSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Global status messages */}
        {restoreMessage && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.65rem 1rem',
            borderRadius: 8,
            fontSize: '0.82rem',
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                <Download size={16} style={{ color: '#38bdf8' }} />
                <span>{t.backup.downloadSnapshot}</span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45, margin: '0 0 0.85rem' }}>
                {t.backup.downloadSnapshotDesc}
              </p>

              <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <div style={{ background: 'var(--bg-card)', padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{t.backup.dbSize}: </span>
                  <strong style={{ color: '#38bdf8' }}>{dbStatus ? `${dbStatus.sizeMb} MB` : '—'}</strong>
                </div>
                <div style={{ background: 'var(--bg-card)', padding: '0.45rem 0.75rem', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: '0.75rem' }}>
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
                  fontSize: '0.8rem',
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
                  fontSize: '0.8rem',
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
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
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45, margin: '0 0 0.85rem' }}>
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
                    fontSize: '0.8rem',
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
                    fontSize: '0.78rem',
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
                    fontSize: '0.78rem',
                    cursor: 'pointer'
                  }}
                >
                  <FolderSync size={13} />
                  <span>{t.backup.viewCloudBackups}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Cloud backup restore list */}
        {showGdriveRestoreList && gdriveBackups.length > 0 && (
          <div style={{ marginTop: '1.25rem', background: 'var(--bg-surface)', padding: '1rem', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.backup.availableBackups} ({gdriveBackups.length})
              </span>
              <button
                type="button"
                onClick={() => setShowGdriveRestoreList(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}
              >
                {t.common.close}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 160, overflowY: 'auto' }}>
              {gdriveBackups.map(b => (
                <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-card)', padding: '0.45rem 0.75rem', borderRadius: 6, fontSize: '0.75rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{b.name}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.7rem' }}>
                      {new Date(b.createdTime).toLocaleDateString()} ({Math.round(b.size / 1024)} KB)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestoreFromGdrive(b.id, b.name)}
                    disabled={isRestoring}
                    style={{
                      background: 'rgba(56, 189, 248, 0.1)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: 4,
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Local Automatic Backup Schedule */}
        <div style={{ marginTop: '1.25rem', background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <FolderSync size={16} style={{ color: 'var(--accent-cyan)' }} />
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{t.backup.autoBackup}</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={autoBackupEnabled}
                onChange={e => setAutoBackupEnabled(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>{t.backup.enableAutoBackup}</span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <input
              type="text"
              value={backupDirectory}
              onChange={e => setBackupDirectory(e.target.value)}
              placeholder="e.g. C:\Users\YourName\Documents\AEROLAB_Backups"
              style={{
                flex: 1,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: '0.5rem 0.75rem',
                fontSize: '0.78rem',
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
                borderRadius: 8,
                padding: '0.5rem 0.75rem',
                fontSize: '0.78rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {t.backup.selectFolder}
            </button>
            <button
              type="button"
              onClick={handleSaveBackupSettings}
              style={{
                background: '#38bdf8',
                border: 'none',
                color: '#0f172a',
                borderRadius: 8,
                padding: '0.5rem 0.85rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {t.common.save}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {t.backup.lastBackup}: {dbStatus?.settings?.lastBackupAt ? new Date(dbStatus.settings.lastBackupAt).toLocaleString() : 'Never'}
            </span>
            <button
              type="button"
              id="modal-trigger-backup-btn"
              onClick={handleTriggerLocalBackup}
              disabled={isBackingUp}
              style={{
                background: 'rgba(6, 182, 212, 0.12)',
                color: 'var(--accent-cyan)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                padding: '0.4rem 0.85rem',
                borderRadius: 6,
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: isBackingUp ? 'wait' : 'pointer'
              }}
            >
              {isBackingUp ? t.backup.backingUp : t.backup.backupNowButton}
            </button>
          </div>

          {backupStatusMessage && (
            <div style={{
              marginTop: '0.65rem',
              padding: '0.45rem 0.65rem',
              borderRadius: 6,
              fontSize: '0.72rem',
              background: backupStatusMessage.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: backupStatusMessage.type === 'success' ? '#4ade80' : '#f87171'
            }}>
              {backupStatusMessage.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
