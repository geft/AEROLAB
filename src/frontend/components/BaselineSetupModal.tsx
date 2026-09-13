import React, { useState, useMemo } from 'react';
import { HeartPulse, Calendar, Activity, Zap, CheckCircle2, ShieldCheck, Flame } from 'lucide-react';
import { calculateAgeFromDob } from '../utils/formatters.js';

interface BaselineSetupModalProps {
  isOpen: boolean;
  onCompleted: () => void;
  initialDob?: string;
  initialGender?: string;
  initialRestingHr?: number;
  initialMaxHr?: number;
  initialVo2Max?: number;
}

export const BaselineSetupModal: React.FC<BaselineSetupModalProps> = ({
  isOpen,
  onCompleted,
  initialDob = '1992-05-15',
  initialGender = 'Prefer not to say',
  initialRestingHr = 60,
  initialMaxHr = 190,
  initialVo2Max = 48
}) => {
  const [dob, setDob] = useState<string>(initialDob);
  const [gender, setGender] = useState<string>(initialGender);
  const [restingHr, setRestingHr] = useState<number>(initialRestingHr);
  const [manualMaxHr, setManualMaxHr] = useState<number>(initialMaxHr);
  const [isAutoMaxHr, setIsAutoMaxHr] = useState<boolean>(true);
  const [vo2Max, setVo2Max] = useState<number>(initialVo2Max);
  const [goal, setGoal] = useState<string>('Build aerobic endurance');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic age calculation from DOB
  const computedAge = useMemo(() => {
    return calculateAgeFromDob(dob, 34);
  }, [dob]);

  // Dynamic Tanaka formula calculation: 208 - 0.7 * age
  const tanakaMaxHr = useMemo(() => {
    return Math.round(208 - 0.7 * computedAge);
  }, [computedAge]);

  const effectiveMaxHr = isAutoMaxHr ? tanakaMaxHr : manualMaxHr;

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dob,
          gender,
          resting_hr: Number(restingHr) || 60,
          max_hr: Number(effectiveMaxHr) || tanakaMaxHr,
          is_max_hr_estimated: isAutoMaxHr ? 1 : 0,
          vo2_max: Number(vo2Max) || 45,
          upcoming_benchmark: goal,
          is_configured: 1
        })
      });

      if (!res.ok) {
        throw new Error('Failed to save baseline profile');
      }

      onCompleted();
    } catch (err: any) {
      setError(err.message || 'Error saving baselines');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(7, 9, 14, 0.88)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem'
      }}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 16,
          padding: '2rem',
          maxWidth: '540px',
          width: '100%',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          maxHeight: '90vh',
          overflowY: 'auto'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1.25rem' }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.25), rgba(2, 132, 199, 0.15))',
              border: '1px solid rgba(6, 182, 212, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <HeartPulse size={26} color="#38bdf8" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Cardiovascular Baseline Setup
            </h2>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Calibrate your heart rate zones, thresholds, and AI coach before starting.
            </p>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '0.82rem',
              marginBottom: '1rem'
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
          {/* Birth Date -> Auto-calculated Age */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Date of Birth
              </label>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: '#38bdf8',
                  background: 'rgba(6, 182, 212, 0.12)',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 999
                }}
              >
                Age: {computedAge} yrs (auto-computed)
              </span>
            </div>
            <input
              type="date"
              required
              value={dob}
              onChange={e => setDob(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem'
              }}
            />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Used to predict cardiovascular ceilings. You will never need to manually update your age.
            </div>
          </div>

          {/* Biological Gender */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              Biological Gender
            </label>
            <select
              value={gender}
              onChange={e => setGender(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem'
              }}
            >
              <option value="Prefer not to say">Prefer not to say</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Non-binary">Non-binary</option>
            </select>
          </div>

          {/* Resting Heart Rate */}
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
              Resting Heart Rate (bpm)
            </label>
            <input
              type="number"
              min={35}
              max={110}
              required
              value={restingHr}
              onChange={e => setRestingHr(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '0.6rem 0.75rem',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem'
              }}
            />
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
              Your waking resting pulse or watch sleep average. Used for Karvonen Heart Rate Reserve (HRR).
            </div>
          </div>

          {/* Max Heart Rate (Auto vs Manual) */}
          <div style={{ padding: '0.85rem', borderRadius: 10, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Maximum Heart Rate
              </label>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b' }}>
                {effectiveMaxHr} bpm
              </span>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-primary)', marginBottom: '0.6rem' }}>
              <input
                type="checkbox"
                checked={isAutoMaxHr}
                onChange={e => setIsAutoMaxHr(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span>Auto-estimate from age & infer from hard workouts (Recommended)</span>
            </label>

            {isAutoMaxHr ? (
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Predicted baseline: <strong style={{ color: '#38bdf8' }}>{tanakaMaxHr} bpm</strong> via Tanaka formula (<code>208 - 0.7 × {computedAge}</code>). Once you upload all-out 5K time trials or VO2 Max intervals, AEROLAB will dynamically adapt to your true peak effort.
              </div>
            ) : (
              <div>
                <input
                  type="number"
                  min={120}
                  max={230}
                  value={manualMaxHr}
                  onChange={e => setManualMaxHr(Number(e.target.value))}
                  placeholder="e.g. 195"
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.65rem',
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface)',
                    color: 'var(--text-primary)',
                    fontSize: '0.85rem'
                  }}
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  Laboratory ramp test or all-out field test benchmark.
                </div>
              </div>
            )}
          </div>

          {/* Starting VO2 Max & Target */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                VO2 Max (Optional)
              </label>
              <input
                type="number"
                step="0.5"
                min={20}
                max={90}
                value={vo2Max}
                onChange={e => setVo2Max(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.7rem',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                Primary Focus
              </label>
              <input
                type="text"
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder="e.g. 10k race, Aerobic Base"
                style={{
                  width: '100%',
                  padding: '0.55rem 0.7rem',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem'
                }}
              />
            </div>
          </div>

          {/* Save Button */}
          <button
            type="submit"
            disabled={saving}
            style={{
              marginTop: '0.5rem',
              padding: '0.85rem',
              borderRadius: 10,
              background: 'linear-gradient(135deg, #0284c7, #06b6d4)',
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
              boxShadow: '0 4px 14px 0 rgba(6, 182, 212, 0.39)'
            }}
          >
            <ShieldCheck size={18} />
            <span>{saving ? 'Saving Baselines...' : 'Save Baselines & Start AEROLAB'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
