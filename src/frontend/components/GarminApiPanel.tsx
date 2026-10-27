import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { apiErrorMessage } from '../api/errors.js';
import { deleteGarminApiKey, getGarminKeyStatus, saveGarminApiKey } from '../api/client.js';
import { GARMIN_API_KEY_ENV, GARMIN_API_KEY_EXPIRY_ENV, GARMIN_PERSONAL_API_KEY_URL } from '../../shared/garmin.js';
import type { GarminKeyStatus } from '../types/api.js';

/** `YYYY-MM-DD` in the viewer's own timezone, for `<input type="date">`. */
function toDateInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const GarminApiPanel: React.FC = () => {
  const { t, format, formatDate } = useTranslation();
  const [status, setStatus] = useState<GarminKeyStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    getGarminKeyStatus()
      .then(data => {
        if (!mounted) return;
        const key = data?.key ?? null;
        setStatus(key);
        setExpiry(toDateInput(key?.expiresAt ?? null));
      })
      .catch(err => {
        if (mounted) setMessage({ type: 'error', text: apiErrorMessage(t, err, t.garminSync.syncFailed) });
      });
    return () => { mounted = false; };
  }, [t]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const expiryOnly = !apiKey.trim();
    setBusy(true);
    setMessage(null);
    try {
      const data = await saveGarminApiKey(apiKey.trim(), expiry || null);
      const key = data?.key ?? null;
      setStatus(key);
      setExpiry(toDateInput(key?.expiresAt ?? null));
      setApiKey('');
      setMessage({ type: 'success', text: expiryOnly ? t.garminSync.expirySaved : t.garminSync.keySaved });
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(t, err, t.garminSync.syncFailed) });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await deleteGarminApiKey();
      setStatus(data?.key ?? null);
      setExpiry('');
      setMessage({ type: 'success', text: t.garminSync.keyRemoved });
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(t, err, t.garminSync.syncFailed) });
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = status?.source === 'environment'
    ? format(t.garminSync.sourceEnvironment, { env: GARMIN_API_KEY_ENV })
    : status?.encrypted
      ? t.garminSync.sourceStoredEncrypted
      : t.garminSync.sourceStored;
  const expiryFromEnvironment = status?.expirySource === 'environment';
  const expiryLabel = status?.expiresAt
    ? [
      format(t.garminSync.expiresOn, { date: formatDate(status.expiresAt, { dateStyle: 'medium' }) }),
      status.daysUntilExpiry !== null ? format(t.garminSync.daysLeft, { days: status.daysUntilExpiry }) : ''
    ].filter(Boolean).join(' · ')
    : t.garminSync.noExpiry;
  const warningDate = status?.expiresAt ? formatDate(status.expiresAt, { dateStyle: 'medium' }) : '';

  return (
    <section className="overview-card" style={{ padding: '1.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
        <KeyRound size={20} style={{ color: 'var(--accent-cyan)' }} />
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t.garminSync.settingsTitle}
        </h2>
      </div>
      <p style={{ margin: '0 0 1.1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        {t.garminSync.settingsDescription}
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
          {status === null
            ? <AlertCircle size={16} style={{ color: 'var(--text-muted)' }} />
            : status.configured
              ? <CheckCircle2 size={16} style={{ color: 'var(--accent-emerald)' }} />
              : <AlertCircle size={16} style={{ color: 'var(--accent-amber)' }} />}
          <span>{status === null ? t.common.loading : status.configured ? sourceLabel : t.garminSync.notConfigured}</span>
        </div>
        {status?.configured && <span style={{ color: 'var(--text-secondary)' }}>{expiryLabel}</span>}
        {status?.expired && (
          <span style={{ color: 'var(--accent-amber)' }}>
            {status.source === 'environment'
              ? format(t.garminSync.expiredEnvironmentKeyDescription, { env: GARMIN_API_KEY_ENV })
              : t.garminSync.expiredKeyDescription}
          </span>
        )}
        {status?.unreadable && (
          <span style={{ color: 'var(--accent-amber)' }}>
            {t.garminSync.unreadableKey}
          </span>
        )}
        {status?.expiringSoon && !status.expired && (
          <span style={{ color: 'var(--accent-amber)' }}>
            {format(t.garminSync.keyExpiringSoon, {
              date: warningDate,
              days: status.daysUntilExpiry ?? 0
            })}
          </span>
        )}
      </div>

      <form onSubmit={handleSave}>
        <label htmlFor="garmin-api-key" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', fontWeight: 650, color: 'var(--text-primary)' }}>
          {t.garminSync.keyLabel}
        </label>
        <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
          <input
            id="garmin-api-key"
            type="password"
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            placeholder={t.garminSync.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            style={{ flex: '1 1 300px', minWidth: 0, padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
          />
          <button type="submit" className="garmin-folder-action" disabled={busy || (!apiKey.trim() && (!status?.configured || expiryFromEnvironment))}>
            {busy
              ? t.garminSync.saving
              : !apiKey.trim() && status?.source
                ? t.garminSync.saveExpiry
                : t.garminSync.saveKey}
          </button>
          {status?.source === 'stored' && (
            <button type="button" className="garmin-folder-action" onClick={handleRemove} disabled={busy}>
              <Trash2 size={15} /> {t.garminSync.removeKey}
            </button>
          )}
        </div>

        <label htmlFor="garmin-api-expiry" style={{ display: 'block', margin: '1rem 0 0.4rem', fontSize: '0.8rem', fontWeight: 650, color: 'var(--text-primary)' }}>
          {t.garminSync.expiryLabel}
        </label>
        <input
          id="garmin-api-expiry"
          type="date"
          value={expiry}
          disabled={busy || expiryFromEnvironment || (!status?.configured && !apiKey.trim())}
          onChange={event => setExpiry(event.target.value)}
          style={{ padding: '0.6rem 0.7rem', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
        />
        <p style={{ margin: '0.45rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          {t.garminSync.expiryHint}
        </p>
        {expiryFromEnvironment && (
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            {format(t.garminSync.expiryFromEnvironment, { env: GARMIN_API_KEY_EXPIRY_ENV })}
          </p>
        )}
      </form>

      <p style={{ margin: '0.9rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
        {status?.encrypted ? t.garminSync.storageHintEncrypted : t.garminSync.storageHint}
      </p>
      <p style={{ margin: '0.35rem 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
        {format(t.garminSync.envHint, { env: GARMIN_API_KEY_ENV, expiryEnv: GARMIN_API_KEY_EXPIRY_ENV })}
      </p>
      <a
        className="garmin-sync-link"
        href={GARMIN_PERSONAL_API_KEY_URL}
        target="_blank"
        rel="noreferrer"
        style={{ marginTop: '0.65rem', display: 'inline-flex' }}
      >
        <ExternalLink size={14} /> {t.garminSync.getKey}
      </a>

      {message && (
        <div role="status" style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: message.type === 'success' ? '#4ade80' : '#f87171' }}>
          {message.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{message.text}</span>
        </div>
      )}
    </section>
  );
};
