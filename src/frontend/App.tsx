import React, { useState, useEffect } from 'react';
import { Navbar, TabType } from './components/Navbar';
import { BrowseView, ActivitySummary } from './components/BrowseView';
import { ProgressView } from './components/ProgressView';
import { StatsView } from './components/StatsView';
import { ProfileView } from './components/ProfileView';
import { UploadModal } from './components/UploadModal';
import { OnboardingPage } from './components/OnboardingPage';
import { Footer } from './components/Footer';
import { DevDiagnosticsDrawer } from './components/DevDiagnosticsDrawer';
import { Terminal } from 'lucide-react';
import { clientLogger } from './utils/clientLogger';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  // null = still loading, false = needs onboarding, true = ready
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Theme state: persisted in localStorage, defaults to dark
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('aerolab_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  });
  const [isDevDrawerOpen, setIsDevDrawerOpen] = useState<boolean>(false);

  useEffect(() => {
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
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        console.warn(`[HTTP ${res.status}] Profile check non-200:`, errJson);
        const cached = localStorage.getItem('aerolab_profile_configured');
        if (cached === 'true') {
          setIsConfigured(true);
          return;
        }
      }
      const data = await res.json();
      const configured = Boolean(
        data?.isConfigured === true ||
        data?.profile?.is_configured === 1 ||
        (data?.profile?.dob && data?.profile?.resting_hr && (data?.profile?.max_hr || data?.profile?.is_max_hr_estimated))
      );
      setIsConfigured(configured);
      if (configured) {
        localStorage.setItem('aerolab_profile_configured', 'true');
      }
    } catch (err) {
      console.error('Failed to check profile configuration status:', err);
      const cached = localStorage.getItem('aerolab_profile_configured');
      setIsConfigured(cached === 'true');
    }
  };

  const fetchActivities = async (preferredSelectedId?: string) => {
    try {
      setLoading(true);
      const res = await fetch('/api/activities');
      const data = await res.json();
      if (data.activities) {
        setActivities(data.activities);
        if (preferredSelectedId) {
          setSelectedActivityId(preferredSelectedId);
        } else if (!selectedActivityId && data.activities.length > 0) {
          setSelectedActivityId(data.activities[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSuccess = async (importedActivityId?: string) => {
    await fetchActivities(importedActivityId);
    if (importedActivityId) {
      setSelectedActivityId(importedActivityId);
      setActiveTab('browse');
    }
  };

  useEffect(() => {
    checkProfileConfigured();
  }, []);

  // Fetch activities only once the profile is confirmed configured
  useEffect(() => {
    if (isConfigured === true) {
      fetchActivities();
    }
  }, [isConfigured]);

  const handleActivityUpdated = (updated: any) => {
    setActivities(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
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

  // Onboarding gate — full page, nothing else rendered
  if (isConfigured === false) {
    return (
      <OnboardingPage
        onCompleted={() => {
          setIsConfigured(true);
        }}
      />
    );
  }

  return (
    <div className="app-container">
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenUpload={() => setIsUploadOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="main-content">
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

        {activeTab === 'profile' && <ProfileView />}
      </main>

      <Footer />

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />

      <button
        type="button"
        id="dev-mode-trigger-btn"
        className="dev-floating-trigger"
        onClick={() => setIsDevDrawerOpen(true)}
        title="Open Dev Diagnostics (Ctrl+Shift+D)"
      >
        <Terminal size={13} />
        <span>DEV MODE</span>
      </button>

      <DevDiagnosticsDrawer
        isOpen={isDevDrawerOpen}
        onClose={() => setIsDevDrawerOpen(false)}
        theme={theme}
      />
    </div>
  );
};
