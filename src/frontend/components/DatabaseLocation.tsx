import React, { useEffect, useState } from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import type { DatabaseStatus, MaintenanceStatus } from '../types/api.js';
import { ApiRequestError, chooseDatabaseLocation, getDatabaseStatus, getMaintenanceStatus, setDatabaseLocation } from '../api/client.js';

export const DatabaseLocation: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [selected, setSelected] = useState<{ path: string; exists: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus['status']>('idle');

  useEffect(() => {
    void getDatabaseStatus()
      .then((data: DatabaseStatus) => setStatus(data))
      .catch(() => setMessage({ error: true, text: t.databaseLocation.statusFailed }));
  }, [t.databaseLocation.statusFailed]);

  useEffect(() => {
    const refresh = () => { void getMaintenanceStatus().then(data => setMaintenance(data.status)).catch(() => {}); };
    refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => window.clearInterval(interval);
  }, []);

  const choose = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await chooseDatabaseLocation();
      if (data.databasePath) setSelected({ path: data.databasePath, exists: Boolean(data.exists) });
    } catch {
      setMessage({ error: true, text: t.databaseLocation.selectFailed });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!selected || !window.confirm(selected.exists ? t.databaseLocation.confirmExisting : t.databaseLocation.confirmCopy)) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await setDatabaseLocation(selected.path, selected.exists);
      setStatus(current => current ? { ...current, startupDbPath: data.databasePath } : current);
      setSelected(null);
      setMessage({ error: false, text: t.databaseLocation.restartNeeded });
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : '';
      const translated = code === 'LOCATION_CHANGED' ? t.databaseLocation.locationChanged
        : code === 'DATABASE_PATH_OVERRIDE' ? t.databaseLocation.overrideActive
        : code === 'INVALID_DATABASE' ? t.databaseLocation.invalidDatabase
        : code === 'INVALID_FOLDER' ? t.databaseLocation.invalidFolder
        : t.databaseLocation.syncFailed;
      setMessage({ error: true, text: translated });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overview-card" style={{ padding: '1.75rem' }}>
      <h2 style={{ margin: '0 0 0.4rem', fontSize: '1.15rem' }}>{t.databaseLocation.title}</h2>
      <p style={{ margin: '0 0 1rem', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>{t.databaseLocation.description}</p>
      <div style={{ fontSize: '0.8rem', overflowWrap: 'anywhere', marginBottom: '0.5rem' }}>
        <strong>{t.databaseLocation.current}:</strong> {status?.dbPath || t.databaseLocation.loading}
      </div>
      {status?.startupDbPath && status.startupDbPath !== status.dbPath && (
        <div style={{ fontSize: '0.8rem', overflowWrap: 'anywhere', marginBottom: '0.75rem' }}>
          <strong>{t.databaseLocation.nextStart}:</strong> {status.startupDbPath}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <button className="shared-db-action" type="button" disabled={busy} onClick={() => void choose()}>
          <Database size={14} /> {t.databaseLocation.chooseFile}
        </button>
        <span style={{ fontSize: '0.78rem', overflowWrap: 'anywhere' }}>{selected?.path}</span>
        <button className="shared-db-action shared-db-primary" type="button" disabled={busy || !selected} onClick={() => void save()}>
          <RefreshCw size={14} /> {selected?.exists ? t.databaseLocation.useExisting : t.databaseLocation.copyHere}
        </button>
      </div>
      <p style={{ margin: '0.75rem 0 0', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
        {selected ? selected.exists ? t.databaseLocation.existingHint : t.databaseLocation.newHint : t.databaseLocation.pickerHint}
      </p>
      {message && <p role="status" style={{ color: message.error ? '#f87171' : '#4ade80', fontSize: '0.8rem' }}>{message.text}</p>}
      {maintenance === 'running' && <p role="status" style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{t.databaseLocation.maintenanceRunning}</p>}
      {(maintenance === 'failed' || maintenance === 'interrupted') && <p role="status" style={{ color: '#f87171', fontSize: '0.8rem' }}>{t.databaseLocation.maintenanceFailed}</p>}
    </section>
  );
};
