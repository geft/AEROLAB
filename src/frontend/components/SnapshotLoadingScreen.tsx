import { useSyncExternalStore } from 'react';
import { getSnapshotLoadingProgress, subscribeSnapshotLoading } from '../api/client.js';
import { useTranslation } from '../i18n/LanguageContext.js';

export function SnapshotLoadingScreen() {
  const { t, format } = useTranslation();
  const progress = useSyncExternalStore(subscribeSnapshotLoading, getSnapshotLoadingProgress);
  const downloading = progress.stage === 'downloading';
  const label = downloading ? t.snapshot.downloading : t.snapshot.preparing;
  const percent = downloading ? progress.percent : undefined;
  return (
    <main className="snapshot-loading-screen" aria-busy="true">
      <div className="snapshot-loading-card">
        <h1>{t.snapshot.loadingTitle}</h1>
        <p role="status" aria-live="polite">{label}</p>
        <div className="snapshot-loading-track" role="progressbar" aria-label={label}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className={percent === undefined ? 'snapshot-loading-fill is-indeterminate' : 'snapshot-loading-fill'}
            style={percent === undefined ? undefined : { width: `${percent}%` }} />
        </div>
        {percent !== undefined && <p className="snapshot-loading-percent">{format(t.snapshot.downloadPercent, { percent })}</p>}
      </div>
    </main>
  );
}
