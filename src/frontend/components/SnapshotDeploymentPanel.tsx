import React, { useState } from 'react';
import { CheckCircle2, CloudUpload, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { ApiRequestError, deploySnapshotToVercel, getSnapshotDeploymentStatus, type SnapshotDeploymentPhase } from '../api/client.js';

export interface SnapshotDeploymentPanelProps {
  filename: string;
}

export const SnapshotDeploymentPanel: React.FC<SnapshotDeploymentPanelProps> = ({ filename }) => {
  const { t, format } = useTranslation();
  const [deploying, setDeploying] = useState(false);
  const [phase, setPhase] = useState<SnapshotDeploymentPhase | null>(null);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeploy = async () => {
    if (!window.confirm(format(t.snapshot.deployProtectionConfirmation, { filename }))) return;
    setDeploying(true);
    setPhase('checking');
    setDeploymentUrl(null);
    setError(null);
    try {
      const { jobId } = await deploySnapshotToVercel(filename);
      while (true) {
        const status = await getSnapshotDeploymentStatus(jobId);
        setPhase(status.phase);
        if (status.phase === 'complete' && status.deploymentUrl) {
          setDeploymentUrl(status.deploymentUrl);
          break;
        }
        if (status.phase === 'failed') throw new Error(status.error || t.snapshot.deployFailed);
        await new Promise(resolve => setTimeout(resolve, 1200));
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'ERR_SNAPSHOT_NOT_FOUND') {
        setError(t.snapshot.deploySnapshotMissing);
      } else {
        setError(`${t.snapshot.deployFailed} ${err instanceof Error ? err.message : ''}`.trim());
      }
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="snapshot-row-deploy">
      <button
        type="button"
        className="snapshot-deploy-button"
        onClick={() => void handleDeploy()}
        disabled={deploying}
        aria-label={`${t.snapshot.deployRowButton}: ${filename}`}
      >
        {deploying
          ? <LoaderCircle size={14} className="snapshot-deploy-spinner" aria-hidden="true" />
          : <CloudUpload size={14} aria-hidden="true" />}
        {deploying ? t.snapshot.deploying : t.snapshot.deployRowButton}
      </button>
      {deploying && phase && (
        <div className="snapshot-deploy-progress" role="status">
          <p>{t.snapshot.deployPhases[phase]}</p>
          {(phase === 'login' || phase === 'linking') && <p>{t.snapshot.deploySetupTerminalHint}</p>}
        </div>
      )}
      {deploymentUrl && (
        <p className="snapshot-deploy-result" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>{t.snapshot.deploySuccess}</span>
          <a className="snapshot-deploy-open" href={deploymentUrl} target="_blank" rel="noreferrer">
            {t.snapshot.deployOpen}
          </a>
        </p>
      )}
      {error && (
        <p className="snapshot-deploy-error" role="alert">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};
