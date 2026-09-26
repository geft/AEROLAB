// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../src/frontend/i18n/LanguageContext.js';
import { BackupManagementPanel } from '../../src/frontend/components/BackupManagementPanel.js';
import { DatabaseLocation } from '../../src/frontend/components/DatabaseLocation.js';
import { GarminImportPanel } from '../../src/frontend/components/GarminImportPanel.js';
import { GarminScanModal } from '../../src/frontend/components/GarminScanModal.js';
import { ApiRequestError } from '../../src/frontend/api/client.js';

const mocks = vi.hoisted(() => ({
  getDatabaseStatus: vi.fn(), backupDatabase: vi.fn(), saveBackupSettings: vi.fn(),
  selectBackupFolder: vi.fn(), restoreDatabase: vi.fn(), restoreDatabaseSnapshot: vi.fn(),
  chooseDatabaseLocation: vi.fn(), setDatabaseLocation: vi.fn(), getMaintenanceStatus: vi.fn(),
  getImportFolder: vi.fn(), saveImportFolder: vi.fn(), selectImportFolder: vi.fn(), scanImportFolder: vi.fn(),
}));
vi.mock('../../src/frontend/api/client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/frontend/api/client.js')>(), ...mocks,
}));

const baseStatus = {
  dbPath: 'C:/data/runs.db', startupDbPath: 'C:/data/runs.db', sizeMb: '12.4', activityCount: 7,
  snapshots: [{ filename: 'snapshot.db', createdAt: '2026-01-02T00:00:00Z', sizeMb: '2.5' }],
  settings: { autoBackupEnabled: true, backupDirectory: 'C:/backup', backupIntervalDays: 7, lastBackupAt: null },
};
const renderWithLanguage = (element: React.ReactElement) => render(<LanguageProvider>{element}</LanguageProvider>);

beforeEach(() => {
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.getDatabaseStatus.mockResolvedValue(baseStatus);
  mocks.backupDatabase.mockResolvedValue({ status: 'ok' });
  mocks.saveBackupSettings.mockResolvedValue({ status: 'ok' });
  mocks.selectBackupFolder.mockResolvedValue({ folder: 'C:/new-backup' });
  mocks.restoreDatabase.mockResolvedValue({ status: 'ok', activityCount: 3 });
  mocks.restoreDatabaseSnapshot.mockResolvedValue({ success: true, activityCount: 3 });
  mocks.chooseDatabaseLocation.mockResolvedValue({ databasePath: 'C:/new.db', exists: false });
  mocks.setDatabaseLocation.mockResolvedValue({ databasePath: 'C:/new.db', copied: true, restartRequired: true });
  mocks.getMaintenanceStatus.mockResolvedValue({ status: 'idle' });
  mocks.getImportFolder.mockResolvedValue({ directory: 'C:/Garmin', exists: true });
  mocks.saveImportFolder.mockImplementation(async (directory: string) => ({ directory, exists: true }));
  mocks.selectImportFolder.mockResolvedValue({ folder: 'C:/chosen' });
  mocks.scanImportFolder.mockResolvedValue({ results: [] });
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('backup management states', () => {
  it('loads status, saves settings, backs up, and refreshes status after each operation', async () => {
    renderWithLanguage(<BackupManagementPanel isFullPage />);
    expect(await screen.findByText('snapshot.db')).toBeTruthy();
    expect(screen.getByDisplayValue('C:/backup')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save Folder' }));
    await screen.findByText('Backup settings saved successfully');
    expect(mocks.saveBackupSettings).toHaveBeenCalledWith({ autoBackupEnabled: true, backupDirectory: 'C:/backup' });
    await waitFor(() => expect(mocks.getDatabaseStatus).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Backup Now to Folder' }));
    await screen.findByText('Database backup created successfully!');
    expect(mocks.backupDatabase).toHaveBeenCalledWith('C:/backup');
    await waitFor(() => expect(mocks.getDatabaseStatus).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole('button', { name: 'Choose Folder' }));
    await waitFor(() => expect(screen.getByDisplayValue('C:/new-backup')).toBeTruthy());
  });

  it('shows safe initial data when status fails and reports backup/settings errors', async () => {
    mocks.getDatabaseStatus.mockRejectedValue(new Error('offline'));
    mocks.backupDatabase.mockRejectedValue(new ApiRequestError(500, 'ERR_NETWORK', 'offline'));
    mocks.saveBackupSettings.mockRejectedValue(new Error('disk full'));
    renderWithLanguage(<BackupManagementPanel />);
    await screen.findByText('No local database snapshots found. Click "Backup Now to Folder" above to create one.');
    fireEvent.click(screen.getByRole('button', { name: 'Backup Now to Folder' }));
    await screen.findByText('The request could not be completed. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Save Folder' }));
    await screen.findByText(/Backup failed:/);
  });

  it('restores from a snapshot only after confirmation, invokes callback, and handles cancellation/server failure', async () => {
    const onRestoreComplete = vi.fn();
    renderWithLanguage(<BackupManagementPanel onRestoreComplete={onRestoreComplete} isFullPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rollback' }));
    await screen.findByText(/Database restored successfully! \(3 activities restored/);
    expect(mocks.restoreDatabaseSnapshot).toHaveBeenCalledWith('snapshot.db');
    expect(onRestoreComplete).toHaveBeenCalledOnce();

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }));
    expect(mocks.restoreDatabaseSnapshot).toHaveBeenCalledOnce();

    mocks.restoreDatabaseSnapshot.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByRole('button', { name: 'Rollback' }));
    await screen.findByText('Restore failed. Please verify the file is a valid AEROLAB database.');
  });

  it('restores a selected file and reports rejection while resetting the file input', async () => {
    const callback = vi.fn();
    renderWithLanguage(<BackupManagementPanel onRestoreComplete={callback} />);
    await screen.findByText('snapshot.db');
    const file = new File(['sqlite'], 'backup.db', { type: 'application/octet-stream' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByText(/Database restored successfully! \(3 activities restored/);
    expect(mocks.restoreDatabase).toHaveBeenCalledWith(file);
    expect(callback).toHaveBeenCalledOnce();

    mocks.restoreDatabase.mockRejectedValueOnce(new ApiRequestError(400, 'ERR_INVALID_RESPONSE', 'bad file'));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByText('The local server returned an unexpected response.');
  });
});

describe('database location states', () => {
  it('selects a new database, confirms copying, and reports the restart setting', async () => {
    renderWithLanguage(<DatabaseLocation />);
    expect(await screen.findByText('C:/data/runs.db')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose database location' }));
    await screen.findByText('C:/new.db');
    fireEvent.click(screen.getByRole('button', { name: 'Copy current database here' }));
    await screen.findByText('Location saved. Restart this app to use it.');
    expect(mocks.setDatabaseLocation).toHaveBeenCalledWith('C:/new.db', false);
  });

  it('allows cancellation, uses existing databases, and translates representative server failures', async () => {
    mocks.chooseDatabaseLocation.mockResolvedValue({ databasePath: 'C:/existing.db', exists: true });
    renderWithLanguage(<DatabaseLocation />);
    await screen.findByText('C:/data/runs.db');
    fireEvent.click(screen.getByRole('button', { name: 'Choose database location' }));
    await screen.findByText('C:/existing.db');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Use this database' }));
    expect(mocks.setDatabaseLocation).not.toHaveBeenCalled();

    mocks.setDatabaseLocation.mockRejectedValueOnce(new ApiRequestError(400, 'INVALID_DATABASE', 'invalid'));
    fireEvent.click(screen.getByRole('button', { name: 'Use this database' }));
    await screen.findByText('The selected file is not a valid AEROLAB database.');
  });

  it.each([
    ['LOCATION_CHANGED', 'The selected file changed. Choose it again before continuing.'],
    ['DATABASE_PATH_OVERRIDE', 'DATABASE_PATH is set for this app. Remove that environment override before changing its database location.'],
    ['INVALID_FOLDER', 'Choose a new file in an existing storage folder.'],
  ])('shows %s maintenance error copy', async (code, message) => {
    mocks.setDatabaseLocation.mockRejectedValueOnce(new ApiRequestError(400, code, 'error'));
    renderWithLanguage(<DatabaseLocation />);
    await screen.findByText('C:/data/runs.db');
    fireEvent.click(screen.getByRole('button', { name: 'Choose database location' }));
    await screen.findByText('C:/new.db');
    fireEvent.click(screen.getByRole('button', { name: 'Copy current database here' }));
    await screen.findByText(message);
  });

  it('shows running, failed and interrupted maintenance messages from status polling', async () => {
    vi.useFakeTimers();
    mocks.getMaintenanceStatus
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ status: 'interrupted' });
    renderWithLanguage(<DatabaseLocation />);
    await act(async () => {});
    expect(screen.getByText('Updating saved workout analysis in the background…')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Workout analysis update was interrupted. Restart the app to retry.')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(mocks.getMaintenanceStatus).toHaveBeenCalledTimes(3);
  });
});

describe('Garmin import folder states', () => {
  it('loads the folder, enables save after choosing, saves it, and disables unchanged or blank values', async () => {
    renderWithLanguage(<GarminImportPanel />);
    const input = await screen.findByDisplayValue('C:/Garmin');
    const save = screen.getByRole('button', { name: 'Save folder' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe('C:/chosen'));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await screen.findByText('Import folder saved.');
    expect(mocks.saveImportFolder).toHaveBeenCalledWith('C:/chosen');
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows unavailable, chooser failure and save failure messages', async () => {
    mocks.getImportFolder.mockResolvedValueOnce({ directory: 'C:/missing', exists: false });
    mocks.selectImportFolder.mockRejectedValueOnce(new ApiRequestError(500, 'ERR_NETWORK', 'offline'));
    mocks.saveImportFolder.mockRejectedValueOnce(new Error('denied'));
    renderWithLanguage(<GarminImportPanel />);
    const input = await screen.findByDisplayValue('C:/missing');
    await screen.findByText('The Downloads folder was not found. Choose the folder Chrome uses for downloads.');
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    await screen.findByText('The request could not be completed. Please try again.');
    fireEvent.change(input, { target: { value: 'C:/new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
    await screen.findByText('Could not save the import folder.');
  });
});

describe('Garmin scan results', () => {
  it('shows mixed file statuses, counts imports and supports closing', async () => {
    const onClose = vi.fn();
    const onImportComplete = vi.fn();
    mocks.scanImportFolder.mockResolvedValueOnce({ results: [
      { filename: 'run.fit', status: 'imported' }, { filename: 'dupe.fit', status: 'skipped_duplicate' },
      { filename: 'walk.fit', status: 'skipped_non_running' }, { filename: 'bad.fit', status: 'error' },
    ] });
    renderWithLanguage(<GarminScanModal isOpen onClose={onClose} onImportComplete={onImportComplete} />);
    expect(await screen.findByText('Batch Ingestion Completed with Warnings')).toBeTruthy();
    expect(screen.getByText('run.fit')).toBeTruthy();
    expect(screen.getAllByText('Imported')).toHaveLength(2);
    expect(screen.getByText('Duplicate')).toBeTruthy();
    expect(screen.getByText('Not a run')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(onImportComplete).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reports empty scans and request failures, then can retry and close', async () => {
    const onClose = vi.fn();
    mocks.scanImportFolder.mockResolvedValueOnce({ results: [] }).mockRejectedValueOnce(new Error('offline'));
    const { rerender } = renderWithLanguage(<GarminScanModal isOpen onClose={onClose} />);
    expect(await screen.findByText('No FIT or CSV files found in this folder.')).toBeTruthy();
    rerender(<LanguageProvider><GarminScanModal isOpen={false} onClose={onClose} /></LanguageProvider>);
    rerender(<LanguageProvider><GarminScanModal isOpen onClose={onClose} /></LanguageProvider>);
    expect(await screen.findByText('Could not scan the import folder.')).toBeTruthy();
    fireEvent.click(document.querySelector('.garmin-scan-footer button')!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
