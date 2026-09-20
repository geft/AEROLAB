import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Navbar, TabType } from './components/Navbar';
import { BrowseView, ActivitySummary } from './components/BrowseView';
import { Footer } from './components/Footer';
import { Terminal } from 'lucide-react';
import { clientLogger } from './utils/clientLogger';
import { useTranslation } from './i18n/LanguageContext';

// Code-split secondary views, modals, and heavy drawers for instant first paint
const ProgressView = lazy(() => import('./components/ProgressView').then(m => ({ default: m.ProgressView })));
const StatsView = lazy(() => import('./components/StatsView').then(m => ({ default: m.StatsView })));
const ProfileView = lazy(() => import('./components/ProfileView').then(m => ({ default: m.ProfileView })));
const SettingsView = lazy(() => import('./components/SettingsView').then(m => ({ default: m.SettingsView })));
const UploadModal = lazy(() => import('./components/UploadModal').then(m => ({ default: m.UploadModal })));
const BackupModal = lazy(() => import('./components/BackupModal').then(m => ({ default: m.BackupModal })));
const OnboardingPage = lazy(() => import('./components/OnboardingPage').then(m => ({ default: m.OnboardingPage })));

// Developer diagnostics are excluded from release bundles. Vite statically
// replaces `import.meta.env.DEV` with `false` in production, so this ternary
// resolves to null and the component (plus its code-split chunk) is dropped.
const DevDiagnosticsDrawer = import.meta.env.DEV
  ? lazy(() => import('./components/DevDiagnosticsDrawer').then(m => ({ default: m.DevDiagnosticsDrawer })))
  : null;

export const App: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [isBackupOpen, setIsBackupOpen] = useState<boolean>(false);
  // null = still loading, false = needs onboarding, true = ready
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [, setLoading] = useState<boolean>(true);

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

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const checkProfileConfigured = async () => {
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        const p = data?.profile;
        const configured = data?.isConfigured === true && p?.is_configured !== 0 && !!p?.resting_hr && (!!p?.dob || !!p?.age);
        setIsConfigured(configured);
        localStorage.setItem('aerolab_profile_configured', String(configured));
      } else {
        const cached = localStorage.getItem('aerolab_profile_configured');
        setIsConfigured(cached === 'true');
      }
    } catch (err) {
      console.error('Failed to check profile configuration status:', err);
      const cached = localStorage.getItem('aerolab_profile_configured');
      setIsConfigured(cached === 'true');
    }
  };

  const fetchActivities = async (preferredSelectedId?: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/activities');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data?.activities || []);
      setActivities(list);
      if (preferredSelectedId) {
        setSelectedActivityId(preferredSelectedId);
      } else if (!selectedActivityId && list.length > 0) {
        setSelectedActivityId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load activities:', err);
      clientLogger.error('App', 'Failed to load activities', { error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkProfileConfigured();
  }, []);

  useEffect(() => {
    if (isConfigured === true) {
      fetchActivities();
    }
  }, [isConfigured]);

  const handleUploadSuccess = async (importedActivityId?: string) => {
    setIsUploadOpen(false);
    await checkProfileConfigured();
    await fetchActivities(importedActivityId);
    if (importedActivityId) {
      setSelectedActivityId(importedActivityId);
      setActiveTab('browse');
    }
  };

  const handleActivityUpdated = (updatedActivity: any) => {
    setActivities(prev =>
      prev.map(a => (a.id === updatedActivity.id ? { ...a, ...updatedActivity } : a))
    );
  };

  const handleOnboardingComplete = () => {
    setIsConfigured(true);
    fetchActivities();
  };

  // Loading splash — prevents flicker before the profile check resolves
  if (isConfigured === null) {
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
  if (isConfigured === false) {
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
        onOpenBackup={() => setIsBackupOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="main-content">
        <Suspense fallback={<div className="overview-card loading-skeleton" style={{ minHeight: 400 }} />}>
          {activeTab === 'browse' && (
            <BrowseView
              activities={activities}
              selectedActivityId={selectedActivityId}
              onSelectActivity={setSelectedActivityId}
              onOpenUpload={() => setIsUploadOpen(true)}
              onActivityUpdated={handleActivityUpdated}
              theme={theme}
            />
          )}

          {activeTab === 'progress' && <ProgressView />}

          {activeTab === 'stats' && <StatsView />}

          {activeTab === 'profile' && (
            <ProfileView
              onOpenBackup={() => setIsBackupOpen(true)}
              onNavigateToSettings={() => setActiveTab('settings')}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              onRestoreComplete={() => {
                checkProfileConfigured();
                fetchActivities();
              }}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          )}
        </Suspense>
      </main>

      <Footer />

      <Suspense fallback={null}>
        {isUploadOpen && (
          <UploadModal
            isOpen={isUploadOpen}
            onClose={() => setIsUploadOpen(false)}
            onUploadSuccess={handleUploadSuccess}
          />
        )}

        {isBackupOpen && (
          <BackupModal
            isOpen={isBackupOpen}
            onClose={() => setIsBackupOpen(false)}
            onRestoreComplete={() => {
              checkProfileConfigured();
              fetchActivities();
            }}
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
          title="Open Dev Diagnostics (Ctrl+Shift+D)"
        >
          <Terminal size={13} />
          <span>{t.common.devMode}</span>
        </button>
      )}
    </div>
  );
};
