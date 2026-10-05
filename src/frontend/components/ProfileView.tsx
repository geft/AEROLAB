import { resolveHeartRateProfile } from '../../shared/heart-rate.js';
import { getDefaultZones } from '../../backend/physiology/zones.js';
import type { ThresholdsResponse } from '../types/api.js';
import { getProfile, updateProfile } from '../api/client.js';
import { apiErrorMessage } from '../api/errors.js';
import React, { useState, useEffect, useMemo } from 'react';
import { Zap, Save, CheckCircle, AlertCircle,
  Activity, Flame, Calendar
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

interface ProfileViewProps {
  onOpenBackup?: () => void;
  onNavigateToSettings?: () => void;
  readOnly?: boolean;
}

export const ProfileView: React.FC<ProfileViewProps> = ({ readOnly = false }) => {
  const { t, format } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<{ error: unknown } | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form local state (unloaded initially; populated strictly from API)
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('Prefer not to say');
  const [restingHr, setRestingHr] = useState<number | string>('');

  // Loaded metadata
  const [currentThresholds, setCurrentThresholds] = useState<ThresholdsResponse['currentThresholds']>(null);
  const [observedPeakHr, setObservedPeakHr] = useState<ObservedPeakData | null>(null);
  const [tanakaMaxHr, setTanakaMaxHr] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProfile().then(data => {
      if (cancelled) return;
      if (data.profile) {
        const rawDob = data.profile.dob ? String(data.profile.dob).trim() : '';
        setDob(/^\d{4}-\d{2}$/.test(rawDob) ? `${rawDob}-15` : rawDob);
        setGender(data.profile.gender || 'Prefer not to say');
        if (data.profile.resting_hr !== undefined && data.profile.resting_hr !== null) {
          setRestingHr(Number(data.profile.resting_hr));
        }
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
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      console.error('Failed to load profile:', err);
      setLoadFailure({ error: err });
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const displayedStatus = statusMessage ?? (loadFailure ? { type: 'error', text: apiErrorMessage(t, loadFailure.error, t.profile.loadFailed) } : null);

  // Dynamic age calculation from DOB
  const computedAge = useMemo(() => {
    return dob ? calculateAgeFromDob(dob, 0) : null;
  }, [dob]);

  // Live Tanaka formula calculation based on current form age: 208 - 0.7 * age
  const liveTanaka = useMemo(() => {
    return computedAge ? Math.round(208 - 0.7 * computedAge) : tanakaMaxHr;
  }, [computedAge, tanakaMaxHr]);

  // Effective Max HR used across UI and zones
  const supportingRun = observedPeakHr && (liveTanaka == null || observedPeakHr.peakHr > liveTanaka) ? observedPeakHr : null;
  const effectiveMaxHr = supportingRun?.peakHr ?? liveTanaka;

  // Live Karvonen HRR Zone derivation for visual preview
  const liveZones = useMemo(() => {
    const resolved = resolveHeartRateProfile({ maxHr: effectiveMaxHr, restingHr: Number(restingHr), dob });
    const rhr = resolved.restingHr;
    const max = resolved.maxHr;
    const lt1 = (currentThresholds?.source === 'calibrated' ? currentThresholds.lt1Hr : null) || Math.round(rhr + (max - rhr) * 0.65);
    const lt2 = (currentThresholds?.source === 'calibrated' ? currentThresholds.lt2Hr : null) || Math.round(rhr + (max - rhr) * 0.82);

    return getDefaultZones(max, lt1, lt2, rhr);
  }, [restingHr, effectiveMaxHr, currentThresholds, dob]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsedRhr = Number(restingHr);
      if (!restingHr || isNaN(parsedRhr) || parsedRhr < 30 || parsedRhr > 120) {
        setStatusMessage({ type: 'error', text: t.profile.restingHrRangeError });
        return;
      }

      setSaving(true);
      setStatusMessage(null);

      const payload = {
        dob,
        gender,
        age: computedAge,
        resting_hr: Number(restingHr)
      };

      const resData = await updateProfile(payload);

      setStatusMessage({ type: 'success', text: resData.syncScheduled ? t.profile.savedRecomputing : t.profile.saved });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err) {
      setStatusMessage({ type: 'error', text: apiErrorMessage(t, err, t.profile.saveFailed) });
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
  const lt1HrDisplay = currentThresholds?.lt1Range
    ? `${currentThresholds.lt1Range[0]}–${currentThresholds.lt1Range[1]}`
    : String(currentThresholds?.lt1Hr ?? '—');

  return (
    <div className="profile-view-container">
      {displayedStatus && (
        <div className={`profile-status-banner ${displayedStatus.type}`}>
          {displayedStatus.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{displayedStatus.text}</span>
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
            {t.profile.readOnlyBaseline}
          </span>
        </div>

        <div className="thresholds-reference-grid">
          <div className="threshold-ref-box lt1">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="threshold-ref-label">{t.stats.aerobicTurnpoint}</span>
              <span className="threshold-tag-pill lt1">{t.progress.filterLt1}</span>
            </div>
            <div className="threshold-ref-val">
              {lt1Pace}
            </div>
            <span className="threshold-ref-sub">
              {t.progress.zone2Ceiling}: ~{lt1HrDisplay} bpm
            </span>
          </div>

          <div className="threshold-ref-box lt2">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="threshold-ref-label">{t.stats.anaerobicThreshold}</span>
              <span className="threshold-tag-pill lt2">{t.progress.filterLt2}</span>
            </div>
            <div className="threshold-ref-val">
              {lt2Pace}
            </div>
            <span className="threshold-ref-sub">
              {t.profile.thresholdHeartRate}: ~{currentThresholds?.lt2Hr ?? '—'} bpm
            </span>
          </div>

          <div className="threshold-ref-box economy">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="threshold-ref-label">{t.browse.efficiencyFactor}</span>
              <span className="threshold-tag-pill economy">{t.profile.efficiencyBadge}</span>
            </div>
            <div className="threshold-ref-val">
              {currentThresholds?.baselineEconomyEf ? Number(currentThresholds.baselineEconomyEf).toFixed(2) : '—'}
            </div>
            <span className="threshold-ref-sub">{t.browse.metersPerBeat}</span>
          </div>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.75rem 0 0' }}>
          {t.progress.thresholdEstimateNote}
        </p>
      </section>

      {/* Main Profile Form */}
      {!readOnly && <form onSubmit={handleSave} className="profile-settings-form">
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
            </div>

            {/* 2. Current Age */}
            <div className="form-group">
              <label className="form-label">{t.profile.age}</label>
              <div className="form-input age-summary">
                <span className="age-summary-value">
                  {dob ? `${computedAge} ${t.profile.yearsUnit}` : '—'}
                </span>
                <span className="age-summary-max">
                  {format(t.profile.tanakaMaxShort, { hr: liveTanaka ?? '—' })}
                </span>
              </div>
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
            </div>

            {/* 4. Resting Heart Rate */}
            <div className="form-group">
              <label className="form-label">{t.profile.restingHr}</label>
              <input
                type="number"
                className="form-input"
                value={restingHr}
                onChange={e => setRestingHr(Number(e.target.value))}
                placeholder={t.profile.restingHrPlaceholder}
                min="35"
                max="100"
              />
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
                  background: supportingRun ? '#10b981' : '#38bdf8',
                  boxShadow: supportingRun ? '0 0 8px rgba(16, 185, 129, 0.7)' : '0 0 8px rgba(56, 189, 248, 0.7)'
                }} />
                <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {supportingRun ? t.profile.calibratedFromActualRunData : t.profile.estimatedBaselineNoHardEfforts}
                </span>
              </div>
              <span style={{ fontSize: '1.45rem', fontWeight: 800, color: '#38bdf8' }}>
                {effectiveMaxHr} bpm
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {supportingRun
                ? format(t.profile.observedPeakNote, {
                    hr: supportingRun.peakHr,
                    activity: supportingRun.activityName,
                    date: supportingRun.activityDate
                  })
                : format(t.profile.tanakaFormulaNote, { age: computedAge ?? '—', hr: liveTanaka ?? '—' })}
            </p>
          </div>
          <div className="profile-form-actions">
            <button type="submit" className="save-profile-btn" disabled={saving}>
              <Save size={16} />
              {saving ? t.common.loading : t.profile.saveProfile}
            </button>
          </div>
        </section>
        </fieldset>
      </form>}

      {/* 3. Resulting Karvonen HRR Training Zones Preview */}
      <section className="profile-card">
        <div className="profile-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} color="#38bdf8" />
            <h2 className="profile-card-title">{t.profile.trainingZonesPreview}</h2>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {format(t.profile.zonesHeaderSummary, { resting: restingHr ?? '—', max: effectiveMaxHr ?? '—' })}
          </span>
        </div>

        <div className="profile-training-zones-grid">
          {/* Zone 1 */}
          <div className="profile-training-zone-card" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="profile-training-zone-header">
              <span className="profile-training-zone-title" style={{ color: '#94a3b8' }}>{t.profile.zone1Title}</span>
              <span className="profile-training-zone-range" style={{ color: '#94a3b8' }}>&lt; {liveZones.z2[0]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{t.profile.zone1Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone1Desc}
            </p>
          </div>

          {/* Zone 2 */}
          <div className="profile-training-zone-card" style={{ background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
            <div className="profile-training-zone-header">
              <span className="profile-training-zone-title" style={{ color: '#34d399' }}>{t.profile.zone2Title}</span>
              <span className="profile-training-zone-range" style={{ color: '#34d399' }}>{liveZones.z2[0]}–{liveZones.z2[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#34d399', marginBottom: '0.2rem' }}>{t.profile.zone2Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone2Desc}
            </p>
          </div>

          {/* Zone 3 */}
          <div className="profile-training-zone-card" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
            <div className="profile-training-zone-header">
              <span className="profile-training-zone-title" style={{ color: '#38bdf8' }}>{t.profile.zone3Title}</span>
              <span className="profile-training-zone-range" style={{ color: '#38bdf8' }}>{liveZones.z3[0]}–{liveZones.z3[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{t.profile.zone3Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone3Desc}
            </p>
          </div>

          {/* Zone 4 */}
          <div className="profile-training-zone-card" style={{ background: 'rgba(245, 158, 11, 0.08)', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
            <div className="profile-training-zone-header">
              <span className="profile-training-zone-title" style={{ color: '#fbbf24' }}>{t.profile.zone4Title}</span>
              <span className="profile-training-zone-range" style={{ color: '#fbbf24' }}>{liveZones.z4[0]}–{liveZones.z4[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fbbf24', marginBottom: '0.2rem' }}>{t.profile.zone4Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone4Desc}
            </p>
          </div>

          {/* Zone 5 */}
          <div className="profile-training-zone-card" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <div className="profile-training-zone-header">
              <span className="profile-training-zone-title" style={{ color: '#f87171' }}>{t.profile.zone5Title}</span>
              <span className="profile-training-zone-range" style={{ color: '#f87171' }}>&gt; {liveZones.z4[1]} bpm</span>
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171', marginBottom: '0.2rem' }}>{t.profile.zone5Name}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {t.profile.zone5Desc}
            </p>
          </div>
        </div>
      </section>

    </div>
  );
};
