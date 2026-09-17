const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { DiagnosticLogger, getSplashScreenHtml, getErrorScreenHtml } = require('./diagnostics.cjs');

// Enable Chrome DevTools Remote Debugging hook on port 9222
// Users and diagnostic tools can connect to http://127.0.0.1:9222 to inspect running state
try {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
} catch {}

let mainWindow = null;
let lastStartupError = null;

// Determine paths and data locations
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 3001;

const userDataPath = app.getPath('userData');
const dbDir = isDev ? path.resolve(process.cwd(), 'data') : userDataPath;
const dbPath = path.join(dbDir, 'runs.db');
const logFilePath = path.join(userDataPath, 'aerolab-startup.log');

process.env.DATABASE_PATH = dbPath;
process.env.PORT = String(PORT);

const logger = new DiagnosticLogger(logFilePath);

const envInfo = {
  appVersion: app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  chromeVersion: process.versions.chrome,
  platform: process.platform,
  arch: process.arch,
  port: PORT,
  dbPath,
  logFilePath
};

function renderScreen(html) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    mainWindow.loadURL(dataUrl).catch(err => {
      logger.error('Failed to load screen data URL:', err);
    });
  }
}

function showDiagnosticError(errorCode, title, message, error = null) {
  logger.error(`${errorCode}: ${message}`, error);
  const html = getErrorScreenHtml({
    errorCode,
    errorTitle: title,
    errorMessage: message,
    errorStack: error ? (error.stack || String(error)) : null,
    envInfo,
    logs: logger.getRecentLogs(50)
  });
  renderScreen(html);
}

// Global exception handlers
process.on('uncaughtException', (err) => {
  lastStartupError = err;
  logger.error('Uncaught Exception in Main Process', err);
  showDiagnosticError('UNCAUGHT_EXCEPTION', 'Uncaught Main Process Exception', err.message, err);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  lastStartupError = err;
  logger.error('Unhandled Rejection in Main Process', err);
  showDiagnosticError('UNHANDLED_REJECTION', 'Unhandled Promise Rejection', err.message, err);
});

function startServer() {
  try {
    const backendPath = path.join(__dirname, '..', 'dist-backend', 'server.cjs');
    logger.info(`Checking backend module at: ${backendPath}`);
    if (fs.existsSync(backendPath)) {
      logger.info('Loading backend module via require()...');
      require(backendPath);
      logger.info('Backend module initialized successfully.');
    } else {
      const err = new Error(`dist-backend/server.cjs not found at: ${backendPath}`);
      logger.warn('Backend file missing', err);
      lastStartupError = err;
    }
  } catch (err) {
    logger.error('Error executing backend server module', err);
    lastStartupError = err;
  }
}

async function waitForServer(url, timeoutMs = 15000) {
  const startTime = Date.now();
  logger.info(`Polling server readiness at ${url} (timeout: ${timeoutMs}ms)...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const ok = await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode < 500) resolve(true);
          else reject(new Error(`Server responded with HTTP ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(600, () => {
          req.destroy();
          reject(new Error('Connection timed out'));
        });
      });
      if (ok) {
        logger.info(`Server responded OK after ${Date.now() - startTime}ms.`);
        return true;
      }
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return false;
}

function setupApplicationMenu() {
  const template = [
    {
      label: 'AEROLAB',
      submenu: [
        { label: 'About AEROLAB', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => mainWindow && mainWindow.webContents.toggleDevTools()
        },
        {
          label: 'Toggle DevTools (Alt)',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow && mainWindow.webContents.toggleDevTools()
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Show Diagnostic Log File',
          click: () => shell.showItemInFolder(logFilePath)
        },
        {
          label: 'View Diagnostics Screen',
          click: () => {
            showDiagnosticError(
              'MANUAL_DIAGNOSTIC',
              'Manual Diagnostics View',
              'Developer diagnostics requested via application menu.',
              lastStartupError
            );
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: `AEROLAB v${app.getVersion()} — Physiological Running Analytics`,
    backgroundColor: '#0b1120',
    autoHideMenuBar: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  setupApplicationMenu();

  // Show window immediately once rendered
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle external links safely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept keyboard shortcuts for DevTools (F12, Ctrl+Shift+I)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Intercept diagnostic screen action URLs (aerolab://...)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('aerolab://')) {
      event.preventDefault();
      const action = url.replace('aerolab://', '').split('?')[0];
      logger.info(`Action triggered: ${action}`);

      if (action === 'devtools') {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      } else if (action === 'open-logs') {
        shell.showItemInFolder(logFilePath);
      } else if (action === 'retry') {
        bootstrapApplication();
      } else if (action === 'restart') {
        app.relaunch();
        app.exit(0);
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function bootstrapApplication() {
  logger.info(`Bootstrapping AEROLAB Application...`);
  renderScreen(getSplashScreenHtml('Initializing physiological database & services...'));

  if (lastStartupError) {
    lastStartupError = null;
  }

  startServer();

  const healthUrl = `http://localhost:${PORT}/api/health`;
  const healthy = await waitForServer(healthUrl, 12000);

  if (healthy) {
    logger.info(`Backend verified healthy. Loading main application interface...`);
    const appUrl = `http://localhost:${PORT}`;
    
    let failCount = 0;
    const failHandler = () => {
      failCount++;
      logger.warn(`Failed loading ${appUrl} (attempt ${failCount})`);
      if (failCount >= 5) {
        mainWindow.webContents.removeListener('did-fail-load', failHandler);
        showDiagnosticError(
          'ERR_LOAD_FAILED',
          'Failed to Render Application Interface',
          `Could not connect to ${appUrl} after 5 attempts.`,
          lastStartupError
        );
      }
    };

    mainWindow.webContents.on('did-fail-load', failHandler);
    mainWindow.loadURL(appUrl).catch(err => {
      logger.error(`loadURL failed for ${appUrl}:`, err);
      showDiagnosticError(
        'ERR_LOAD_FAILED',
        'Failed to Connect to Application Server',
        err.message,
        err
      );
    });
  } else {
    logger.error(`Server health check timed out at ${healthUrl}`);
    showDiagnosticError(
      'ERR_BACKEND_TIMEOUT',
      'Backend Engine Failed to Start',
      `The AEROLAB backend service did not respond on port ${PORT} within 12 seconds.`,
      lastStartupError
    );
  }
}

app.whenReady().then(async () => {
  logger.info(`=== AEROLAB Launched (v${app.getVersion()}) ===`);
  logger.info(`Platform: ${process.platform} (${process.arch}), Node: ${process.versions.node}, Electron: ${process.versions.electron}`);
  logger.info(`Data directory: ${userDataPath}`);
  logger.info(`Database path: ${dbPath}`);
  logger.info(`Remote debugging available at: http://127.0.0.1:9222`);

  createWindow();
  await bootstrapApplication();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      bootstrapApplication();
    }
  });
});

app.on('window-all-closed', () => {
  logger.info('All windows closed. Terminating application.');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
