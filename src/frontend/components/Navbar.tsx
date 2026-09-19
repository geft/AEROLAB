import React, { useState, useRef, useEffect } from 'react';
import { Compass, TrendingUp, BarChart2, User, Settings, UploadCloud, Sun, Moon, Globe, Type, ChevronDown, Check, Minus, Plus, HardDrive, MoreHorizontal, Terminal } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { useFontSize, FontSize, FONT_SIZES, FONT_PERCENTAGES } from '../context/FontSizeContext.js';

export type TabType = 'browse' | 'progress' | 'stats' | 'profile' | 'settings';

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
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
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
        <button
          id="tab-settings-btn"
          className={`nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => onTabChange('settings')}
        >
          <Settings size={18} className="nav-tab-icon" />
          <span className="nav-tab-label">{t.nav.settings}</span>
        </button>
      </nav>

      <div className="nav-actions">
        {/* Desktop Actions (visible on full desktop, consolidated into more-menu on split-screen) */}
        <div className="nav-desktop-actions">
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
        </div>

        {/* Split-Screen Consolidated "More / Actions" Dropdown */}
        <div className="nav-compact-actions" ref={moreMenuRef}>
          <button
            type="button"
            id="nav-more-menu-btn"
            className="theme-toggle-btn nav-more-trigger-btn"
            onClick={() => setMoreMenuOpen(prev => !prev)}
            title="Options & Appearance"
            aria-label="Options & Appearance"
            aria-expanded={moreMenuOpen}
          >
            <MoreHorizontal size={18} />
          </button>

          {moreMenuOpen && (
            <div className="nav-dropdown-menu nav-more-dropdown-menu" role="menu">
              <div className="nav-dropdown-section-title">{t.nav.langTitle || 'Language'}</div>
              <button
                type="button"
                id="more-menu-lang-en"
                className={`nav-dropdown-item ${language === 'en' ? 'active' : ''}`}
                onClick={() => {
                  setLanguage('en');
                  setMoreMenuOpen(false);
                }}
              >
                <Globe size={14} />
                <span>{t.nav.langEnglish}</span>
                {language === 'en' && <Check size={13} style={{ marginLeft: 'auto' }} />}
              </button>
              <button
                type="button"
                id="more-menu-lang-zh"
                className={`nav-dropdown-item ${language === 'zh' ? 'active' : ''}`}
                onClick={() => {
                  setLanguage('zh');
                  setMoreMenuOpen(false);
                }}
              >
                <Globe size={14} />
                <span>{t.nav.langChinese}</span>
                {language === 'zh' && <Check size={13} style={{ marginLeft: 'auto' }} />}
              </button>

              <div className="nav-dropdown-section-title" style={{ marginTop: '0.35rem' }}>Appearance & Display</div>
              <button
                type="button"
                id="more-menu-theme-btn"
                className="nav-dropdown-item"
                onClick={() => {
                  onToggleTheme();
                  setMoreMenuOpen(false);
                }}
              >
                {theme === 'dark' ? (
                  <>
                    <Sun size={15} className="theme-icon sun" />
                    <span>{t.nav.dayMode}</span>
                  </>
                ) : (
                  <>
                    <Moon size={15} className="theme-icon moon" />
                    <span>{t.nav.nightMode}</span>
                  </>
                )}
              </button>

              <div className="nav-dropdown-item font-size-row" style={{ justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Font Size</span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={decreaseFontSize}
                    disabled={fontSize === 'small'}
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', width: 22, height: 22, borderRadius: 4, cursor: 'pointer' }}
                  >
                    -
                  </button>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, minWidth: 36, textAlign: 'center' }}>{FONT_PERCENTAGES[fontSize]}%</span>
                  <button
                    type="button"
                    onClick={increaseFontSize}
                    disabled={fontSize === 'xlarge'}
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', width: 22, height: 22, borderRadius: 4, cursor: 'pointer' }}
                  >
                    +
                  </button>
                </div>
              </div>

              {onOpenBackup && (
                <>
                  <div className="nav-dropdown-section-title" style={{ marginTop: '0.35rem' }}>Data & Backups</div>
                  <button
                    type="button"
                    className="nav-dropdown-item"
                    onClick={() => {
                      onOpenBackup();
                      setMoreMenuOpen(false);
                    }}
                  >
                    <HardDrive size={15} />
                    <span>{t.nav.backup}</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Upload / Import Runs Button */}
        <button id="nav-upload-btn" className="upload-btn" onClick={onOpenUpload} title={t.upload.title}>
          <UploadCloud size={16} />
          <span className="nav-btn-text">{t.nav.importRuns}</span>
        </button>
      </div>
    </header>
  );
};
