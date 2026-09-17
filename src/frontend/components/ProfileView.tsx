import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  User, Heart, Zap, Save, CheckCircle, AlertCircle, Info, ShieldCheck,
  Activity, Flame, Calendar, HardDrive, Download, FolderSync, RefreshCw,
  Key, UploadCloud, FileUp, LogIn, LogOut, CheckCircle2
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

  // Google Auth & Cloud Sync state
  const [googleStatus, setGoogleStatus] = useState<any>(null);
  const [isSyncingGdrive, setIsSyncingGdrive] = useState(false);
  const [gdriveStatusMessage, setGdriveStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [gdriveBackups, setGdriveBackups] = useState<any[]>([]);
  const [showGdriveRestoreList, setShowGdriveRestoreList] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);

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
        if (data.googleStatus) {
          setGoogleStatus(data.googleStatus);
        }
      }
    } catch {}
  };

  const fetchGoogleStatus = async () => {
    try {
      const res = await fetch('/api/auth/google/status');
      if (res.ok) {
        const data = await res.json();
        setGoogleStatus(data.status);
      }
    } catch {}
  };

  useEffect(() => {
    fetchProfile();
    fetchDbStatus();
    fetchGoogleStatus();
  }, []);

  const handleDownloadSnapshot = () => {
    window.open('/api/database/download', '_blank');
  };

  const handleGoogleConnect = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setShowCredentialsModal(true);
        setGdriveStatusMessage({ type: 'error', text: data.error || 'Please configure your Google OAuth Client ID first.' });
        return;
      }
      const data = await res.json();
      if (data.url) {
        const popup = window.open(data.url, 'google_oauth_popup', 'width=540,height=650');
        const handleMessage = (e: MessageEvent) => {
          if (e.data?.type === 'AEROLAB_GOOGLE_AUTH_SUCCESS') {
            window.removeEventListener('message', handleMessage);
            fetchGoogleStatus();
            fetchDbStatus();
          }
        };
        window.addEventListener('message', handleMessage);
      }
    } catch (err: any) {
      setGdriveStatusMessage({ type: 'error', text: err.message || 'Failed to connect to Google.' });
    }
  };

  const handleGoogleDisconnect = async () => {
    try {
      await fetch('/api/auth/google/disconnect', { method: 'POST' });
      fetchGoogleStatus();
      fetchDbStatus();
    } catch {}
  };

  const handleSyncGdriveNow = async () => {
    try {
      setIsSyncingGdrive(true);
      setGdriveStatusMessage(null);
      const res = await fetch('/api/database/backup-gdrive', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google Drive backup failed');
      setGdriveStatusMessage({ type: 'success', text: t.backup.syncSuccess });
      fetchDbStatus();
    } catch (err: any) {
      setGdriveStatusMessage({ type: 'error', text: `${t.backup.syncFailed}: ${err.message}` });
    } finally {
      setIsSyncingGdrive(false);
    }
  };

  const handleSaveCredentials = async () => {
    try {
      const res = await fetch('/api/auth/google/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientIdInput, clientSecret: clientSecretInput })
      });
      if (res.ok) {
        setShowCredentialsModal(false);
        fetchGoogleStatus();
        setGdriveStatusMessage({ type: 'success', text: 'Google credentials saved!' });
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to save credentials');
      }
    } catch (err: any) {
      alert(err.message || 'Network error saving credentials');
    }
  };

  const handleRestoreFile = async (file: File) => {
    if (!file) return;
    if (!window.confirm('Are you sure you want to restore this database? A safety backup of your current database will be created first.')) return;
    setIsRestoring(true);
    setRestoreMessage(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1] || (reader.result as string);
          const res = await fetch('/api/database/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64 })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || t.backup.restoreFailed);
          setRestoreMessage({ type: 'success', text: `${t.backup.restoreSuccess} (${data.activityCount} runs)` });
          fetchProfile();
          fetchDbStatus();
        } catch (err: any) {
          setRestoreMessage({ type: 'error', text: `${t.backup.restoreFailed}: ${err.message}` });
        } finally {
          setIsRestoring(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setRestoreMessage({ type: 'error', text: err.message });
      setIsRestoring(false);
    }
  };

  const handleLoadGdriveBackups = async () => {
    try {
      setShowGdriveRestoreList(true);
      const res = await fetch('/api/database/gdrive-backups');
      if (res.ok) {
        const data = await res.json();
        setGdriveBackups(data.backups || []);
      }
    } catch {}
  };

  const handleRestoreGdrive = async (fileId: string) => {
    if (!window.confirm('Restore this database snapshot from Google Drive? A safety backup will be created first.')) return;
    setIsRestoring(true);
    setRestoreMessage(null);
    try {
      const res = await fetch('/api/database/restore-gdrive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.backup.restoreFailed);
      setRestoreMessage({ type: 'success', text: `${t.backup.restoreSuccess} (${data.activityCount} runs)` });
      setShowGdriveRestoreList(false);
      fetchProfile();
      fetchDbStatus();
    } catch (err: any) {
      setRestoreMessage({ type: 'error', text: `${t.backup.restoreFailed}: ${err.message}` });
    } finally {
      setIsRestoring(false);
    }
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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

          <button
            type="button"
            onClick={() => setShowCredentialsModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'var(--bg-surface)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              padding: '0.4rem 0.75rem',
              borderRadius: 8,
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            <Key size={13} />
            <span>{t.backup.configureCredentials}</span>
          </button>
        </div>

        {restoreMessage && (
          <div style={{
            margin: '1rem 0',
            padding: '0.65rem 1rem',
            borderRadius: 8,
            fontSize: '0.82rem',
            background: restoreMessage.type === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${restoreMessage.type === 'success' ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            color: restoreMessage.type === 'success' ? '#4ade80' : '#f87171',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {restoreMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{restoreMessage.text}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', marginTop: '1.25rem' }}>
          {/* Column 1: Instant Download & Restore */}
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

            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                id="download-db-btn"
                onClick={handleDownloadSnapshot}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  background: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  padding: '0.6rem 0.85rem',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Download size={14} />
                <span>{t.backup.downloadButton}</span>
              </button>

              <input
                type="file"
                ref={restoreFileInputRef}
                accept=".db,.sqlite"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleRestoreFile(file);
                }}
              />

              <button
                type="button"
                onClick={() => restoreFileInputRef.current?.click()}
                disabled={isRestoring}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  background: 'rgba(168, 85, 247, 0.12)',
                  color: '#c084fc',
                  border: '1px solid rgba(168, 85, 247, 0.35)',
                  padding: '0.6rem 0.85rem',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: isRestoring ? 'wait' : 'pointer'
                }}
              >
                <FileUp size={14} />
                <span>{isRestoring ? t.backup.restoring : t.backup.restoreFileButton}</span>
              </button>
            </div>
          </div>

          {/* Column 2: Google Drive Cloud Sync & Google SSO */}
          <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 10, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  <UploadCloud size={16} style={{ color: 'var(--accent-emerald)' }} />
                  <span>{t.backup.googleTitle}</span>
                </div>
                {googleStatus?.isConnected && (
                  <button
                    type="button"
                    onClick={handleGoogleDisconnect}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: '0.72rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem'
                    }}
                  >
                    <LogOut size={12} />
                    <span>{t.backup.disconnect}</span>
                  </button>
                )}
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 1rem' }}>
                {t.backup.googleDesc}
              </p>

              {googleStatus?.isConnected ? (
                <div style={{ background: 'var(--bg-card)', padding: '0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    {googleStatus.picture ? (
                      <img src={googleStatus.picture} alt="Avatar" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', fontSize: '0.75rem', fontWeight: 700 }}>
                        {googleStatus.name ? googleStatus.name[0] : 'G'}
                      </div>
                    )}
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {googleStatus.email}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <CheckCircle2 size={11} />
                        <span>Connected to Google Drive</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleConnect}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.6rem',
                    background: '#ffffff',
                    color: '#1f2937',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    padding: '0.65rem 1rem',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginBottom: '1rem',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  </svg>
                  <span>{t.backup.signInWithGoogle}</span>
                </button>
              )}
            </div>

            {googleStatus?.isConnected && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={handleSyncGdriveNow}
                    disabled={isSyncingGdrive}
                    style={{
                      flex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      background: 'var(--accent-emerald)',
                      color: '#ffffff',
                      border: 'none',
                      padding: '0.55rem 0.85rem',
                      borderRadius: 6,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: isSyncingGdrive ? 'wait' : 'pointer'
                    }}
                  >
                    <RefreshCw size={13} className={isSyncingGdrive ? 'spinning' : ''} />
                    <span>{isSyncingGdrive ? 'Syncing…' : t.backup.syncToGdriveNow}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleLoadGdriveBackups}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'var(--bg-card)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                      padding: '0.55rem 0.75rem',
                      borderRadius: 6,
                      fontSize: '0.75rem',
                      cursor: 'pointer'
                    }}
                  >
                    <span>{t.backup.restoreFromGdrive}</span>
                  </button>
                </div>

                {showGdriveRestoreList && (
                  <div style={{ marginTop: '0.5rem', background: 'var(--bg-card)', borderRadius: 8, padding: '0.5rem', border: '1px solid var(--border-subtle)', maxHeight: 140, overflowY: 'auto' }}>
                    {gdriveBackups.length === 0 ? (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem' }}>
                        No backups found on Google Drive
                      </div>
                    ) : (
                      gdriveBackups.map(b => (
                        <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.5rem', fontSize: '0.72rem', borderBottom: '1px solid var(--border-subtle)' }}>
                          <span>{b.name}</span>
                          <button
                            type="button"
                            onClick={() => handleRestoreGdrive(b.id)}
                            style={{ background: 'var(--accent-emerald)', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 6px', fontSize: '0.7rem', cursor: 'pointer' }}
                          >
                            Restore
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {gdriveStatusMessage && (
              <div style={{
                fontSize: '0.75rem',
                padding: '0.45rem 0.65rem',
                borderRadius: 6,
                background: gdriveStatusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(244, 63, 94, 0.12)',
                color: gdriveStatusMessage.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                border: `1px solid ${gdriveStatusMessage.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`
              }}>
                {gdriveStatusMessage.text}
              </div>
            )}
          </div>

          {/* Column 3: Local Backup Folder & Cadence */}
          <div style={{ background: 'var(--bg-surface)', padding: '1.25rem', borderRadius: 10, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  <FolderSync size={16} style={{ color: '#38bdf8' }} />
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
                    padding: '0.45rem 0.75rem',
                    fontSize: '0.78rem',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {t.backup.lastBackup}
                  <strong style={{ color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>
                    {dbStatus?.settings?.lastBackupAt ? new Date(dbStatus.settings.lastBackupAt).toLocaleDateString() : t.backup.noBackupsYet}
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
                    padding: '0.5rem 0.85rem',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: isBackingUp ? 'not-allowed' : 'pointer'
                  }}
                >
                  <RefreshCw size={12} className={isBackingUp ? 'spinning' : ''} />
                  <span>{isBackingUp ? 'Backing up...' : t.backup.backupNowButton}</span>
                </button>
              </div>

              {backupStatusMessage && (
                <div style={{
                  fontSize: '0.75rem',
                  padding: '0.45rem 0.65rem',
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
        </div>
      </section>

      {/* Google OAuth Credentials Modal */}
      {showCredentialsModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: '1.5rem',
            maxWidth: 480,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)'
          }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.backup.credentialsModalTitle}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, margin: '0 0 1rem' }}>
              Create a free OAuth 2.0 Web Client in Google Cloud Console with redirect URI <code>http://localhost:3001/api/auth/google/callback</code>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  {t.backup.clientIdLabel}
                </label>
                <input
                  type="text"
                  value={clientIdInput}
                  onChange={e => setClientIdInput(e.target.value)}
                  placeholder="e.g. 1234567890-xxx.apps.googleusercontent.com"
                  style={{
                    width: '100%',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  {t.backup.clientSecretLabel}
                </label>
                <input
                  type="password"
                  value={clientSecretInput}
                  onChange={e => setClientSecretInput(e.target.value)}
                  placeholder="e.g. GOCSPX-xxxxxxxx"
                  style={{
                    width: '100%',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                onClick={() => setShowCredentialsModal(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  padding: '0.5rem 1rem',
                  borderRadius: 6,
                  fontSize: '0.8rem',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCredentials}
                style={{
                  background: '#38bdf8',
                  color: '#0f172a',
                  border: 'none',
                  padding: '0.5rem 1.25rem',
                  borderRadius: 6,
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {t.backup.saveCredentials}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
