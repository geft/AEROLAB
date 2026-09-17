const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;

// Determine paths and data locations
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 3001;

// In packaged mode, user database lives in standard OS AppData location (%APPDATA%/aerolab/runs.db)
const userDataPath = app.getPath('userData');
const dbDir = isDev ? path.resolve(process.cwd(), 'data') : userDataPath;
const dbPath = path.join(dbDir, 'runs.db');

process.env.DATABASE_PATH = dbPath;
process.env.PORT = String(PORT);

function startServer() {
  try {
    const backendPath = path.join(__dirname, '..', 'dist-backend', 'server.js');
    if (fs.existsSync(backendPath)) {
      import('file://' + backendPath.replace(/\\/g, '/')).catch(err => {
        console.error('Failed to start internal backend:', err);
      });
    } else {
      console.warn('dist-backend/server.js not found, assuming external or dev server running.');
    }
  } catch (err) {
    console.error('Error starting backend server:', err);
  }
}

async function waitForServer(url, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode < 500) resolve(true);
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(500, () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  return false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: `AEROLAB v${app.getVersion()} — Physiological Running Analytics`,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const loadUrl = `http://localhost:${PORT}`;
  mainWindow.loadURL(loadUrl).catch(err => {
    console.error('Failed to load app URL:', err);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startServer();
  await waitForServer(`http://localhost:${PORT}/api/health`, 12000);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
