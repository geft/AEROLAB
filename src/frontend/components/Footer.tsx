import React from 'react';
import { useTranslation } from '../i18n/LanguageContext.js';

export const Footer: React.FC = () => {
  const { t } = useTranslation();

  return (
    <footer className="app-footer">
      <span>© 2026 <b style={{ color: 'var(--text-primary)' }}>AEROLAB</b> · {t.footer.offlineEngine}</span>
    </footer>
  );
};
