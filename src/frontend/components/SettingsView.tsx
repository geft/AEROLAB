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
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onRestoreComplete,
  theme,
  onToggleTheme,
  onOpenDevDiagnostics
}) => {
  const { t } = useTranslation();
  const { fontSize, setFontSize } = useFontSize();

  const fontOptions: { key: FontSize; label: string }[] = [
    { key: 'small', label: 'Compact (75%)' },
    { key: 'medium', label: 'Default (100%)' },
    { key: 'large', label: 'Large (125%)' },
    { key: 'xlarge', label: 'Extra Large (150%)' }
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
              {t.nav.settings}
            </h1>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Manage offline SQLite database snapshots, Google Drive cloud synchronization, and display preferences.
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
              Display & Appearance
            </h2>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Customize visual theme and font scaling for high-resolution monitors.
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
                Color Theme
              </span>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                Toggle between sleek low-light Night Mode and high-contrast Day Mode.
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
                  <span>Switch to Day Mode</span>
                </>
              ) : (
                <>
                  <Moon size={15} style={{ color: '#8b5cf6' }} />
                  <span>Switch to Night Mode</span>
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
                  Font Size Scaling ({FONT_PERCENTAGES[fontSize]}%)
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
                Scale UI typography for split-screen windows or larger displays.
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
      <section className="overview-card" style={{ padding: '1.5rem 1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Terminal size={22} style={{ color: '#8b5cf6' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Developer Diagnostics & System Health
            </h3>
            <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Inspect live database counts, engine telemetry, and server logs. Shortcut: <kbd style={{ background: 'var(--bg-card)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>Ctrl+Shift+D</kbd>
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
            <span>Open Diagnostics Drawer</span>
          </button>
        )}
      </section>
    </div>
  );
};
