import React, { useState, useEffect } from 'react';
import { Navbar, TabType } from './components/Navbar';
import { BrowseView, ActivitySummary } from './components/BrowseView';
import { ProgressView } from './components/ProgressView';
import { StatsView } from './components/StatsView';
import { UploadModal } from './components/UploadModal';
import { Footer } from './components/Footer';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('browse');
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Theme state: persisted in localStorage, defaults to dark
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('aerolab_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aerolab_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/activities');
      const data = await res.json();
      if (data.activities) {
        setActivities(data.activities);
        if (!selectedActivityId && data.activities.length > 0) {
          setSelectedActivityId(data.activities[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, []);

  const handleActivityUpdated = (updated: any) => {
    setActivities(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
  };

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
      </main>

      <Footer />

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={fetchActivities}
      />
    </div>
  );
};
