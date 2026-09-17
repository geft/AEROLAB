import React, { useState } from 'react';
import { Tag, Copy, Check } from 'lucide-react';
import { BUILD_INFO } from '../version.js';

export const Footer: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const copyBuildDetails = () => {
    const text = `AEROLAB v${BUILD_INFO.version} (Commit: ${BUILD_INFO.gitCommit}, Built: ${BUILD_INFO.buildDate}${BUILD_INFO.buildNumber !== 'local' ? `, Run: #${BUILD_INFO.buildNumber}` : ''})`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {});
    }
  };

  return (
    <footer className="app-footer">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', alignItems: 'center' }}>
        <div>
          <b style={{ color: 'var(--text-primary)' }}>AEROLAB</b> Running Dynamics & Physiology Lab • Local & Offline-First
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <span>© 2026 AEROLAB • Designed for GJ</span>
          <span style={{ opacity: 0.4 }}>•</span>
          <button
            type="button"
            className="footer-version-badge"
            onClick={copyBuildDetails}
            title={`Click to copy build info for bug reporting\nCommit: ${BUILD_INFO.gitCommit}\nBuilt: ${BUILD_INFO.buildDate}${BUILD_INFO.buildNumber !== 'local' ? `\nCI Run: #${BUILD_INFO.buildNumber}` : ''}`}
            aria-label="App build and version information"
          >
            <Tag size={11} className="footer-version-icon" />
            <span className="footer-version-number">v{BUILD_INFO.version}</span>
            <span className="footer-commit-hash">({BUILD_INFO.gitCommit})</span>
            {copied ? (
              <span className="footer-copied-tag">
                <Check size={11} /> Copied!
              </span>
            ) : (
              <Copy size={10} className="footer-copy-icon" />
            )}
          </button>
        </div>
      </div>
    </footer>
  );
};

