import React, { useState } from 'react';
import { CheckCircle2, CloudUpload, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { ApiRequestError, deploySnapshotToVercel } from '../api/client.js';

export interface SnapshotDeploymentPanelProps {
  filename: string;
}

export const SnapshotDeploymentPanel: React.FC<SnapshotDeploymentPanelProps> = ({ filename }) => {
  const { t, format } = useTranslation();
  const [deploying, setDeploying] = useState(false);
  const [deploymentUrl, setDeploymentUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeploy = async () => {
    if (!window.confirm(format(t.snapshot.deployProtectionConfirmation, { filename }))) return;
    setDeploying(true);
    setDeploymentUrl(null);
    setError(null);
    try {
      const result = await deploySnapshotToVercel(filename);
      if (!result.deploymentUrl) throw new Error(t.snapshot.deployFailed);
      setDeploymentUrl(result.deploymentUrl);
    } catch (err) {
      if (err instanceof ApiRequestError && ['ERR_VERCEL_PROJECT_NOT_LINKED', 'ERR_VERCEL_PROJECT_LINK_INVALID'].includes(err.code)) {
        setError(t.snapshot.deployNeedsLink);
      } else if (err instanceof ApiRequestError && err.code === 'ERR_SNAPSHOT_NOT_FOUND') {
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
      {deploymentUrl && (
        <p className="snapshot-deploy-result" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>{t.snapshot.deploySuccess} <a href={deploymentUrl} target="_blank" rel="noreferrer">{deploymentUrl}</a></span>
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
