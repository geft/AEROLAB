import React, { useState, useEffect, useMemo } from 'react';
import {
  User, Heart, Zap, Save, CheckCircle, AlertCircle, Info, ShieldCheck,
  Activity, Flame, Calendar, HardDrive, FolderSync
} from 'lucide-react';
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

interface ProfileViewProps {
  onOpenBackup?: () => void;
  onNavigateToSettings?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ onOpenBackup, onNavigateToSettings }) => {
  const { t, language } = useTranslation();
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

  useEffect(() => {
    fetchProfile();
  }, []);

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

  const lt1Pace = currentThresholds?.lt1PaceSecKm ? formatPace(currentThresholds.lt1PaceSecKm) : '--';
  const lt2Pace = currentThresholds?.lt2PaceSecKm
    ? formatPace(currentThresholds.lt2PaceSecKm)
    : (currentThresholds?.lt1PaceSecKm ? `${formatPace(Math.round(currentThresholds.lt1PaceSecKm * 0.86))} (Est.)` : '--');

  return (
    <div className="profile-view-container">
      {/* Top Banner Header */}
      <div className="profile-header-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div className="profile-avatar-circle">
            <Heart size={28} color="#06b6d4" />
          </div>
          <div>
            <h1 className="profile-header-title">{t.profile.title}</h1>
            <p className="profile-header-subtitle">
              {t.profile.subtitle}
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
          {saving ? t.common.loading : t.profile.saveProfile}
        </button>
      </div>

      {statusMessage && (
        <div className={`profile-status-banner ${statusMessage.type}`}>
          {statusMessage.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* 1. Inferred Thresholds Card (Non-Editable Reference) */}
      <section className="profile-card thresholds-showcase-card" style={{ marginBottom: '1.5rem' }}>
        <div className="profile-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Zap size={20} color="#f59e0b" />
            <h2 className="profile-card-title">{t.profile.thresholdsCardTitle}</h2>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {language === 'zh' ? '根据跑步记录自动推算 • 非手动编辑' : 'Calibrated from running workouts • Read-only baseline'}
          </span>
        </div>

        <div className="thresholds-reference-grid">
          <div className="threshold-ref-box lt1">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="threshold-ref-label">{t.stats.aerobicTurnpoint}</span>
              <span className="threshold-tag-pill lt1">LT1 BASE</span>
            </div>
            <div className="threshold-ref-val">
              {lt1Pace}
            </div>
            <span className="threshold-ref-sub">
              {t.progress.zone2Ceiling}: ~{currentThresholds?.lt1Hr || 145} bpm
            </span>
          </div>

          <div className="threshold-ref-box lt2">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="threshold-ref-label">{t.stats.anaerobicThreshold}</span>
              <span className="threshold-tag-pill lt2">LT2 THRESHOLD</span>
            </div>
            <div className="threshold-ref-val">
              {lt2Pace}
            </div>
            <span className="threshold-ref-sub">
              {language === 'zh' ? '乳酸阈值心率' : 'Threshold Heart Rate'}: ~{currentThresholds?.lt2Hr || 165} bpm
            </span>
          </div>

          <div className="threshold-ref-box economy">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="threshold-ref-label">{t.browse.efficiencyFactor}</span>
              <span className="threshold-tag-pill economy">EFFICIENCY</span>
            </div>
            <div className="threshold-ref-val">
              {currentThresholds?.baselineEconomyEf ? Number(currentThresholds.baselineEconomyEf).toFixed(2) : '1.14'}
            </div>
            <span className="threshold-ref-sub">{t.browse.metersPerBeat}</span>
          </div>
        </div>
      </section>

      {/* Main Profile Form */}
      <form onSubmit={handleSave} className="profile-settings-form">
        {/* Cardiovascular Baselines & RHR Section */}
        <section className="profile-card">
          <div className="profile-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Calendar size={18} color="#06b6d4" />
              <h2 className="profile-card-title">{t.profile.personalInfo}</h2>
            </div>
          </div>

          <div className="profile-form-grid">
            {/* 1. Date of Birth */}
            <div className="form-group">
              <label className="form-label" htmlFor="dob-input">{t.profile.dob}</label>
              <input
                id="dob-input"
                type="date"
                className="form-input"
                value={dob}
                onChange={e => setDob(e.target.value)}
              />
              <span className="form-hint">{t.profile.dob}</span>
            </div>

            {/* 2. Current Age */}
            <div className="form-group">
              <label className="form-label">{t.profile.age}</label>
              <div className="form-input" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(255, 255, 255, 0.02)',
                userSelect: 'none'
              }}>
                <span style={{ fontWeight: 700, color: '#38bdf8' }}>
                  {dob ? `${computedAge} ${language === 'zh' ? '岁' : 'yrs'}` : '—'}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {language === 'zh' ? `Tanaka预估: ~${liveTanaka} bpm` : `Tanaka max: ~${liveTanaka} bpm`}
                </span>
              </div>
              <span className="form-hint">{t.profile.age}</span>
            </div>

            {/* 3. Biological Gender */}
            <div className="form-group">
              <label className="form-label">{t.profile.gender}</label>
              <select
                className="form-input"
                value={gender}
                onChange={e => setGender(e.target.value)}
              >
                <option value="Prefer not to say">{t.profile.genderOther}</option>
                <option value="Female">{t.profile.genderFemale}</option>
                <option value="Male">{t.profile.genderMale}</option>
              </select>
              <span className="form-hint">{t.profile.gender}</span>
            </div>

            {/* 4. Resting Heart Rate */}
            <div className="form-group">
              <label className="form-label">{t.profile.restingHr}</label>
              <input
                type="number"
                className="form-input"
                value={restingHr}
                onChange={e => setRestingHr(Number(e.target.value))}
                placeholder="e.g. 55 bpm"
                min="35"
                max="100"
              />
              <span className="form-hint">{t.profile.restingHr}</span>
            </div>
          </div>
        </section>

        {/* Maximum Heart Rate Engine */}
        <section className="profile-card">
          <div className="profile-card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Flame size={18} color="#ef4444" />
              <h2 className="profile-card-title">{t.profile.maxHr}</h2>
            </div>
          </div>

          {/* Mode Selection Tabs */}
          {/* Mode Selection Tabs */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <button
              type="button"
              className={`profile-mode-tab ${isAutoMaxHr ? 'active' : ''}`}
              onClick={() => setIsAutoMaxHr(true)}
            >
              <div className="profile-mode-tab-title">
                {t.profile.autoMaxHrNote}
              </div>
              <div className="profile-mode-tab-subtitle">
                {observedPeakHr ? `${t.profile.observedPeak}: ${observedPeakHr.peakHr} bpm` : `${t.profile.tanakaFallback}: ${liveTanaka} bpm`}
              </div>
            </button>

            <button
              type="button"
              className={`profile-mode-tab ${!isAutoMaxHr ? 'active' : ''}`}
              onClick={() => setIsAutoMaxHr(false)}
            >
              <div className="profile-mode-tab-title">
                {t.profile.manualMaxHrNote}
              </div>
              <div className="profile-mode-tab-subtitle">
                {t.profile.lockCustomMaxHr}
              </div>
            </button>
          </div>

          {/* Auto-Infer Display */}
          {isAutoMaxHr ? (
            <div style={{
              padding: '0.95rem 1.1rem',
              borderRadius: 8,
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.3)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: observedPeakHr ? '#10b981' : '#38bdf8',
                    boxShadow: observedPeakHr ? '0 0 8px rgba(16, 185, 129, 0.7)' : '0 0 8px rgba(56, 189, 248, 0.7)'
                  }} />
                  <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {observedPeakHr ? t.profile.calibratedFromActualRunData : t.profile.estimatedBaselineNoHardEfforts}
                  </span>
                </div>
                <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#38bdf8' }}>
                  {effectiveMaxHr} bpm
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                {observedPeakHr
                  ? (language === 'zh'
                      ? `在 ${observedPeakHr.activityName} (${observedPeakHr.activityDate}) 中观测到峰值 ${observedPeakHr.peakHr} bpm。`
                      : `Peak of ${observedPeakHr.peakHr} bpm observed during ${observedPeakHr.activityName} (${observedPeakHr.activityDate}).`)
                  : (language === 'zh'
                      ? `Tanaka公式：208 - (0.7 × ${computedAge}) = ${liveTanaka} bpm，待记录高强度间歇训练后自动更新。`
                      : `Tanaka formula: 208 - (0.7 × ${computedAge}) = ${liveTanaka} bpm until hard interval runs are logged.`)}
              </p>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" htmlFor="manual-max-hr">{t.profile.manualMaxHrLabel}</label>
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
                {t.profile.manualMaxHrHint}
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
                aria-label={t.profile.iDontKnowMaxHr}
              />
              <span>{t.profile.autoCalibrateCheckbox}</span>
            </label>
          </div>
        </section>
      </form>

      {/* 3. Resulting Karvonen HRR Training Zones Preview */}
      <section className="profile-card">
        <div className="profile-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="#38bdf8" />
            <h2 className="profile-card-title">{t.profile.trainingZonesPreview}</h2>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {language === 'zh'
              ? `静息心率: ${restingHr} bpm • 最大心率: ${effectiveMaxHr} bpm`
              : `Resting HR: ${restingHr} bpm • Max HR: ${effectiveMaxHr} bpm`}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
          {/* Zone 1 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8' }}>{t.profile.zone1Title}</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#94a3b8' }}>&lt; {liveZones.z2[0]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{t.profile.zone1Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone1Desc}
            </p>
          </div>

          {/* Zone 2 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#34d399' }}>{t.profile.zone2Title}</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#34d399' }}>{liveZones.z2[0]}–{liveZones.z2[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#34d399', marginBottom: '0.2rem' }}>{t.profile.zone2Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone2Desc}
            </p>
          </div>

          {/* Zone 3 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8' }}>{t.profile.zone3Title}</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#38bdf8' }}>{liveZones.z3[0]}–{liveZones.z3[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{t.profile.zone3Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone3Desc}
            </p>
          </div>

          {/* Zone 4 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fbbf24' }}>{t.profile.zone4Title}</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fbbf24' }}>{liveZones.z4[0]}–{liveZones.z4[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fbbf24', marginBottom: '0.2rem' }}>{t.profile.zone4Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone4Desc}
            </p>
          </div>

          {/* Zone 5 */}
          <div style={{ padding: '0.85rem', borderRadius: 8, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f87171' }}>{t.profile.zone5Title}</span>
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f87171' }}>&gt; {liveZones.z4[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171', marginBottom: '0.2rem' }}>{t.profile.zone5Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone5Desc}
            </p>
          </div>
        </div>
      </section>

      {/* Database Backup & Cloud Sync Quick Access -> Navigate to Settings */}
      {(onNavigateToSettings || onOpenBackup) && (
        <section className="overview-card" style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <HardDrive size={22} style={{ color: 'var(--accent-cyan)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.backup.cardTitle}
              </h3>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {t.backup.cardSubtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            id="profile-open-backup-btn"
            onClick={() => {
              if (onNavigateToSettings) onNavigateToSettings();
              else if (onOpenBackup) onOpenBackup();
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(6, 182, 212, 0.12)',
              color: 'var(--accent-cyan)',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              padding: '0.55rem 1.15rem',
              borderRadius: 8,
              fontSize: '0.825rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <FolderSync size={15} />
            <span>{t.profile.openSettingsAndBackups}</span>
          </button>
        </section>
      )}
    </div>
  );
};
