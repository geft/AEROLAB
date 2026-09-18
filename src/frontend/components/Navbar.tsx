import React, { useState, useRef, useEffect } from 'react';
import { Compass, TrendingUp, BarChart2, User, UploadCloud, Sun, Moon, Globe, Type, ChevronDown, Check } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { useFontSize, FontSize } from '../context/FontSizeContext.js';

export type TabType = 'browse' | 'progress' | 'stats' | 'profile';

interface NavbarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onOpenUpload: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

function getFontSizeLabel(size: FontSize, t: any): string {
  switch (size) {
    case 'small': return t.common.fontSizeSmall || 'Small (75%)';
    case 'medium': return t.common.fontSizeMedium || 'Default (100%)';
    case 'large': return t.common.fontSizeLarge || 'Large (125%)';
    case 'xlarge': return t.common.fontSizeXLarge || 'Extra Large (150%)';
    case 'xxlarge': return t.common.fontSizeXXLarge || 'Huge (175%)';
    case 'max': return t.common.fontSizeMax || 'Maximum (200%)';
    default: return 'Default (100%)';
  }
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  onOpenUpload,
  theme,
  onToggleTheme
}) => {
  const { language, setLanguage, t } = useTranslation();
  const { fontSize, setFontSize } = useFontSize();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);

  const langRef = useRef<HTMLDivElement>(null);
  const fontRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
      if (fontRef.current && !fontRef.current.contains(e.target as Node)) {
        setFontMenuOpen(false);
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
            className="theme-toggle-btn"
            onClick={() => setLangMenuOpen(prev => !prev)}
            title={t.nav.langTitle}
            aria-label={t.nav.langTitle}
            aria-expanded={langMenuOpen}
          >
            <Globe size={15} className="theme-icon" />
            <span className="theme-label">{language === 'zh' ? '简体中文' : 'English'}</span>
            <ChevronDown size={12} className={`dropdown-chevron ${langMenuOpen ? 'open' : ''}`} />
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

        {/* Font Size Dropdown */}
        <div className="nav-dropdown-wrapper" ref={fontRef}>
          <button
            id="font-size-dropdown-btn"
            className="theme-toggle-btn"
            onClick={() => setFontMenuOpen(prev => !prev)}
            title={t.nav.fontSize}
            aria-label={t.nav.fontSize}
            aria-expanded={fontMenuOpen}
          >
            <Type size={15} className="theme-icon" />
            <span className="theme-label">{getFontSizeLabel(fontSize, t)}</span>
            <ChevronDown size={12} className={`dropdown-chevron ${fontMenuOpen ? 'open' : ''}`} />
          </button>

          {fontMenuOpen && (
            <div className="nav-dropdown-menu" role="menu" id="font-size-dropdown-menu">
              {(['small', 'medium', 'large', 'xlarge', 'xxlarge', 'max'] as FontSize[]).map(size => (
                <button
                  key={size}
                  type="button"
                  id={`font-size-option-${size}`}
                  className={`nav-dropdown-item ${fontSize === size ? 'active' : ''}`}
                  onClick={() => {
                    setFontSize(size);
                    setFontMenuOpen(false);
                  }}
                  role="menuitem"
                >
                  <span>{getFontSizeLabel(size, t)}</span>
                  {fontSize === size && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>

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
