import React from 'react';
import { Sun, Moon, Type, HardDrive } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { useFontSize, FontSize, FONT_PERCENTAGES } from '../context/FontSizeContext.js';
import { BackupManagementPanel } from './BackupManagementPanel.js';
import { DatabaseLocation } from './DatabaseLocation.js';
import { GarminApiPanel } from './GarminApiPanel.js';

const SNAPSHOT_BUILD = import.meta.env.VITE_AEROLAB_TARGET === 'snapshot';

export interface SettingsViewProps {
  onRestoreComplete?: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onRestoreComplete,
  theme,
  onToggleTheme
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
    <div className="settings-view">
      <DatabaseLocation />
      {!SNAPSHOT_BUILD && <GarminApiPanel />}
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
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {t.settingsView.appearanceTitle}
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1.5rem' }}>
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

      {/* Developer diagnostics open from the floating dev-mode button rendered by
          App.tsx, which is always present in development builds. There is no
          settings entry for it, and it is absent from release builds entirely. */}
    </div>
  );
};
