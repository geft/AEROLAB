import React from 'react';
import { UploadCloud, Sun, Moon } from 'lucide-react';

export type TabType = 'browse' | 'progress' | 'stats';

interface NavbarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onOpenUpload: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onOpenUpload,
  theme,
  onToggleTheme
}) => {
  return (
    <header className="navbar">
      <a href="#browse" onClick={(e) => { e.preventDefault(); onTabChange('browse'); }} className="nav-brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-cyan)' }}>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <span>AEROLAB</span>
      </a>

      <nav className="nav-tabs" aria-label="Main Navigation">
        <button
          id="tab-browse-btn"
          className={`nav-tab-btn ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => onTabChange('browse')}
        >
          Browse
        </button>
        <button
          id="tab-progress-btn"
          className={`nav-tab-btn ${activeTab === 'progress' ? 'active' : ''}`}
          onClick={() => onTabChange('progress')}
        >
          Progress
        </button>
        <button
          id="tab-stats-btn"
          className={`nav-tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => onTabChange('stats')}
        >
          Stats
        </button>
      </nav>

      <div className="nav-actions">
        <button
          id="theme-toggle-btn"
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Day Mode' : 'Switch to Dark Mode'}
          aria-label={theme === 'dark' ? 'Switch to Day Mode' : 'Switch to Dark Mode'}
        >
          {theme === 'dark' ? (
            <>
              <Sun size={15} className="theme-icon sun" />
              <span className="theme-label">Day Mode</span>
            </>
          ) : (
            <>
              <Moon size={15} className="theme-icon moon" />
              <span className="theme-label">Night Mode</span>
            </>
          )}
        </button>

        <button id="nav-upload-btn" className="upload-btn" onClick={onOpenUpload}>
          <UploadCloud size={16} />
          <span>Import CSV</span>
        </button>
      </div>
    </header>
  );
};
