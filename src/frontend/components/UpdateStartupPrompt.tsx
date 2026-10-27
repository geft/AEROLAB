import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, X } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { apiErrorMessage } from '../api/errors.js';
import { applyUpdate, checkForUpdate, getUpdateStatus } from '../api/client.js';
import type { UpdateStatus } from '../types/api.js';

const AUTO_INSTALL_SECONDS = 10;

/**
 * Startup update prompt for the packaged desktop app.
 *
 * When "check on startup" is enabled the backend is asked for the newest
 * release once per launch. A newer build is installed automatically after a
 * short countdown so a slow or broken release still leaves time to choose
 * "Later"; the manual check in Settings stays available either way.
 */
export const UpdateStartupPrompt: React.FC = () => {
  const { t, format } = useTranslation();
  const [pending, setPending] = useState<UpdateStatus | null>(null);
  const [applying, setApplying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [seconds, setSeconds] = useState(AUTO_INSTALL_SECONDS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const initial = await getUpdateStatus();
        if (!active || !initial.autoCheck || !initial.canInstall) return;
        const checked = await checkForUpdate(false);
        if (!active || !checked.updateAvailable) return;
        setPending(checked);
      } catch {
        // A silent failure here is intentional: Settings reports check errors on demand.
      }
    };
    void run();
    return () => { active = false; };
  }, []);

  const install = useCallback(async () => {
    setApplying(true);
    setError(null);
    try {
      await applyUpdate();
    } catch (err) {
      setError(apiErrorMessage(t, err, t.updates.startupError));
      setApplying(false);
    }
  }, [t]);

  useEffect(() => {
    if (!pending || applying || dismissed || error) return;
    let remaining = AUTO_INSTALL_SECONDS;
    const timer = setInterval(() => {
      remaining -= 1;
      setSeconds(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(timer);
        void install();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [pending, applying, dismissed, error, install]);

  if (!pending || dismissed) return null;

  const version = pending.release?.version ?? pending.latestVersion ?? pending.currentVersion;
  const description = applying
    ? format(t.updates.startupInstalling, { version })
    : format(t.updates.startupDescription, { seconds });

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        right: '1.25rem',
        bottom: '1.25rem',
        zIndex: 1000,
        width: 'min(430px, calc(100vw - 2.5rem))',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
        boxShadow: '0 18px 40px rgba(2, 6, 23, 0.45)',
        padding: '1rem 1.1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Download size={17} style={{ color: 'var(--accent-cyan)' }} />
        <strong style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
          {format(t.updates.startupTitle, { version })}
        </strong>
        {!applying ? (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t.updates.updateLater}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 }}
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{description}</p>

      {error ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: '#f87171' }}>
          <AlertCircle size={14} /> {error}
        </span>
      ) : null}

      {!applying ? (
        <div style={{ display: 'flex', gap: '0.55rem', justifyContent: 'flex-end' }}>
          <button type="button" className="garmin-folder-action" onClick={() => setDismissed(true)}>
            {t.updates.updateLater}
          </button>
          <button type="button" className="garmin-folder-action" onClick={() => void install()}>
            <Download size={15} /> {t.updates.updateNow}
          </button>
        </div>
      ) : null}
    </div>
  );
};
