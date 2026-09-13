import React, { useState, useEffect, useMemo } from 'react';
import { User, Heart, Zap, Save, CheckCircle, AlertCircle, Info, ShieldCheck, Activity, Flame, Calendar } from 'lucide-react';
import { formatPace, calculateAgeFromDob } from '../utils/formatters.js';

interface ObservedPeakData {
  peakHr: number;
  activityId: string;
  activityName: string;
  activityDate: string;
  runType: string;
}

interface ProfileData {
  dob?: string;
  gender?: string;
  age?: number;
  resting_hr?: number;
  max_hr?: number;
  is_max_hr_estimated?: number | boolean;
}

export const ProfileView: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form local state
  const [dob, setDob] = useState('1989-04-15');
  const [gender, setGender] = useState('Prefer not to say');
  const [restingHr, setRestingHr] = useState(55);
  const [manualMaxHr, setManualMaxHr] = useState(203);
  const [isAutoMaxHr, setIsAutoMaxHr] = useState(true);

  // Loaded metadata
  const [currentThresholds, setCurrentThresholds] = useState<any>(null);
  const [observedPeakHr, setObservedPeakHr] = useState<ObservedPeakData | null>(null);
  const [tanakaMaxHr, setTanakaMaxHr] = useState(182);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/profile');
      const data = await res.json();
      if (data.profile) {
        setDob(data.profile.dob || '1989-04-15');
        setGender(data.profile.gender || 'Prefer not to say');
        setRestingHr(Number(data.profile.resting_hr) || 55);
        setManualMaxHr(Number(data.profile.max_hr) || 203);
        setIsAutoMaxHr(Boolean(data.profile.is_max_hr_estimated));
      }
      if (data.currentThresholds) {
        setCurrentThresholds(data.currentThresholds);
      }
      if (data.observedPeakHr) {
        setObservedPeakHr(data.observedPeakHr);
      }
      if (data.tanakaMaxHr) {
        setTanakaMaxHr(data.tanakaMaxHr);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
      setStatusMessage({ type: 'error', text: 'Failed to load athlete profile.' });
    } finally {
      setLoading(false);
    }
  };

  // Dynamic age calculation from DOB
  const computedAge = useMemo(() => {
    return calculateAgeFromDob(dob, 37);
  }, [dob]);

  // Live Tanaka formula calculation based on current form age: 208 - 0.7 * age
  const liveTanaka = useMemo(() => {
    return Math.round(208 - 0.7 * computedAge);
  }, [computedAge]);

  // Effective Max HR used across UI and zones
  const effectiveMaxHr = useMemo(() => {
    if (isAutoMaxHr) {
      return observedPeakHr?.peakHr || liveTanaka;
    }
    return Number(manualMaxHr) || 203;
  }, [isAutoMaxHr, observedPeakHr, liveTanaka, manualMaxHr]);

  // Live Karvonen HRR Zone derivation for visual preview
  const liveZones = useMemo(() => {
    const rhr = Number(restingHr) || 55;
    const max = effectiveMaxHr;
    const lt1 = currentThresholds?.lt1Hr || 148;
    const lt2 = currentThresholds?.lt2Hr || 167;

    const z1Upper = Math.min(lt1 - 14, Math.round(rhr + (max - rhr) * 0.54));
    const z4Upper = Math.round(rhr + (max - rhr) * 0.90);

    return {
      z1: [0, z1Upper],
      z2: [z1Upper + 1, lt1],
      z3: [lt1 + 1, lt2 - 1],
      z4: [lt2, z4Upper],
      z5: [z4Upper + 1, max]
    };
  }, [restingHr, effectiveMaxHr, currentThresholds]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setStatusMessage(null);

      const payload = {
        dob,
        gender,
        age: computedAge,
        resting_hr: Number(restingHr),
        max_hr: effectiveMaxHr,
        is_max_hr_estimated: isAutoMaxHr,
        opt_out_max_hr: isAutoMaxHr
      };

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to save profile');
      }

      setStatusMessage({ type: 'success', text: 'Cardiovascular baselines updated and training models re-synchronized!' });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Error updating profile' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="stats-grid">
        <div className="overview-card loading-skeleton" style={{ height: 500 }} />
      </div>
    );
  }

  const lt1Pace = currentThresholds?.lt1PaceSecKm ? formatPace(currentThresholds.lt1PaceSecKm) : '5:50/km';
  const lt2Pace = currentThresholds?.lt2PaceSecKm ? formatPace(currentThresholds.lt2PaceSecKm) : '4:10/km';

  return (
    <div className="profile-view-container">
      {/* Top Banner Header */}
      <div className="profile-header-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div className="profile-avatar-circle">
            <Heart size={28} color="#06b6d4" />
          </div>
          <div>
            <h1 className="profile-header-title">Cardiovascular Baselines</h1>
            <p className="profile-header-subtitle">
              Cardiovascular baselines &amp; physiological threshold anchors. Only cardio parameters affect your running zones, efficiency index, and workout execution scores.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="save-profile-btn"
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={16} />
          {saving ? 'Saving...' : 'Save Baselines'}
        </button>
      </div>

      {statusMessage && (
        <div className={`profile-status-banner ${statusMessage.type}`}>
          {statusMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* 1. Inferred Thresholds Card (Non-Editable Reference) */}
      <section className="profile-card" style={{ marginBottom: '1.5rem' }}>
        <div className="profile-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap size={18} color="#f59e0b" />
            <h2 className="profile-card-title">Continuously Inferred Physiological Thresholds</h2>
          </div>
          <span className="profile-badge-calibrated">Derived from Run Data</span>
        </div>

        <p className="profile-card-desc">
          Lactate thresholds are derived continuously from your actual steady runs and tempo workouts via aerodynamic &amp; cardiac inflection. They are not manually edited here to prevent optimistic target drift.
        </p>

        <div className="threshold-pills-row">
          <div className="threshold-pill-item">
            <span className="threshold-pill-label">Aerobic Base (LT1)</span>
            <span className="threshold-pill-value" style={{ color: '#10b981' }}>
              ~{currentThresholds?.lt1Hr || 148} bpm
            </span>
            <span className="threshold-pill-sub">
              Pace: {lt1Pace}
            </span>
          </div>

          <div className="threshold-pill-item">
            <span className="threshold-pill-label">Lactate Threshold (LT2)</span>
            <span className="threshold-pill-value" style={{ color: '#f59e0b' }}>
              ~{currentThresholds?.lt2Hr || 167} bpm
            </span>
            <span className="threshold-pill-sub">
              Pace: {lt2Pace}
            </span>
          </div>

          <div className="threshold-pill-item">
            <span className="threshold-pill-label">Aerobic Turnpoint Spread</span>
            <span className="threshold-pill-value" style={{ color: '#06b6d4' }}>
              {currentThresholds?.lt1PaceSecKm && currentThresholds?.lt2PaceSecKm
                ? `${Math.round(currentThresholds.lt1PaceSecKm - currentThresholds.lt2PaceSecKm)}s gap`
                : '60s gap'}
            </span>
            <span className="threshold-pill-sub">
              {currentThresholds?.source ? `Source: ${currentThresholds.source}` : 'Continuous Inference'}
            </span>
          </div>
        </div>
      </section>

      {/* 2. Core Cardio Baselines Form */}
      <form onSubmit={handleSave} className="profile-sections-grid">
        {/* Runner Identity & Resting Baseline */}
        <section className="profile-card">
          <div className="profile-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={18} color="#06b6d4" />
              <h2 className="profile-card-title">Biological Anchors &amp; Resting Pulse</h2>
            </div>
          </div>

          <div className="profile-form-grid">
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                <label className="form-label">Date of Birth</label>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8' }}>
                  Age: {computedAge} yrs (auto-computed)
                </span>
              </div>
              <input
                type="date"
                className="form-input"
                value={dob}
                onChange={e => setDob(e.target.value)}
              />
              <span className="form-hint">Used for Tanaka formula (208 - 0.7 × age = {liveTanaka} bpm). Automatically keeps age up to date.</span>
            </div>

            <div className="form-group">
              <label className="form-label">Biological Gender</label>
              <select
                className="form-input"
                value={gender}
                onChange={e => setGender(e.target.value)}
              >
                <option value="Prefer not to say">Prefer not to say</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Non-binary">Non-binary</option>
              </select>
              <span className="form-hint">Cardiovascular and VO2 Max distribution baseline.</span>
            </div>

            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">Resting Heart Rate (bpm)</label>
              <input
                type="number"
                className="form-input"
                value={restingHr}
                onChange={e => setRestingHr(Number(e.target.value))}
                placeholder="e.g. 55 bpm"
                min="35"
                max="100"
              />
              <span className="form-hint">
                True resting heart rate upon waking. Essential anchor for Karvonen Heart Rate Reserve (HRR) calculations.
              </span>
            </div>
          </div>
        </section>

        {/* Maximum Heart Rate Engine */}
        <section className="profile-card">
          <div className="profile-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Flame size={18} color="#ef4444" />
              <h2 className="profile-card-title">Maximum Heart Rate (HRmax) Engine</h2>
            </div>
          </div>

          {/* Mode Selection Tabs */}
          <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '1rem' }}>
            <button
              type="button"
              className={`view-mode-btn ${isAutoMaxHr ? 'active' : ''}`}
              style={{ flex: 1, padding: '0.65rem 0.85rem', fontSize: '0.82rem', textAlign: 'left' }}
              onClick={() => setIsAutoMaxHr(true)}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>
                Auto-Infer from Run Data
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {observedPeakHr ? `Observed Peak: ${observedPeakHr.peakHr} bpm` : `Tanaka Age Fallback: ${liveTanaka} bpm`}
              </div>
            </button>

            <button
              type="button"
              className={`view-mode-btn ${!isAutoMaxHr ? 'active' : ''}`}
              style={{ flex: 1, padding: '0.65rem 0.85rem', fontSize: '0.82rem', textAlign: 'left' }}
              onClick={() => setIsAutoMaxHr(false)}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.15rem' }}>
                Manual Override
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                Lock custom Max HR value
              </div>
            </button>
          </div>

          {/* Auto-Infer Display */}
          {isAutoMaxHr ? (
            <div style={{ padding: '0.9rem', borderRadius: 8, background: 'rgba(6, 182, 212, 0.06)', border: '1px solid rgba(6, 182, 212, 0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#06b6d4' }}>
                  {observedPeakHr ? 'Calibrated from Actual Run Data' : 'Estimated Baseline (No Hard Efforts Yet)'}
                </span>
                <span style={{ fontSize: '1.4rem', fontWeight: 800, color: '#06b6d4' }}>
                  {effectiveMaxHr} bpm
                </span>
              </div>

              {observedPeakHr ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem 0', lineHeight: 1.5 }}>
                  Observed peak heart rate detected from <b>{observedPeakHr.activityName}</b> ({observedPeakHr.activityDate}).
                  As your fitness shifts or peak workout efforts naturally change over time, your Max HR adapts dynamically from real performance data.
                </p>
              ) : (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.4rem 0', lineHeight: 1.5 }}>
                  No all-out races or VO2 max interval workouts have been recorded yet. Using Tanaka population formula (208 - 0.7 × {age} = <b>{liveTanaka} bpm</b>) as a cold-start baseline until a high-intensity effort is logged.
                </p>
              )}

              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)', paddingTop: '0.35rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <span>Observed Peak: <b>{observedPeakHr ? `${observedPeakHr.peakHr} bpm` : 'None'}</b></span>
                <span>Tanaka Fallback: <b>{liveTanaka} bpm</b></span>
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" htmlFor="manual-max-hr-input">Manual Maximum Heart Rate (bpm)</label>
              <input
                id="manual-max-hr-input"
                type="number"
                className="form-input"
                value={manualMaxHr}
                onChange={e => setManualMaxHr(Number(e.target.value))}
                placeholder="e.g. 203"
                min="130"
                max="230"
              />
              <span className="form-hint">
                Fixed value locked by user. All training zones will be anchored strictly to this number.
              </span>
            </div>
          )}

          {/* Backward compatibility checkbox for tests */}
          <div style={{ marginTop: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={isAutoMaxHr}
                onChange={e => setIsAutoMaxHr(e.target.checked)}
                style={{ accentColor: 'var(--accent-cyan)' }}
                aria-label="I don't know my max heart rate"
              />
              <span>Auto-calibrate Max HR from run data / age instead of fixed manual number</span>
            </label>
          </div>
        </section>
      </form>

      {/* 3. Resulting Karvonen HRR Training Zones Preview */}
      <section className="profile-card">
        <div className="profile-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="#06b6d4" />
            <h2 className="profile-card-title">Live Resulting Physiological Training Zones (Karvonen HRR)</h2>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Resting HR: {restingHr} bpm • Max HR: {effectiveMaxHr} bpm
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
          {/* Zone 1 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8' }}>Zone 1 Recovery</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#94a3b8' }}>&lt; {liveZones.z2[0]} bpm</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              Gentle active recovery and warm-up. Virtually zero muscular microtrauma.
            </p>
          </div>

          {/* Zone 2 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#10b981' }}>Zone 2 Aerobic Base</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#10b981' }}>{liveZones.z2[0]}–{liveZones.z2[1]} bpm</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              Peak fat oxidation, mitochondrial biogenesis, and capillary network expansion below LT1.
            </p>
          </div>

          {/* Zone 3 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#06b6d4' }}>Zone 3 Tempo</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#06b6d4' }}>{liveZones.z3[0]}–{liveZones.z3[1]} bpm</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              Aerobic turnpoint zone between LT1 and LT2. Moderate glycogen utilization.
            </p>
          </div>

          {/* Zone 4 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b' }}>Zone 4 Threshold (LT2)</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f59e0b' }}>{liveZones.z4[0]}–{liveZones.z4[1]} bpm</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              Lactate shuttle and clearance capacity. Maximum sustainable 1-hour race intensity.
            </p>
          </div>

          {/* Zone 5 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ef4444' }}>Zone 5 VO2 Max</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#ef4444' }}>&gt; {liveZones.z4[1]} bpm</span>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
              Maximal aerobic capacity and anaerobic power. High neurological motor-unit recruitment.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
