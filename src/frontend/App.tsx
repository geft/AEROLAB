import { SnapshotLoadingScreen } from './components/SnapshotLoadingScreen.js';
import { useActivityRevision, invalidateActivityData } from './features/activity-revision.js';
import { useMaintenanceRefresh } from './features/useMaintenanceRefresh.js';
import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type { ActivityUpdate } from './types/api.js';
import { Navbar, TabType } from './components/Navbar';
import { BrowseView, ActivitySummary } from './components/BrowseView';
import { Footer } from './components/Footer';
import { Terminal, RefreshCw, TriangleAlert } from 'lucide-react';
import { clientLogger } from './utils/clientLogger';
import { useTranslation } from './i18n/LanguageContext';
import { getProfile, listActivities } from './api/client.js';
import { getSnapshotMetadata } from './api/client.js';

const SNAPSHOT_MODE = import.meta.env.VITE_AEROLAB_TARGET === 'snapshot';

// Code-split secondary views, modals, and heavy drawers for instant first paint
const ProgressView = lazy(() => import('./components/ProgressView').then(m => ({ default: m.ProgressView })));
const StatsView = lazy(() => import('./components/StatsView').then(m => ({ default: m.StatsView })));
const ProfileView = lazy(() => import('./components/ProfileView').then(m => ({ default: m.ProfileView })));
const SettingsView = SNAPSHOT_MODE ? null : lazy(() => import('./components/SettingsView').then(m => ({ default: m.SettingsView })));
const UploadModal = SNAPSHOT_MODE ? null : lazy(() => import('./components/UploadModal').then(m => ({ default: m.UploadModal })));
const BackupModal = SNAPSHOT_MODE ? null : lazy(() => import('./components/BackupModal').then(m => ({ default: m.BackupModal })));
const OnboardingPage = SNAPSHOT_MODE ? null : lazy(() => import('./components/OnboardingPage').then(m => ({ default: m.OnboardingPage })));

// Developer diagnostics are excluded from release bundles. Vite statically
// replaces `import.meta.env.DEV` with `false` in production, so this ternary
// resolves to null and the component (plus its code-split chunk) is dropped.
const DevDiagnosticsDrawer = import.meta.env.DEV
  ? lazy(() => import('./components/DevDiagnosticsDrawer').then(m => ({ default: m.DevDiagnosticsDrawer })))
  : null;

export function resolveSelectedActivityId(
  activities: ActivitySummary[],
  preferredSelectedId?: string,
  selectedActivityId?: string | null
): string | null {
  if (preferredSelectedId && activities.some(activity => activity.id === preferredSelectedId)) {
    return preferredSelectedId;
  }
  if (selectedActivityId && activities.some(activity => activity.id === selectedActivityId)) {
    return selectedActivityId;
  }
  return activities[0]?.id ?? null;
}

export const App: React.FC = () => {
  useMaintenanceRefresh(!SNAPSHOT_MODE);
  const { t, format, formatDate } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const activityDataVersion = useActivityRevision();
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [isBackupOpen, setIsBackupOpen] = useState<boolean>(false);
  // null = still loading, false = needs onboarding, true = ready
  const [isConfigured, setIsConfigured] = useState<boolean | null>(SNAPSHOT_MODE ? true : null);
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState<string | null>(null);
  const [snapshotReady, setSnapshotReady] = useState<boolean>(!SNAPSHOT_MODE);
  const [loading, setLoading] = useState<boolean>(true);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);

  // Theme state: persisted in localStorage, defaults to dark
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('aerolab_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  });
  // Dev diagnostics state stays inert in release builds: the drawer resolves to
  // null and the shortcut listener below is never attached.
  const [isDevDrawerOpen, setIsDevDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setIsDevDrawerOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aerolab_theme', theme);
  }, [theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab]);

  useEffect(() => {
    if (!SNAPSHOT_MODE) return;
    const root = document.documentElement;
    const body = document.body;
    const previousRootBehavior = root.style.overscrollBehaviorY;
    const previousBodyBehavior = body.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'none';
    body.style.overscrollBehaviorY = 'none';
    return () => {
      root.style.overscrollBehaviorY = previousRootBehavior;
      body.style.overscrollBehaviorY = previousBodyBehavior;
    };
  }, []);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const checkProfileConfigured = useCallback(() => getProfile().then(data => {
    const p = data?.profile;
    const configured = data?.isConfigured === true && p?.is_configured !== 0 && !!p?.resting_hr && (!!p?.dob || !!p?.age);
    setIsConfigured(configured);
    setProfileLoadFailed(false);
    localStorage.setItem('aerolab_profile_configured', String(configured));
  }).catch(err => {
    console.error('Failed to check profile configuration status:', err);
    setProfileLoadFailed(true);
    setLoading(false);
    setIsConfigured(localStorage.getItem('aerolab_profile_configured') === 'true');
  }), []);

  const fetchActivities = useCallback((preferredSelectedId?: string) => listActivities().then(data => {
    const list = data.activities;
    setActivities(list);
    setHistoryLoadFailed(false);
    setSelectedActivityId(current => resolveSelectedActivityId(list, preferredSelectedId, current));
  }).catch(err => {
    console.error('Failed to load activities:', err);
    setHistoryLoadFailed(true);
    clientLogger.error('App', 'Failed to load activities', { error: String(err) });
  }).finally(() => setLoading(false)), []);

  useEffect(() => {
    if (SNAPSHOT_MODE) {
      void Promise.all([getSnapshotMetadata(), listActivities()])
        .then(([metadata, data]) => {
          setSnapshotGeneratedAt(metadata.generatedAt);
          setActivities(data.activities);
          setLoading(false);
          setSelectedActivityId(resolveSelectedActivityId(data.activities));
        })
        .catch(error => {
          console.error('Failed to load snapshot:', error);
          setHistoryLoadFailed(true);
          setLoading(false);
          clientLogger.error('App', 'Failed to load snapshot', { error: String(error) });
        })
        .finally(() => setSnapshotReady(true));
      return;
    }
    void checkProfileConfigured();
  }, [checkProfileConfigured]);

  useEffect(() => {
    if (!SNAPSHOT_MODE && isConfigured === true) {
      fetchActivities();
    }
  }, [isConfigured, fetchActivities]);

  useEffect(() => {
    if (activityDataVersion > 0 && isConfigured === true) void fetchActivities();
  }, [activityDataVersion, isConfigured, fetchActivities]);

  const handleUploadSuccess = async (importedActivityId?: string) => {
    setIsUploadOpen(false);
    await checkProfileConfigured();
    await fetchActivities(importedActivityId);
    if (importedActivityId) {
      setSelectedActivityId(importedActivityId);
      setActiveTab('browse');
    }
  };

  const handleActivityUpdated = useCallback((updatedActivity: ActivityUpdate) => {
    setActivities(prev =>
      prev.map(a => (a.id === updatedActivity.id ? { ...a, ...updatedActivity } : a))
    );
  }, []);

  const handleOnboardingComplete = () => {
    setIsConfigured(true);
    fetchActivities();
  };

  const handleRestoreComplete = async () => {
    await checkProfileConfigured();
    await fetchActivities();
    invalidateActivityData();
  };

  const handleImportComplete = async () => {
    await fetchActivities();
    invalidateActivityData();
  };

  if (profileLoadFailed || (historyLoadFailed && activities.length === 0)) {
    return (
      <div className="app-container">
        <main className="main-content app-load-error-page">
          <section className="load-error-state app-load-error" role="alert">
            <span className="app-load-error-icon"><TriangleAlert size={24} /></span>
            <p>{t.browse.historyLoadFailed}</p>
            <button type="button" className="outline-btn" onClick={() => {
              if (!SNAPSHOT_MODE) void checkProfileConfigured();
              void fetchActivities();
            }}><RefreshCw size={14} />{t.common.retry}</button>
          </section>
        </main>
      </div>
    );
  }

  // An empty dashboard is meaningful only after its history request succeeds.
  if (isConfigured === null || !snapshotReady || (isConfigured && loading && activities.length === 0)) {
    if (SNAPSHOT_MODE) return <SnapshotLoadingScreen />;
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg-base)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(6,182,212,0.2)', borderTopColor: '#06b6d4', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  // If first-time user and not configured, show fullscreen Onboarding flow
  if (!SNAPSHOT_MODE && isConfigured === false && OnboardingPage) {
    return (
      <Suspense fallback={<div className="loading-state" style={{ minHeight: '100vh' }} />}>
        <OnboardingPage onCompleted={handleOnboardingComplete} />
      </Suspense>
    );
  }

  return (
    <div className="app-container">
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenUpload={() => setIsUploadOpen(true)}
        onScanImportComplete={handleImportComplete}
        onGarminSyncComplete={handleImportComplete}
        onOpenGarminSettings={() => setActiveTab('settings')}
        onOpenBackup={() => setIsBackupOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
        snapshotMode={SNAPSHOT_MODE}
      />

      {SNAPSHOT_MODE && snapshotGeneratedAt && (
        <div className="snapshot-freshness" role="status">
          {format(t.snapshot.generatedAt, { date: formatDate(snapshotGeneratedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}
        </div>
      )}

      <main className="main-content">
        <Suspense fallback={<div className="overview-card loading-skeleton" style={{ minHeight: 400 }} />}>
          {activeTab === 'browse' && (
            <BrowseView
              activities={activities}
              selectedActivityId={selectedActivityId}
              dataRefreshKey={activityDataVersion}
              onSelectActivity={setSelectedActivityId}
              onOpenUpload={() => setIsUploadOpen(true)}
              onActivityUpdated={handleActivityUpdated}
              theme={theme}
              readOnly={SNAPSHOT_MODE}
            />
          )}

          {activeTab === 'progress' && <ProgressView />}

          {activeTab === 'stats' && <StatsView />}

          {activeTab === 'profile' && (
            <ProfileView
              onOpenBackup={() => setIsBackupOpen(true)}
              onNavigateToSettings={() => setActiveTab('settings')}
              readOnly={SNAPSHOT_MODE}
            />
          )}

          {!SNAPSHOT_MODE && activeTab === 'settings' && SettingsView && (
            <SettingsView
              onRestoreComplete={handleRestoreComplete}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          )}
        </Suspense>
      </main>

      <Footer />

      <Suspense fallback={null}>
        {!SNAPSHOT_MODE && UploadModal && isUploadOpen && (
          <UploadModal
            isOpen={isUploadOpen}
            onClose={() => setIsUploadOpen(false)}
            onUploadSuccess={handleUploadSuccess}
          />
        )}

        {!SNAPSHOT_MODE && BackupModal && isBackupOpen && (
          <BackupModal
            isOpen={isBackupOpen}
            onClose={() => setIsBackupOpen(false)}
            onRestoreComplete={handleRestoreComplete}
          />
        )}

        {DevDiagnosticsDrawer && isDevDrawerOpen && (
          <DevDiagnosticsDrawer
            isOpen={isDevDrawerOpen}
            onClose={() => setIsDevDrawerOpen(false)}
            theme={theme}
          />
        )}
      </Suspense>

      {/* Dev mode button is always available in development builds and is
          compiled out of release builds entirely. */}
      {import.meta.env.DEV && (
        <button
          type="button"
          id="dev-mode-trigger-btn"
          className="dev-floating-trigger"
          onClick={() => setIsDevDrawerOpen(true)}
          title={t.common.devDiagnosticsTooltip}
        >
          <Terminal size={13} />
          <span>{t.common.devMode}</span>
        </button>
      )}
    </div>
  );
};
