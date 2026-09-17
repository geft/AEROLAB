import { Compass, TrendingUp, BarChart2, User, UploadCloud, Sun, Moon, Globe } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';

export type TabType = 'browse' | 'progress' | 'stats' | 'profile';

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
  const { toggleLanguage, t } = useTranslation();

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
          <Compass size={18} className="nav-tab-icon" />
          <span className="nav-tab-label">{t.nav.browse}</span>
        </button>
        <button
          id="tab-progress-btn"
          className={`nav-tab-btn ${activeTab === 'progress' ? 'active' : ''}`}
          onClick={() => onTabChange('progress')}
        >
          <TrendingUp size={18} className="nav-tab-icon" />
          <span className="nav-tab-label">{t.nav.progress}</span>
        </button>
        <button
          id="tab-stats-btn"
          className={`nav-tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
          onClick={() => onTabChange('stats')}
        >
          <BarChart2 size={18} className="nav-tab-icon" />
          <span className="nav-tab-label">{t.nav.stats}</span>
        </button>
        <button
          id="tab-profile-btn"
          className={`nav-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => onTabChange('profile')}
        >
          <User size={18} className="nav-tab-icon" />
          <span className="nav-tab-label">{t.nav.profile}</span>
        </button>
      </nav>

      <div className="nav-actions">
        <button
          id="language-toggle-btn"
          className="theme-toggle-btn"
          onClick={toggleLanguage}
          title={t.nav.langTitle}
          aria-label={t.nav.langTitle}
        >
          <Globe size={15} className="theme-icon" />
          <span className="theme-label">{t.nav.langButton}</span>
        </button>

        <button
          id="theme-toggle-btn"
          className="theme-toggle-btn"
          onClick={onToggleTheme}
          title={theme === 'dark' ? t.nav.dayMode : t.nav.nightMode}
          aria-label={theme === 'dark' ? t.nav.dayMode : t.nav.nightMode}
        >
          {theme === 'dark' ? (
            <>
              <Sun size={15} className="theme-icon sun" />
              <span className="theme-label">{t.nav.dayMode}</span>
            </>
          ) : (
            <>
              <Moon size={15} className="theme-icon moon" />
              <span className="theme-label">{t.nav.nightMode}</span>
            </>
          )}
        </button>

        <button id="nav-upload-btn" className="upload-btn" onClick={onOpenUpload} title={t.upload.title}>
          <UploadCloud size={16} />
          <span>{t.nav.importRuns}</span>
        </button>
      </div>
    </header>
  );
};
