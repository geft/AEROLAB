import React, { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { getMaintenanceStatus } from '../api/client.js';

/**
 * Compaction duration depends on the file size, so there is no honest progress
 * percentage. Show an indeterminate status while the maintenance worker rewrites
 * the database, then disappear; the status endpoint is a file read, not a query.
 */
export const CompactionIndicator: React.FC = () => {
  const { t } = useTranslation();
  const [compacting, setCompacting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const status = await getMaintenanceStatus();
        if (cancelled) return;
        setCompacting(status.status === 'running' && status.compacting === true);
      } catch { /* The indicator is optional while the local API is busy. */ }
      if (!cancelled) timer = window.setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, []);

  if (!compacting) return null;

  return (
    <div className="compaction-indicator" role="status" aria-live="polite">
      <LoaderCircle size={14} className="snapshot-deploy-spinner" aria-hidden="true" />
      <span>{t.maintenance.compacting}</span>
      <span className="compaction-indicator-hint">{t.maintenance.compactingHint}</span>
    </div>
  );
};
