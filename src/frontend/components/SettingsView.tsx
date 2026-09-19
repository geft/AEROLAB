import React from 'react';
import { Settings, Sun, Moon, Type, Terminal, ShieldCheck, HardDrive } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { useFontSize, FontSize, FONT_PERCENTAGES } from '../context/FontSizeContext.js';
import { BackupManagementPanel } from './BackupManagementPanel.js';

export interface SettingsViewProps {
  onRestoreComplete?: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenDevDiagnostics?: () => void;
  showDevFloatingBtn?: boolean;
  onToggleDevFloatingBtn?: (enabled: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onRestoreComplete,
  theme,
  onToggleTheme,
  onOpenDevDiagnostics,
  showDevFloatingBtn = false,
  onToggleDevFloatingBtn
}) => {
  const { t } = useTranslation();
  const { fontSize, setFontSize } = useFontSize();

  const fontOptions: { key: FontSize; label: string }[] = [
    { key: 'small', label: t.settingsView.fontCompact },
    { key: 'medium', label: t.settingsView.fontDefault },
    { key: 'large', label: t.settingsView.fontLarge },
    { key: 'xlarge', label: t.settingsView.fontXLarge }
  ];

  return (
    <div className="settings-view" style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Page Header */}
      <div className="overview-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', padding: '1.5rem 1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'rgba(6, 182, 212, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-cyan)'
          }}>
            <Settings size={24} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {t.settingsView.pageTitle}
            </h1>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {t.settingsView.pageSubtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Section 1: Database Backup & Cloud Sync */}
      <section className="overview-card" style={{ padding: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1.25rem' }}>
          <HardDrive size={20} style={{ color: 'var(--accent-cyan)' }} />
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.backup.cardTitle}
            </h2>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {t.backup.cardSubtitle}
            </p>
          </div>
        </div>

        <BackupManagementPanel onRestoreComplete={onRestoreComplete} isFullPage={true} />
      </section>

      {/* Section 2: Display & Appearance */}
      <section className="overview-card" style={{ padding: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1.25rem' }}>
          <Sun size={20} style={{ color: '#f59e0b' }} />
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.settingsView.appearanceTitle}
            </h2>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {t.settingsView.appearanceSubtitle}
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          {/* Theme Mode Card */}
          <div style={{
            background: 'var(--bg-surface)',
            padding: '1.25rem',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '1rem'
          }}>
            <div>
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.settingsView.themeTitle}
              </span>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                {t.settingsView.themeSubtitle}
              </p>
            </div>

            <button
              type="button"
              id="settings-theme-toggle-btn"
              onClick={onToggleTheme}
              className="theme-toggle-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1rem',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              {theme === 'dark' ? (
                <>
                  <Sun size={15} style={{ color: '#f59e0b' }} />
                  <span>{t.settingsView.switchToDay}</span>
                </>
              ) : (
                <>
                  <Moon size={15} style={{ color: '#8b5cf6' }} />
                  <span>{t.settingsView.switchToNight}</span>
                </>
              )}
            </button>
          </div>

          {/* Font Size Scaling Card */}
          <div style={{
            background: 'var(--bg-surface)',
            padding: '1.25rem',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '1rem'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <Type size={16} style={{ color: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t.settingsView.fontSizeTitle} ({FONT_PERCENTAGES[fontSize]}%)
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                {t.settingsView.fontSizeSubtitle}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              {fontOptions.map(opt => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFontSize(opt.key)}
                  style={{
                    flex: '1 1 calc(50% - 0.45rem)',
                    padding: '0.5rem 0.65rem',
                    borderRadius: 6,
                    fontSize: '0.78rem',
                    fontWeight: fontSize === opt.key ? 700 : 500,
                    background: fontSize === opt.key ? 'var(--accent-cyan)' : 'var(--bg-card)',
                    color: fontSize === opt.key ? '#07090e' : 'var(--text-secondary)',
                    border: `1px solid ${fontSize === opt.key ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Developer Tools & Diagnostics */}
      <section className="overview-card" style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Terminal size={22} style={{ color: '#8b5cf6' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.settingsView.devTitle}
              </h3>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {t.settingsView.devSubtitle}
              </p>
            </div>
          </div>

          {onOpenDevDiagnostics && (
            <button
              type="button"
              id="settings-open-dev-btn"
              onClick={onOpenDevDiagnostics}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                background: 'rgba(139, 92, 246, 0.12)',
                color: '#a78bfa',
                border: '1px solid rgba(139, 92, 246, 0.3)',
                padding: '0.55rem 1rem',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Terminal size={14} />
              <span>{t.settingsView.openDiagnostics}</span>
            </button>
          )}
        </div>

        {/* Floating Button Toggle */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-subtle)'
        }}>
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {t.common.showDevButton}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              {t.common.showDevButtonDesc}
            </div>
          </div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              id="settings-toggle-dev-btn"
              checked={showDevFloatingBtn}
              onChange={e => onToggleDevFloatingBtn?.(e.target.checked)}
              style={{ accentColor: '#8b5cf6', width: 17, height: 17, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: showDevFloatingBtn ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
              {showDevFloatingBtn ? t.common.enabled : t.common.disabled}
            </span>
          </label>
        </div>
      </section>
    </div>
  );
};
