import React, { useState, useEffect, useMemo } from 'react';
import { User, Heart, Zap, Save, CheckCircle, AlertCircle, Info, ShieldCheck, Activity, Flame, Calendar, HardDrive, Download, FolderSync, RefreshCw } from 'lucide-react';
import { formatPace, calculateAgeFromDob } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';

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
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form local state (unloaded initially; populated strictly from API)
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('Prefer not to say');
  const [restingHr, setRestingHr] = useState<number | string>('');
  const [manualMaxHr, setManualMaxHr] = useState<number | string>('');
  const [isAutoMaxHr, setIsAutoMaxHr] = useState(true);

  // Loaded metadata
  const [currentThresholds, setCurrentThresholds] = useState<any>(null);
  const [observedPeakHr, setObservedPeakHr] = useState<ObservedPeakData | null>(null);
  const [tanakaMaxHr, setTanakaMaxHr] = useState(185);

  // Database backup state
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);
  const [backupDirectory, setBackupDirectory] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupStatusMessage, setBackupStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      }
    } catch {}
  };

  useEffect(() => {
    fetchProfile();
    fetchDbStatus();
  }, []);

  const handleDownloadSnapshot = () => {
    window.open('/api/database/download', '_blank');
  };

  const handleBackupNow = async () => {
    try {
      setIsBackingUp(true);
      setBackupStatusMessage(null);
      const res = await fetch('/api/database/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDirectory: backupDirectory })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Backup failed');
      }
      setBackupStatusMessage({ type: 'success', text: t.backup.backupSuccess });
      fetchDbStatus();
    } catch (err: any) {
      setBackupStatusMessage({ type: 'error', text: `${t.backup.backupFailed}${err.message}` });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleSaveBackupSettings = async (enabled: boolean, dir: string) => {
    try {
      setAutoBackupEnabled(enabled);
      setBackupDirectory(dir);
      await fetch('/api/database/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autoBackupEnabled: enabled,
          backupDirectory: dir,
          backupIntervalDays: 7
        })
      });
      fetchDbStatus();
    } catch {}
  };

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/profile');
      const data = await res.json();
      if (data.profile) {
        const rawDob = data.profile.dob ? String(data.profile.dob).trim() : '';
        setDob(/^\d{4}-\d{2}$/.test(rawDob) ? `${rawDob}-15` : rawDob);
        setGender(data.profile.gender || 'Prefer not to say');
        if (data.profile.resting_hr !== undefined && data.profile.resting_hr !== null) {
          setRestingHr(Number(data.profile.resting_hr));
        }
        if (data.profile.max_hr !== undefined && data.profile.max_hr !== null) {
          setManualMaxHr(Number(data.profile.max_hr));
        }
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
    return dob ? calculateAgeFromDob(dob, 0) : null;
  }, [dob]);

  // Live Tanaka formula calculation based on current form age: 208 - 0.7 * age
  const liveTanaka = useMemo(() => {
    return computedAge ? Math.round(208 - 0.7 * computedAge) : tanakaMaxHr;
  }, [computedAge, tanakaMaxHr]);

  // Effective Max HR used across UI and zones
  const effectiveMaxHr = useMemo(() => {
    if (isAutoMaxHr) {
      return observedPeakHr?.peakHr || liveTanaka;
    }
    return Number(manualMaxHr) || liveTanaka;
  }, [isAutoMaxHr, observedPeakHr, liveTanaka, manualMaxHr]);

  // Live Karvonen HRR Zone derivation for visual preview
  const liveZones = useMemo(() => {
    const rhr = Number(restingHr) || 50;
    const max = effectiveMaxHr;
    const lt1 = currentThresholds?.lt1Hr || Math.round(rhr + (max - rhr) * 0.65);
    const lt2 = currentThresholds?.lt2Hr || Math.round(rhr + (max - rhr) * 0.82);

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
      const parsedRhr = Number(restingHr);
      if (!restingHr || isNaN(parsedRhr) || parsedRhr < 30 || parsedRhr > 120) {
        setStatusMessage({ type: 'error', text: 'Resting heart rate must be a valid number between 30 and 120 bpm.' });
        return;
      }

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

      let resData: any = {};
      try {
        resData = await res.json();
      } catch {
        // non-json response
      }

      if (!res.ok) {
        const code = resData.code || `ERR_HTTP_${res.status}`;
        const msg = resData.error || resData.message || res.statusText || 'Failed to save profile';
        const details = resData.details ? ` (${resData.details})` : '';
        throw new Error(`[${code}]: ${msg}${details}`);
      }

      setStatusMessage({ type: 'success', text: 'Cardiovascular baselines updated and training models re-synchronized!' });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || '[ERR_PROFILE_UPDATE]: Error updating profile' });
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
              Baselines and threshold anchors driving your training zones and efficiency metrics.
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
            <h2 className="profile-card-title">Inferred Physiological Thresholds</h2>
          </div>
          <span className="profile-badge-calibrated">Derived from Run Data</span>
        </div>

        <p className="profile-card-desc">
          Derived automatically from steady runs and tempo workouts to prevent manual drift.
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
              <h2 className="profile-card-title">Cardio Baselines &amp; Resting HR</h2>
            </div>
          </div>

          <div className="profile-form-grid">
            {/* 1. Date of Birth */}
            <div className="form-group">
              <label className="form-label" htmlFor="dob-input">Date of Birth</label>
              <input
                id="dob-input"
                type="date"
                className="form-input"
                value={dob}
                onChange={e => setDob(e.target.value)}
              />
              <span className="form-hint">Birth date for continuous age calculation.</span>
            </div>

            {/* 2. Current Age */}
            <div className="form-group">
              <label className="form-label">Current Age</label>
              <div className="form-input" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(255, 255, 255, 0.02)',
                userSelect: 'none'
              }}>
                <span style={{ fontWeight: 700, color: '#38bdf8' }}>
                  {dob ? `${computedAge} yrs` : '—'}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Tanaka max: ~{liveTanaka} bpm
                </span>
              </div>
              <span className="form-hint">Derived from birth date.</span>
            </div>

            {/* 3. Biological Gender */}
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
              <span className="form-hint">Normative baseline.</span>
            </div>

            {/* 4. Resting Heart Rate */}
            <div className="form-group">
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
              <span className="form-hint">Waking pulse for Karvonen HRR.</span>
            </div>
          </div>
        </section>

        {/* Maximum Heart Rate Engine */}
        <section className="profile-card">
          <div className="profile-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Flame size={18} color="#ef4444" />
              <h2 className="profile-card-title">Maximum Heart Rate (HRmax)</h2>
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
                {observedPeakHr ? `Observed Peak: ${observedPeakHr.peakHr} bpm` : `Tanaka Fallback: ${liveTanaka} bpm`}
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
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                {observedPeakHr
                  ? `Peak of ${observedPeakHr.peakHr} bpm observed during ${observedPeakHr.activityName} (${observedPeakHr.activityDate}).`
                  : `Tanaka formula: 208 - (0.7 × ${computedAge}) = ${liveTanaka} bpm until hard interval runs are logged.`}
              </p>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" htmlFor="manual-max-hr">Manual Maximum Heart Rate (bpm)</label>
              <input
                id="manual-max-hr"
                type="number"
                className="form-input"
                value={manualMaxHr}
                onChange={e => setManualMaxHr(Number(e.target.value))}
                placeholder="e.g. 185 bpm"
                min="140"
                max="230"
              />
              <span className="form-hint">
                Custom ceiling used for all zone calculations.
              </span>
            </div>
          )}

          {/* Estimation Opt-Out Checkbox */}
          <div style={{ marginTop: '0.85rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={isAutoMaxHr}
                onChange={e => setIsAutoMaxHr(e.target.checked)}
                style={{ accentColor: 'var(--accent-cyan)' }}
                aria-label="I don't know my max heart rate"
              />
              <span>Auto-calibrate Max HR from run data and age</span>
            </label>
          </div>
        </section>
      </form>

      {/* 3. Resulting Karvonen HRR Training Zones Preview */}
      <section className="profile-card">
        <div className="profile-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="#06b6d4" />
            <h2 className="profile-card-title">Training Zones Preview (Karvonen HRR)</h2>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Resting HR: {restingHr} bpm • Max HR: {effectiveMaxHr} bpm
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
          {/* Zone 1 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8' }}>Zone 1</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#94a3b8' }}>&lt; {liveZones.z2[0]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>Recovery</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              Active warm-up &amp; recovery flush.
            </p>
          </div>

          {/* Zone 2 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#10b981' }}>Zone 2</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#10b981' }}>{liveZones.z2[0]}–{liveZones.z2[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#10b981', marginBottom: '0.2rem' }}>Aerobic Base</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              Fat oxidation &amp; capillary density.
            </p>
          </div>

          {/* Zone 3 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#06b6d4' }}>Zone 3</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#06b6d4' }}>{liveZones.z3[0]}–{liveZones.z3[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>Tempo</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              Steady rhythm &amp; marathon pace.
            </p>
          </div>

          {/* Zone 4 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b' }}>Zone 4</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f59e0b' }}>{liveZones.z4[0]}–{liveZones.z4[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f59e0b', marginBottom: '0.2rem' }}>Threshold (LT2)</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              Lactate clearance &amp; 1-hour race pace.
            </p>
          </div>

          {/* Zone 5 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ef4444' }}>Zone 5</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#ef4444' }}>&gt; {liveZones.z4[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ef4444', marginBottom: '0.2rem' }}>VO2 Max</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              Peak aerobic power &amp; fast intervals.
            </p>
          </div>
        </div>
      </section>

      {/* Database Backup & Cloud Sync Card */}
      <section className="overview-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <HardDrive size={22} style={{ color: 'var(--accent-cyan)' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.backup.cardTitle}
            </h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {t.backup.cardSubtitle}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginTop: '1.25rem' }}>
          {/* Column 1: Instant Download */}
          <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 10, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: '0.4rem' }}>
                <Download size={16} style={{ color: '#38bdf8' }} />
                <span>{t.backup.downloadSnapshot}</span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 1rem' }}>
                {t.backup.downloadSnapshotDesc}
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
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

            <button
              type="button"
              id="download-db-btn"
              onClick={handleDownloadSnapshot}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                background: 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                padding: '0.65rem 1rem',
                borderRadius: 8,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <Download size={15} />
              <span>{t.backup.downloadButton}</span>
            </button>
          </div>

          {/* Column 2: Automated Weekly Backup & Cloud Sync */}
          <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 10, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                <FolderSync size={16} style={{ color: 'var(--accent-emerald)' }} />
                <span>{t.backup.autoBackupTitle}</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  id="auto-backup-toggle"
                  checked={autoBackupEnabled}
                  onChange={e => handleSaveBackupSettings(e.target.checked, backupDirectory)}
                  style={{ accentColor: 'var(--accent-emerald)', cursor: 'pointer' }}
                />
                <span>{t.backup.autoBackupToggle}</span>
              </label>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                {t.backup.customFolderLabel}
              </label>
              <input
                type="text"
                id="backup-directory-input"
                value={backupDirectory}
                placeholder={t.backup.customFolderPlaceholder}
                onChange={e => setBackupDirectory(e.target.value)}
                onBlur={() => handleSaveBackupSettings(autoBackupEnabled, backupDirectory)}
                style={{
                  width: '100%',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                  boxSizing: 'border-box'
                }}
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.35rem 0 0', lineHeight: 1.35 }}>
                {t.backup.customFolderHint}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginTop: 'auto' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {t.backup.lastBackup}
                <strong style={{ color: 'var(--text-secondary)' }}>
                  {dbStatus?.settings?.lastBackupAt ? new Date(dbStatus.settings.lastBackupAt).toLocaleString() : t.backup.noBackupsYet}
                </strong>
              </div>

              <button
                type="button"
                id="backup-now-btn"
                onClick={handleBackupNow}
                disabled={isBackingUp}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  background: 'var(--accent-emerald)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.55rem 1rem',
                  borderRadius: 6,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: isBackingUp ? 'not-allowed' : 'pointer',
                  opacity: isBackingUp ? 0.7 : 1
                }}
              >
                <RefreshCw size={13} className={isBackingUp ? 'spinning' : ''} />
                <span>{isBackingUp ? 'Backing up...' : t.backup.backupNowButton}</span>
              </button>
            </div>

            {backupStatusMessage && (
              <div style={{
                fontSize: '0.78rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 6,
                background: backupStatusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                color: backupStatusMessage.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                border: `1px solid ${backupStatusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`
              }}>
                {backupStatusMessage.text}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
