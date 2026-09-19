import fs from 'fs';
import { logger } from '../utils/logger.js';

export interface GDriveFile {
  id: string;
  name: string;
  sizeBytes: number;
  createdTime: string;
  webViewLink?: string;
}

export async function ensureBackupFolder(accessToken: string): Promise<string> {
  // Search for folder
  const query = encodeURIComponent("name = 'AEROLAB_Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Failed to search Google Drive folders: ${errText}`);
  }

  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'AEROLAB_Backups',
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Automated database backups from AEROLAB Running Progress Dashboard'
    })
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create AEROLAB_Backups folder: ${errText}`);
  }

  const createData = await createRes.json();
  return createData.id;
}

export async function listGoogleDriveBackups(accessToken: string): Promise<GDriveFile[]> {
  try {
    const folderId = await ensureBackupFolder(accessToken);
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime%20desc&fields=files(id,name,size,createdTime,webViewLink)`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Drive API error: ${errText}`);
    }

    const data = await res.json();
    return (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      sizeBytes: parseInt(f.size || '0', 10),
      createdTime: f.createdTime,
      webViewLink: f.webViewLink
    }));
  } catch (err: any) {
    logger.error('GoogleDrive', 'Error listing backups', err);
    throw err;
  }
}

export async function uploadBackupToGoogleDrive(
  accessToken: string,
  localFilePath: string,
  filename: string
): Promise<GDriveFile> {
  const folderId = await ensureBackupFolder(accessToken);
  const fileContent = fs.readFileSync(localFilePath);

  const boundary = `-------314159265358979323846_${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = JSON.stringify({
    name: filename,
    parents: [folderId],
    description: 'AEROLAB Database Snapshot'
  });

  const multipartBody = Buffer.concat([
    Buffer.from(
      `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}` +
      `${delimiter}Content-Type: application/octet-stream\r\n\r\n`
    ),
    fileContent,
    Buffer.from(closeDelimiter)
  ]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(multipartBody.length)
    },
    body: multipartBody
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Google Drive upload failed: ${errText}`);
  }

  const uploaded = await uploadRes.json();

  // Prune older backups on Google Drive to retain only the newest 10
  try {
    await pruneGoogleDriveBackups(accessToken, folderId, 10);
  } catch (pruneErr) {
    logger.warn('GoogleDrive', 'Non-fatal error during backup rotation', { error: String(pruneErr) });
  }

  return {
    id: uploaded.id,
    name: uploaded.name,
    sizeBytes: parseInt(uploaded.size || String(fileContent.length), 10),
    createdTime: uploaded.createdTime || new Date().toISOString(),
    webViewLink: uploaded.webViewLink
  };
}

export async function pruneGoogleDriveBackups(accessToken: string, folderId: string, keepCount: number = 10): Promise<void> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime%20desc&fields=files(id,createdTime)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) return;
  const data = await res.json();
  const files: Array<{ id: string }> = data.files || [];

  if (files.length > keepCount) {
    const toDelete = files.slice(keepCount);
    for (const f of toDelete) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      } catch {}
    }
  }
}

export async function downloadBackupFromGoogleDrive(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to download backup file from Google Drive: ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
