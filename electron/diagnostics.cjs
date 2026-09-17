/**
 * AEROLAB Electron Diagnostic & Error Recovery System
 * 
 * Provides:
 * - Persistent startup file logging (%APPDATA%/aerolab/startup.log)
 * - Visual Loading Splash Screen
 * - Comprehensive Diagnostic BSOD-style Error Recovery Screen with actionable buttons:
 *   - Open DevTools (F12)
 *   - Open Log File in Explorer
 *   - Retry Startup
 *   - Copy Diagnostics Report
 */

const fs = require('fs');
const path = require('path');

class DiagnosticLogger {
  constructor(logFilePath) {
    this.logFilePath = logFilePath;
    this.logs = [];
    try {
      const dir = path.dirname(logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Reset or truncate log file on fresh launch
      fs.writeFileSync(logFilePath, `=== AEROLAB Startup Log [${new Date().toISOString()}] ===\n`, 'utf8');
    } catch {}
  }

  log(level, message, error = null) {
    const ts = new Date().toISOString();
    let entry = `[${ts}] [${level.toUpperCase()}] ${message}`;
    if (error) {
      entry += `\n  Error: ${error.message || String(error)}`;
      if (error.stack) {
        entry += `\n  Stack: ${error.stack}`;
      }
      if (error.code) {
        entry += `\n  Code: ${error.code}`;
      }
    }
    this.logs.push(entry);
    console.log(entry);

    try {
      fs.appendFileSync(this.logFilePath, entry + '\n', 'utf8');
    } catch {}
  }

  info(message) {
    this.log('info', message);
  }

  warn(message, error = null) {
    this.log('warn', message, error);
  }

  error(message, error = null) {
    this.log('error', message, error);
  }

  getRecentLogs(limit = 40) {
    return this.logs.slice(-limit);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSplashScreenHtml(statusMessage = 'Initializing physiological analytics engine...') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Starting AEROLAB</title>
  <style>
    * { box-sizing: border-box; }
    body {
      background: #0b1120;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      user-select: none;
      overflow: hidden;
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 40px;
      max-width: 520px;
    }
    .logo-badge {
      width: 72px;
      height: 72px;
      border-radius: 20px;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 28px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(56, 189, 248, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.85s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
      margin: 0 0 10px 0;
      background: linear-gradient(to right, #ffffff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.status {
      margin: 0;
      font-size: 14px;
      color: #94a3b8;
      line-height: 1.5;
    }
    .footer-hint {
      margin-top: 36px;
      font-size: 12px;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .key-badge {
      background: #1e293b;
      border: 1px solid #334155;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-badge">
      <div class="spinner"></div>
    </div>
    <h1>AEROLAB</h1>
    <p class="status">${escapeHtml(statusMessage)}</p>
    <div class="footer-hint">
      Press <span class="key-badge">F12</span> at any time to open Developer Diagnostics
    </div>
  </div>
</body>
</html>`;
}

function getErrorScreenHtml({ errorCode, errorTitle, errorMessage, errorStack, envInfo, logs = [] }) {
  const jsonReport = JSON.stringify({
    timestamp: new Date().toISOString(),
    errorCode,
    errorTitle,
    errorMessage,
    errorStack,
    envInfo,
    recentLogs: logs
  }, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AEROLAB Diagnostic & Recovery</title>
  <style>
    * { box-sizing: border-box; }
    body {
      background: #0a0f1d;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 40px 32px;
      display: flex;
      justify-content: center;
      min-height: 100vh;
      overflow-y: auto;
    }
    .wrapper {
      max-width: 960px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .header-card {
      background: #111827;
      border: 1px solid #ef4444;
      border-radius: 12px;
      padding: 24px;
      display: flex;
      align-items: flex-start;
      gap: 20px;
      box-shadow: 0 10px 30px -10px rgba(239, 68, 68, 0.2);
    }
    .error-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ef4444;
      font-size: 24px;
      font-weight: bold;
      flex-shrink: 0;
    }
    .header-text {
      flex: 1;
    }
    .code-badge {
      display: inline-block;
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      font-family: monospace;
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
      margin-bottom: 8px;
      border: 1px solid rgba(239, 68, 68, 0.4);
    }
    h1 {
      margin: 0 0 6px 0;
      font-size: 20px;
      font-weight: 700;
      color: #ffffff;
    }
    .error-msg {
      margin: 0;
      color: #e2e8f0;
      font-size: 14px;
      line-height: 1.5;
    }
    .action-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      border: 1px solid transparent;
      user-select: none;
    }
    .btn-primary {
      background: #3b82f6;
      color: #ffffff;
    }
    .btn-primary:hover {
      background: #2563eb;
    }
    .btn-secondary {
      background: #1e293b;
      color: #e2e8f0;
      border-color: #334155;
    }
    .btn-secondary:hover {
      background: #334155;
      color: #ffffff;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 20px;
    }
    .card-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      margin: 0 0 14px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .env-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
    }
    .env-item {
      background: #1e293b;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      overflow: hidden;
    }
    .env-label {
      color: #64748b;
      font-weight: 500;
    }
    .env-val {
      color: #f1f5f9;
      font-family: monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    pre.code-block {
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 14px;
      color: #fca5a5;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.6;
      margin: 0;
      overflow-x: auto;
      max-height: 240px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    pre.log-block {
      color: #cbd5e1;
      max-height: 280px;
    }
    .toast {
      display: none;
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10b981;
      color: #ffffff;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 10px 20px rgba(0,0,0,0.4);
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header-card">
      <div class="error-icon">!</div>
      <div class="header-text">
        <span class="code-badge">ERROR_CODE: ${escapeHtml(errorCode)}</span>
        <h1>${escapeHtml(errorTitle || 'Startup Error Detected')}</h1>
        <p class="error-msg">${escapeHtml(errorMessage || 'The local AEROLAB engine encountered an issue during startup.')}</p>
      </div>
    </div>

    <div class="action-bar">
      <a href="aerolab://devtools" class="btn btn-primary">
        🔍 Open Developer Tools (F12)
      </a>
      <a href="aerolab://retry" class="btn btn-secondary">
        🔄 Retry Connection
      </a>
      <a href="aerolab://open-logs" class="btn btn-secondary">
        📁 Open Log File in Explorer
      </a>
      <a href="aerolab://restart" class="btn btn-secondary">
        ⚡ Restart App
      </a>
      <button onclick="copyReport()" class="btn btn-secondary">
        📋 Copy Diagnostics Report
      </button>
    </div>

    ${errorStack ? `
    <div class="card">
      <div class="card-title">Error Stack Trace</div>
      <pre class="code-block">${escapeHtml(errorStack)}</pre>
    </div>
    ` : ''}

    <div class="card">
      <div class="card-title">Environment & Configuration</div>
      <div class="env-grid">
        <div class="env-item">
          <span class="env-label">AEROLAB Version</span>
          <span class="env-val">${escapeHtml(envInfo.appVersion || '1.0.0')}</span>
        </div>
        <div class="env-item">
          <span class="env-label">Electron / Node</span>
          <span class="env-val">${escapeHtml(envInfo.electronVersion || '')} / ${escapeHtml(envInfo.nodeVersion || '')}</span>
        </div>
        <div class="env-item">
          <span class="env-label">Platform / Arch</span>
          <span class="env-val">${escapeHtml(envInfo.platform || '')} ${escapeHtml(envInfo.arch || '')}</span>
        </div>
        <div class="env-item">
          <span class="env-label">Backend Port</span>
          <span class="env-val">${escapeHtml(String(envInfo.port || '3001'))}</span>
        </div>
        <div class="env-item" style="grid-column: 1 / -1;">
          <span class="env-label">Database Path</span>
          <span class="env-val" title="${escapeHtml(envInfo.dbPath || '')}">${escapeHtml(envInfo.dbPath || '')}</span>
        </div>
        <div class="env-item" style="grid-column: 1 / -1;">
          <span class="env-label">Startup Log File</span>
          <span class="env-val" title="${escapeHtml(envInfo.logFilePath || '')}">${escapeHtml(envInfo.logFilePath || '')}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Recent Startup Events</div>
      <pre class="code-block log-block">${escapeHtml(logs.join('\n') || 'No startup log events recorded.')}</pre>
    </div>
  </div>

  <div id="toast" class="toast">Diagnostics copied to clipboard!</div>

  <script>
    const reportData = ${JSON.stringify(jsonReport)};

    function copyReport() {
      navigator.clipboard.writeText(reportData).then(() => {
        const toast = document.getElementById('toast');
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 2500);
      }).catch(err => {
        alert('Report text:\\n\\n' + reportData);
      });
    }

    // Keyboard shortcut for DevTools
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i')) {
        window.location.href = 'aerolab://devtools';
      }
    });
  </script>
</body>
</html>`;
}

module.exports = {
  DiagnosticLogger,
  getSplashScreenHtml,
  getErrorScreenHtml
};
