import React, { useState, useRef, useEffect } from 'react';
import { Compass, TrendingUp, BarChart2, User, UploadCloud, Sun, Moon, Globe, Type, ChevronDown, Check, Minus, Plus, HardDrive } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { useFontSize, FontSize, FONT_SIZES, FONT_PERCENTAGES } from '../context/FontSizeContext.js';

export type TabType = 'browse' | 'progress' | 'stats' | 'profile';

interface NavbarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onOpenUpload: () => void;
  onOpenBackup?: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onOpenUpload,
  onOpenBackup,
  theme,
  onToggleTheme
}) => {
  const { language, setLanguage, t } = useTranslation();
  const { fontSize, setFontSize, increaseFontSize, decreaseFontSize } = useFontSize();
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        {/* Language Dropdown */}
        <div className="nav-dropdown-wrapper" ref={langRef}>
          <button
            id="language-toggle-btn"
            className="theme-toggle-btn lang-toggle-btn"
            onClick={() => setLangMenuOpen(prev => !prev)}
            title={t.nav.langTitle}
            aria-label={t.nav.langTitle}
            aria-expanded={langMenuOpen}
          >
            <Globe size={15} className="theme-icon" />
            <span className="lang-code-label">{language === 'zh' ? '中' : 'EN'}</span>
            <span className="theme-label">{language === 'zh' ? '简体中文' : 'English'}</span>
            <ChevronDown size={11} className={`dropdown-chevron ${langMenuOpen ? 'open' : ''}`} />
          </button>

          {langMenuOpen && (
            <div className="nav-dropdown-menu" role="menu" id="language-dropdown-menu">
              <button
                type="button"
                id="lang-option-en"
                className={`nav-dropdown-item ${language === 'en' ? 'active' : ''}`}
                onClick={() => {
                  setLanguage('en');
                  setLangMenuOpen(false);
                }}
                role="menuitem"
              >
                <span>{t.nav.langEnglish}</span>
                {language === 'en' && <Check size={13} />}
              </button>
              <button
                type="button"
                id="lang-option-zh"
                className={`nav-dropdown-item ${language === 'zh' ? 'active' : ''}`}
                onClick={() => {
                  setLanguage('zh');
                  setLangMenuOpen(false);
                }}
                role="menuitem"
              >
                <span>{t.nav.langChinese}</span>
                {language === 'zh' && <Check size={13} />}
              </button>
            </div>
          )}
        </div>

        {/* Font Size Stepper (+ / -) */}
        <div className="font-size-stepper" title={`${t.nav.fontSize}: ${FONT_PERCENTAGES[fontSize]}%`} id="font-size-stepper">
          <button
            type="button"
            id="font-size-dec-btn"
            className="font-stepper-btn"
            onClick={decreaseFontSize}
            disabled={fontSize === 'small'}
            aria-label="Decrease font size"
            title="Decrease font size (-)"
          >
            <Minus size={13} />
          </button>
          <span className="font-stepper-label" id="font-size-current-val">
            <Type size={12} style={{ opacity: 0.7 }} />
            <span>{FONT_PERCENTAGES[fontSize]}%</span>
          </span>
          <button
            type="button"
            id="font-size-inc-btn"
            className="font-stepper-btn"
            onClick={increaseFontSize}
            disabled={fontSize === 'xlarge'}
            aria-label="Increase font size"
            title="Increase font size (+)"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Theme Toggle */}
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

        {/* Backup Modal Button */}
        <button
          id="nav-backup-btn"
          className="backup-btn"
          onClick={onOpenBackup}
          title={t.nav.backup}
          aria-label={t.nav.backup}
        >
          <HardDrive size={15} />
          <span className="nav-btn-text">{t.nav.backup}</span>
        </button>

        {/* Upload / Import Runs Button */}
        <button id="nav-upload-btn" className="upload-btn" onClick={onOpenUpload} title={t.upload.title}>
          <UploadCloud size={16} />
          <span className="nav-btn-text">{t.nav.importRuns}</span>
        </button>
      </div>
    </header>
  );
};
