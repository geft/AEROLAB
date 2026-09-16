import React, { useState, useMemo, useEffect } from 'react';
import { ShieldCheck, Activity, AlertTriangle, ArrowRight } from 'lucide-react';
import { calculateAgeFromDob } from '../utils/formatters.js';

interface OnboardingPageProps {
  onCompleted: () => void;
}

export const OnboardingPage: React.FC<OnboardingPageProps> = ({ onCompleted }) => {
  const [dob, setDob] = useState<string>('');
  const [gender, setGender] = useState<string>('Prefer not to say');
  const [restingHr, setRestingHr] = useState<string>('');
  const [manualMaxHr, setManualMaxHr] = useState<string>('');
  const [isAutoMaxHr, setIsAutoMaxHr] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasExistingData, setHasExistingData] = useState<boolean>(false);

  // Pre-load existing profile on mount so the user never has to re-type existing data
  useEffect(() => {
    fetch('/api/profile')
      .then(async res => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.warn(`[HTTP ${res.status}] Profile fetch in onboarding:`, errData);
          return;
        }
        const data = await res.json();
        if (data?.profile) {
          const p = data.profile;
          if (p.dob) setDob(p.dob);
          if (p.gender) setGender(p.gender);
          if (p.resting_hr) setRestingHr(String(p.resting_hr));
          if (p.max_hr) {
            setManualMaxHr(String(p.max_hr));
            setIsAutoMaxHr(Boolean(p.is_max_hr_estimated));
          }

          const isReady = Boolean(data.isConfigured || p.is_configured === 1 || (p.dob && p.resting_hr));
          setHasExistingData(isReady);
          if (isReady) {
            localStorage.setItem('aerolab_profile_configured', 'true');
          }
        }
      })
      .catch(err => {
        console.warn('Network error fetching profile in onboarding:', err);
      });
  }, []);

  const computedAge = useMemo(() => {
    if (!dob) return null;
    return calculateAgeFromDob(dob, 0) || null;
  }, [dob]);

  const tanakaMaxHr = useMemo(() => {
    if (!computedAge) return null;
    return Math.round(208 - 0.7 * computedAge);
  }, [computedAge]);

  const effectiveMaxHr = isAutoMaxHr ? tanakaMaxHr : (Number(manualMaxHr) || null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dob || !restingHr) {
      setError('[ERR_VALIDATION]: Date of birth and resting heart rate are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dob,
          gender,
          resting_hr: Number(restingHr),
          max_hr: effectiveMaxHr ?? tanakaMaxHr,
          is_max_hr_estimated: isAutoMaxHr ? 1 : 0,
          is_configured: 1
        })
      });

      if (!res.ok) {
        let errJson: any = null;
        try {
          errJson = await res.json();
        } catch {
          // ignore non-json error responses
        }
        const code = errJson?.code || `ERR_HTTP_${res.status}`;
        const msg = errJson?.error || errJson?.message || res.statusText || 'Failed to save profile';
        const details = errJson?.details ? ` - ${errJson.details}` : '';
        throw new Error(`[${code}]: ${msg}${details}`);
      }

      localStorage.setItem('aerolab_profile_configured', 'true');
      onCompleted();
    } catch (err: any) {
      setError(err.message || '[ERR_UNKNOWN]: Something went wrong. Please try again.');
    } finally {
      setSaving(false);
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
      <div style={{ textAlign: 'center', marginBottom: '2.5rem', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem', marginBottom: '0.75rem' }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(6,182,212,0.25), rgba(2,132,199,0.15))',
            border: '1px solid rgba(6,182,212,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Activity size={22} color="#38bdf8" />
          </div>
          <span style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '-0.04em', color: 'var(--text-primary)' }}>
            AEROLAB
          </span>
        </div>
        <h1 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
          Cardiovascular Baseline Setup
        </h1>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
          Required before your data can be calibrated. Takes 30 seconds.
        </p>
      </div>

      {/* Form card */}
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 18,
        padding: '2rem',
        maxWidth: 520,
        width: '100%',
        boxShadow: '0 20px 40px -15px rgba(0,0,0,0.3)',
        position: 'relative',
        zIndex: 1
      }}>
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
              {hasExistingData && (
                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => onCompleted()}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#38bdf8',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      padding: 0,
                      textDecoration: 'underline'
                    }}
                  >
                    You have existing profile data — click here to return to dashboard
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {/* DOB & Gender */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                Date of Birth <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="date"
                required
                value={dob}
                onChange={e => setDob(e.target.value)}
                style={inputStyle}
              />
              {computedAge !== null ? (
                <p style={hintStyle}>Age: <b style={{ color: '#38bdf8' }}>{computedAge} yrs</b></p>
              ) : (
                <p style={hintStyle}>Used for age & formulas</p>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                Gender
              </label>
              <select
                value={gender}
                onChange={e => setGender(e.target.value)}
                style={inputStyle}
              >
                <option value="Prefer not to say">Prefer not to say</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Non-binary">Non-binary</option>
              </select>
              <p style={hintStyle}>For normative comparisons</p>
            </div>
          </div>

          {/* Resting HR */}
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
              Resting Heart Rate <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="number"
                required
                min={30}
                max={100}
                placeholder="e.g. 50"
                value={restingHr}
                onChange={e => setRestingHr(e.target.value)}
                style={inputStyle}
              />
              <span style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: '0.75rem', color: 'var(--text-muted)'
              }}>
                bpm
              </span>
            </div>
            <p style={hintStyle}>Morning resting heart rate or lowest waking measurement</p>
          </div>

          {/* Max HR */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Maximum Heart Rate
              </label>
              <button
                type="button"
                onClick={() => setIsAutoMaxHr(prev => !prev)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#38bdf8',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline'
                }}
              >
                {isAutoMaxHr ? 'Enter manually' : 'Use Tanaka formula'}
              </button>
            </div>

            {isAutoMaxHr ? (
              <div style={{
                padding: '0.65rem 0.85rem',
                borderRadius: 8,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  Tanaka Estimate (208 - 0.7 x Age):
                </span>
                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#38bdf8' }}>
                  {tanakaMaxHr ? `${tanakaMaxHr} bpm` : 'Enter DOB above'}
                </span>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  min={130}
                  max={230}
                  placeholder="e.g. 185"
                  value={manualMaxHr}
                  onChange={e => setManualMaxHr(e.target.value)}
                  style={inputStyle}
                />
                <span style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  fontSize: '0.75rem', color: 'var(--text-muted)'
                }}>
                  bpm
                </span>
              </div>
            )}
            <p style={hintStyle}>
              {isAutoMaxHr
                ? 'Calculated via Tanaka formula. Can be updated anytime in Profile.'
                : 'Highest heart rate recorded during an all-out effort.'}
            </p>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={saving}
            style={{
              marginTop: '0.25rem',
              padding: '0.9rem',
              borderRadius: 10,
              background: saving
                ? 'rgba(6,182,212,0.4)'
                : 'linear-gradient(135deg, #0284c7, #06b6d4)',
              border: 'none',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'all 0.15s ease',
              boxShadow: saving ? 'none' : '0 4px 14px 0 rgba(6,182,212,0.4)'
            }}
          >
            <ShieldCheck size={18} />
            <span>{saving ? 'Calibrating…' : 'Save & Launch AEROLAB'}</span>
          </button>

          {/* Return to Dashboard Button if user already has data */}
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
                gap: '0.4rem',
                transition: 'all 0.15s ease'
              }}
            >
              <span>Return to Dashboard</span>
              <ArrowRight size={15} />
            </button>
          )}
        </form>
      </div>

      {/* Footer note */}
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1.5rem', textAlign: 'center', maxWidth: 400 }}>
        All data is stored locally in SQLite. Nothing leaves your machine.
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
