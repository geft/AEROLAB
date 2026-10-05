import React, { useState, useMemo, useEffect, useRef } from 'react';
import { getProfile, restoreDatabase, updateProfile } from '../api/client.js';
import { apiErrorMessage } from '../api/errors.js';
import {
  ShieldCheck,
  Activity,
  AlertTriangle,
  ArrowRight,
  Database,
  FileUp,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { calculateAgeFromDob } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';

interface OnboardingPageProps {
  onCompleted: () => void;
}

export const OnboardingPage: React.FC<OnboardingPageProps> = ({ onCompleted }) => {
  const { t, format } = useTranslation();
  const [activeTab, setActiveTab] = useState<'setup' | 'restore'>('setup');

  // Form states. Everything starts empty on purpose: a fresh database carries
  // schema placeholder values, and prefilling them would let someone "complete"
  // onboarding without ever entering their own measurements.
  const [dob, setDob] = useState<string>('');
  const [gender, setGender] = useState<string>('');
  const [restingHr, setRestingHr] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasExistingData, setHasExistingData] = useState<boolean>(false);

  // Restore states
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-load an existing profile on mount so a returning athlete never has to
  // re-type it. Only a genuinely configured profile is copied into the form:
  // an unconfigured row only holds schema placeholder values, and showing those
  // as if the athlete had entered them is exactly how invalid profiles happen.
  useEffect(() => {
    getProfile()
      .then(data => {
        const p = data?.profile;
        const isReady = Boolean(data?.isConfigured && p?.is_configured === 1 && p?.dob && p?.resting_hr);
        setHasExistingData(isReady);
        if (!isReady || !p) {
          localStorage.removeItem('aerolab_profile_configured');
          return;
        }

        localStorage.setItem('aerolab_profile_configured', 'true');
        let cleanDob = String(p.dob).trim();
        if (cleanDob.includes('T')) cleanDob = cleanDob.split('T')[0];
        if (/^\d{4}-\d{2}$/.test(cleanDob)) cleanDob = `${cleanDob}-01`;
        setDob(cleanDob);
        if (p.gender) setGender(p.gender);
        setRestingHr(String(p.resting_hr));

      })
      .catch(() => {});

  }, []);


  const computedAge = useMemo(() => {
    if (!dob) return null;
    return calculateAgeFromDob(dob, 0) || null;
  }, [dob]);

  const tanakaMaxHr = useMemo(() => {
    if (!computedAge) return null;
    return Math.round(208 - 0.7 * computedAge);
  }, [computedAge]);


  // Nothing may be submitted until every required measurement is a real value:
  // no schema placeholders, no half-filled form, no out-of-range numbers.
  // Gender is deliberately optional — it only scales the Banister TRIMP load
  // model, and leaving it unset falls back to the standard coefficients.
  const isFormValid = useMemo(() => {
    if (!dob) return false;
    const rhr = Number(restingHr);
    if (!restingHr || Number.isNaN(rhr) || rhr < 30 || rhr > 120) return false;
    return computedAge !== null && tanakaMaxHr !== null;
  }, [dob, restingHr, computedAge, tanakaMaxHr]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      setError(t.onboarding.validationMissing);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        dob,
        resting_hr: Number(restingHr),
        is_configured: 1
      };
      // Gender is optional: only send it when the athlete chose one, so an
      // untouched selector never overwrites a previously saved value.
      if (gender) payload.gender = gender;

      await updateProfile(payload);

      localStorage.setItem('aerolab_profile_configured', 'true');
      onCompleted();
    } catch (err) {
      setError(apiErrorMessage(t, err, t.onboarding.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  // Restore from .db file
  const handleFileRestore = async (file: File) => {
    if (!file) return;
    setIsRestoring(true);
    setError(null);
    setRestoreSuccess(null);

    try {
      // Send the file as a raw binary body: no base64 inflation and the server
      // streams it to disk, so size is no longer limited by process memory.
      await restoreDatabase(file);

      setRestoreSuccess(t.onboarding.restoreSuccessToast);
      localStorage.setItem('aerolab_profile_configured', 'true');
      setTimeout(() => {
        onCompleted();
      }, 1200);
    } catch (err) {
      setError(apiErrorMessage(t, err, t.backup.restoreFailed));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Ambient glow background */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 40% at 50% 20%, rgba(6,182,212,0.08) 0%, transparent 70%)'
      }} />

      {/* Brand header */}
      <div style={{ textAlign: 'center', marginBottom: '1.75rem', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem', marginBottom: '0.65rem' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(6,182,212,0.25), rgba(2,132,199,0.15))',
            border: '1px solid rgba(6,182,212,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Activity size={24} color="#38bdf8" />
          </div>
          <span style={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.04em', color: 'var(--text-primary)' }}>
            {t.onboarding.brandTitle}
          </span>
        </div>
        <h1 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
          {t.onboarding.brandSubtitle}
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          {t.onboarding.stepRequired}
        </p>
      </div>

      {/* Main card */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: '1.75rem 2rem',
        maxWidth: 540,
        width: '100%',
        boxShadow: '0 20px 40px -15px rgba(0,0,0,0.3)',
        position: 'relative',
        zIndex: 1
      }}>
        {/* Onboarding Mode Selector Tabs */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          background: 'var(--bg-surface)',
          padding: '4px',
          borderRadius: 10,
          border: '1px solid var(--border-subtle)',
          marginBottom: '1.5rem'
        }}>
          <button
            type="button"
            onClick={() => { setActiveTab('setup'); setError(null); }}
            style={{
              padding: '0.55rem 0.25rem',
              borderRadius: 7,
              border: 'none',
              background: activeTab === 'setup' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'setup' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'setup' ? 700 : 500,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              boxShadow: activeTab === 'setup' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Sparkles size={14} style={{ color: activeTab === 'setup' ? '#38bdf8' : 'inherit' }} />
            <span>{t.onboarding.tabSetup}</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('restore'); setError(null); }}
            style={{
              padding: '0.55rem 0.25rem',
              borderRadius: 7,
              border: 'none',
              background: activeTab === 'restore' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'restore' ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === 'restore' ? 700 : 500,
              fontSize: '0.78rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
              boxShadow: activeTab === 'restore' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Database size={14} style={{ color: activeTab === 'restore' ? '#38bdf8' : 'inherit' }} />
            <span>{t.onboarding.tabRestore}</span>
          </button>
        </div>

        {/* Status / Error feedback */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 10,
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.65rem'
          }}>
            <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: '0.82rem', color: '#ef4444', fontWeight: 600, wordBreak: 'break-word' }}>
                {error}
              </span>
            </div>
          </div>
        )}

        {restoreSuccess && (
          <div style={{
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.4)',
            borderRadius: 10,
            padding: '0.75rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            color: '#4ade80'
          }}>
            <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{restoreSuccess}</span>
          </div>
        )}

        {/* TAB 1: NEW ATHLETE SETUP */}
        {activeTab === 'setup' && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  {t.onboarding.dobLabel} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="date"
                  required
                  value={dob}
                  onChange={e => setDob(e.target.value)}
                  style={inputStyle}
                />
                {computedAge !== null ? (
                  <p style={hintStyle}>{t.onboarding.ageLabel} <b style={{ color: '#38bdf8' }}>{format(t.onboarding.ageYears, { age: computedAge })}</b></p>
                ) : (
                  <p style={hintStyle}>{t.onboarding.tanakaUsage}</p>
                )}
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  {t.onboarding.genderLabel}
                </label>
                <select
                  value={gender}
                  onChange={e => setGender(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">{t.onboarding.genderPlaceholder}</option>
                  <option value="Prefer not to say">{t.onboarding.genderPreferNotToSay}</option>
                  <option value="Male">{t.onboarding.genderMale}</option>
                  <option value="Female">{t.onboarding.genderFemale}</option>
                </select>
                <p style={hintStyle}>{t.onboarding.genderHint}</p>
              </div>
            </div>

            {/* Resting HR */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                {t.onboarding.restingHrLabel} <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  min="30"
                  max="120"
                  required
                  placeholder={t.onboarding.restingHrPlaceholder}
                  value={restingHr}
                  onChange={e => setRestingHr(e.target.value)}
                  style={inputStyle}
                />
                <span style={{ position: 'absolute', right: 12, top: 10, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  bpm
                </span>
              </div>
              <p style={hintStyle}>{t.onboarding.restingHrHint}</p>
            </div>

            {/* Inferred maximum heart rate */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {t.onboarding.maxHrLabel}
                </label>
              </div>

              <div style={{
                padding: '0.65rem 0.85rem',
                background: 'var(--bg-surface)',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {t.onboarding.calculatedMaxHr}
                </span>
                <strong style={{ fontSize: '0.95rem', color: '#38bdf8' }}>
                  {tanakaMaxHr ? `${tanakaMaxHr} bpm` : t.onboarding.enterDob}
                </strong>
              </div>
              <p style={hintStyle}>{format(t.profile.tanakaFormulaNote, { age: computedAge ?? '—', hr: tanakaMaxHr ?? '—' })}</p>
            </div>

            <button
              type="submit"
              disabled={saving || !isFormValid}
              style={{
                marginTop: '0.5rem',
                padding: '0.9rem',
                borderRadius: 10,
                background: saving || !isFormValid
                  ? 'rgba(6,182,212,0.25)'
                  : 'linear-gradient(135deg, #0284c7, #06b6d4)',
                border: 'none',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: saving || !isFormValid ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'all 0.15s ease',
                boxShadow: saving || !isFormValid ? 'none' : '0 4px 14px 0 rgba(6,182,212,0.4)'
              }}
            >
              <ShieldCheck size={18} />
              <span>{saving ? t.onboarding.calibrating : t.onboarding.saveAndLaunch}</span>
            </button>

            {hasExistingData && (
              <button
                type="button"
                onClick={() => onCompleted()}
                style={{
                  padding: '0.65rem',
                  borderRadius: 10,
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem'
                }}
              >
                <span>{t.onboarding.returnDashboard}</span>
                <ArrowRight size={15} />
              </button>
            )}
          </form>
        )}

        {/* TAB 2: RESTORE BACKUP (.db SNAPSHOT) */}
        {activeTab === 'restore' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Option A: Restore from .db File */}
            <div style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: '1.25rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <Database size={17} style={{ color: '#38bdf8' }} />
                <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t.onboarding.restoreDbCardTitle}
                </h3>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 1rem' }}>
                {t.onboarding.restoreDbCardDesc}
              </p>

              <input
                type="file"
                ref={fileInputRef}
                accept=".db,.sqlite"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleFileRestore(file);
                }}
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileRestore(file);
                }}
                style={{
                  border: '2px dashed rgba(56,189,248,0.4)',
                  borderRadius: 10,
                  padding: '1.5rem',
                  textAlign: 'center',
                  cursor: isRestoring ? 'wait' : 'pointer',
                  background: 'rgba(56,189,248,0.03)',
                  transition: 'all 0.15s ease'
                }}
              >
                <FileUp size={28} style={{ color: '#38bdf8', margin: '0 auto 0.5rem' }} />
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {isRestoring ? t.backup.restoring : t.onboarding.dropDbPrompt}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  {t.onboarding.supportedBackups}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Footer note */}
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1.5rem', textAlign: 'center', maxWidth: 420 }}>
        {t.onboarding.localSecurityNote}
      </p>
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.6rem 0.75rem',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  boxSizing: 'border-box'
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--text-muted)',
  marginTop: '0.3rem',
  marginBottom: 0
};
