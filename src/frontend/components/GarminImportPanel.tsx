import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FolderOpen } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';
import { apiErrorMessage } from '../api/errors.js';
import { getImportFolder, saveImportFolder, selectImportFolder } from '../api/client.js';

export const GarminImportPanel: React.FC = () => {
  const { t } = useTranslation();
  const [directory, setDirectory] = useState('');
  const [savedDirectory, setSavedDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    getImportFolder()
      .then(data => {
        if (!mounted) return;
        const configuredDirectory = typeof data.directory === 'string' ? data.directory : '';
        setDirectory(configuredDirectory);
        setSavedDirectory(configuredDirectory);
        if (!data.exists) setMessage({ type: 'error', text: t.garminImport.folderUnavailable });
      })
      .catch(err => {
        if (mounted) setMessage({ type: 'error', text: apiErrorMessage(t, err, t.garminImport.scanFailed) });
      });
    return () => { mounted = false; };
  }, [t]);

  const handleChooseFolder = async () => {
    setMessage(null);
    try {
      const selection = await selectImportFolder(t.garminImport.pickerTitle);
      if (selection.folder) setDirectory(selection.folder);
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(t, err, t.garminImport.chooseFolderFailed) });
    }
  };

  const handleSaveFolder = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await saveImportFolder(directory.trim());
      setDirectory(data.directory);
      setSavedDirectory(data.directory);
      setMessage({ type: 'success', text: t.garminImport.saved });
    } catch (err) {
      setMessage({ type: 'error', text: apiErrorMessage(t, err, t.garminImport.saveFailed) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="overview-card" style={{ padding: '1.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
        <Download size={20} style={{ color: 'var(--accent-cyan)' }} />
        <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {t.garminImport.title}
        </h2>
      </div>
      <p style={{ margin: '0 0 1.1rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        {t.garminImport.description}
      </p>

      <label htmlFor="garmin-import-directory" style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', fontWeight: 650, color: 'var(--text-primary)' }}>
        {t.garminImport.folderLabel}
      </label>
      <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
        <input
          id="garmin-import-directory"
          type="text"
          value={directory}
          onChange={event => setDirectory(event.target.value)}
          spellCheck={false}
          style={{ flex: '1 1 300px', minWidth: 0, padding: '0.65rem 0.75rem', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
        />
        <button type="button" className="garmin-folder-action" onClick={handleChooseFolder} disabled={busy}>
          <FolderOpen size={15} /> {t.garminImport.chooseFolder}
        </button>
        <button type="button" className="garmin-folder-action" onClick={handleSaveFolder} disabled={busy || !directory.trim() || directory.trim() === savedDirectory}>
          {t.garminImport.saveFolder}
        </button>
      </div>

      {message && (
        <div role="status" style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: message.type === 'success' ? '#4ade80' : '#f87171' }}>
          {message.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          <span>{message.text}</span>
        </div>
      )}
    </section>
  );
};
