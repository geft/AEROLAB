import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { apiErrorMessage } from '../api/errors.js';
import { applyUpdate, checkForUpdate, getUpdateStatus, saveUpdateSettings } from '../api/client.js';
import { AEROLAB_RELEASES_URL } from '../../shared/update.js';
import type { UpdateStatus } from '../types/api.js';

type BusyState = 'idle' | 'checking' | 'installing';

/**
 * Settings card for the desktop updater: shows the running version, checks
 * GitHub Releases on demand, and toggles the startup auto-install preference.
 */
export const UpdatePanel: React.FC = () => {
  const { t, format, formatDate } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState<BusyState>('idle');
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    getUpdateStatus()
      .then(data => {
        if (mounted) setStatus(data);
      })
      .catch(err => {
        if (mounted) setMessage({ error: true, text: apiErrorMessage(t, err, t.updates.checkFailed) });
      });
    return () => { mounted = false; };
  }, [t]);

  const handleCheck = async () => {
    setBusy('checking');
    setMessage(null);
    try {
      const next = await checkForUpdate(true);
      setStatus(next);
      if (!next.updateAvailable) setMessage({ error: false, text: t.updates.upToDate });
    } catch (err) {
      setMessage({ error: true, text: apiErrorMessage(t, err, t.updates.checkFailed) });
    } finally {
      setBusy('idle');
    }
  };

  const handleAutoCheck = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const autoCheck = event.target.checked;
    setStatus(previous => previous ? { ...previous, autoCheck } : previous);
    setMessage(null);
    try {
      const saved = await saveUpdateSettings({ autoCheck });
      setStatus(previous => previous ? { ...previous, autoCheck: saved.autoCheck } : previous);
    } catch (err) {
      setStatus(previous => previous ? { ...previous, autoCheck: !autoCheck } : previous);
      setMessage({ error: true, text: apiErrorMessage(t, err, t.updates.autoCheckFailed) });
    }
  };

  const handleInstall = async () => {
    setBusy('installing');
    setMessage(null);
    try {
      const scheduled = await applyUpdate();
      setMessage({ error: false, text: format(t.updates.installStarted, { version: scheduled.version }) });
    } catch (err) {
      setMessage({ error: true, text: apiErrorMessage(t, err, t.updates.installFailed) });
      setBusy('idle');
    }
  };

  const release = status?.release ?? null;
  const showAvailable = Boolean(status?.updateAvailable && release);

  return (
    <section className="overview-card" style={{ padding: '1.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
        <Download size={20} style={{ color: 'var(--accent-cyan)' }} />
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t.updates.title}
        </h2>
      </div>
      <p style={{ margin: '0 0 1.1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        {t.updates.description}
      </p>

      <div
        role="status"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          padding: '0.85rem 1rem',
          marginBottom: '1.1rem',
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          fontSize: '0.82rem',
          color: 'var(--text-primary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 650 }}>
          <Download size={16} style={{ color: 'var(--accent-cyan)' }} />
          <span>{format(t.updates.currentVersion, { version: status ? status.currentVersion : t.common.loading })}</span>
        </div>
        {status && status.currentCommit ? (
          <span style={{ color: 'var(--text-secondary)' }}>
            {format(t.updates.currentBuild, { commit: status.currentCommit })}
          </span>
        ) : null}
        {showAvailable && release ? (
          <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
            {format(t.updates.availableTitle, { version: release.version })}
          </span>
        ) : null}
        {showAvailable && release && release.publishedAt ? (
          <span style={{ color: 'var(--text-secondary)' }}>
            {format(t.updates.publishedOn, { date: formatDate(release.publishedAt, { dateStyle: 'medium' }) })}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          className="garmin-folder-action"
          onClick={handleCheck}
          disabled={busy !== 'idle'}
        >
          <RefreshCw size={15} /> {busy === 'checking' ? t.updates.checking : t.updates.checkAction}
        </button>
        {showAvailable && status?.canInstall ? (
          <button
            type="button"
            className="garmin-folder-action"
            onClick={handleInstall}
            disabled={busy !== 'idle'}
          >
            <Download size={15} /> {busy === 'installing' ? t.updates.installing : t.updates.installAction}
          </button>
        ) : null}
        <a
          className="garmin-sync-link"
          href={AEROLAB_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} /> {t.updates.openReleases}
        </a>
      </div>

      {busy === 'installing' ? (
        <p style={{ margin: '0.65rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          {t.updates.installingHint}
        </p>
      ) : null}
      {status && !status.canInstall ? (
        <p style={{ margin: '0.65rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          {t.updates.manualOnly}
        </p>
      ) : null}

      <label
        htmlFor="update-auto-check"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.6rem',
          margin: '1.1rem 0 0',
          cursor: status === null || busy !== 'idle' ? 'default' : 'pointer'
        }}
      >
        <input
          id="update-auto-check"
          type="checkbox"
          checked={status ? status.autoCheck : false}
          disabled={status === null || busy !== 'idle'}
          onChange={handleAutoCheck}
          style={{ marginTop: '0.15rem' }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 650, color: 'var(--text-primary)' }}>
            {t.updates.autoCheckLabel}
          </span>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            {t.updates.autoCheckHint}
          </span>
        </span>
      </label>

      {message ? (
        <div
          role="status"
          style={{
            marginTop: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            fontSize: '0.8rem',
            color: message.error ? '#f87171' : '#4ade80'
          }}
        >
          {message.error ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          <span>{message.text}</span>
        </div>
      ) : null}
    </section>
  );
};
