import React, { useState, useEffect } from 'react';
import { Terminal, Database, Activity, AlertTriangle, RefreshCw, X, ShieldAlert, Cpu, Trash2, ExternalLink } from 'lucide-react';
import { clientLogger, ClientLogEntry } from '../utils/clientLogger';
import { useTranslation } from '../i18n/LanguageContext';

interface DevDiagnosticsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'dark' | 'light';
}

interface ServerDiagnostics {
  status: string;
  timestamp: string;
  system: {
    nodeVersion: string;
    platform: string;
    uptimeSeconds: number;
    memoryMb: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
  };
  db: {
    path: string;
    sizeMb: number;
    activityCount: number;
    intervalCount: number;
    splitCount: number;
    recordCount: number;
  };
  athlete: {
    configured: boolean;
    dob?: string;
    restingHr?: number;
    maxHr?: number;
    lt1Hr?: number;
    lt2Hr?: number;
    baselineEconomyEf?: number;
  };
  logs: any[];
}

export const DevDiagnosticsDrawer: React.FC<DevDiagnosticsDrawerProps> = ({
  isOpen,
  onClose,
  theme = 'dark'
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'logs' | 'server' | 'sandbox'>('logs');
  const [clientLogs, setClientLogs] = useState<ClientLogEntry[]>([]);
  const [serverDiag, setServerDiag] = useState<ServerDiagnostics | null>(null);
  const [loadingServer, setLoadingServer] = useState<boolean>(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [logFilter, setLogFilter] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO'>('ALL');
  const [simulatingError, setSimulatingError] = useState<boolean>(false);

  // Subscribe to client logs
  useEffect(() => {
    setClientLogs(clientLogger.getLogs());
    const unsubscribe = clientLogger.subscribe(() => {
      setClientLogs(clientLogger.getLogs());
    });
    return unsubscribe;
  }, []);

  const fetchServerDiagnostics = async () => {
    try {
      setLoadingServer(true);
      setServerError(null);
      const res = await fetch('/api/dev/diagnostics');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch server diagnostics`);
      }
      const data = await res.json();
      setServerDiag(data);
    } catch (err: any) {
      setServerError(err.message || 'Error fetching server diagnostics');
    } finally {
      setLoadingServer(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchServerDiagnostics();
    }
  }, [isOpen]);

  const handleSimulateApiError = async () => {
    try {
      setSimulatingError(true);
      const res = await fetch('/api/dev/test-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'ERR_SIMULATED_TEST',
          message: 'Dev Mode simulated API 400 test error'
        })
      });
      const errJson = await res.json();
      clientLogger.recordApiCall('/api/dev/test-error', 'POST', res.status, 25, errJson.error);
    } catch (err: any) {
      clientLogger.error('DEV_SANDBOX', 'Simulated network test exception', err);
    } finally {
      setSimulatingError(false);
    }
  };

  const handleSimulateClientError = () => {
    try {
      throw new Error('Dev Mode deliberate client-side component exception');
    } catch (err: any) {
      clientLogger.error('DEV_SANDBOX', err.message, err, {
        simulated: true,
        traceTime: new Date().toISOString()
      });
    }
  };

  if (!isOpen) return null;

  const filteredLogs = clientLogs.filter(log => {
    if (logFilter === 'ALL') return true;
    return log.level === logFilter;
  });

  return (
    <div className="dev-drawer-overlay" onClick={onClose}>
      <aside className="dev-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="dev-drawer-header">
          <div className="dev-drawer-title">
            <Terminal size={18} color="#06b6d4" />
            <span>AEROLAB Dev Diagnostics</span>
            <span className="dev-pill">{t.common.devMode}</span>
          </div>

          <div className="dev-drawer-header-actions">
            <button
              type="button"
              className="dev-refresh-btn"
              onClick={fetchServerDiagnostics}
              title="Refresh diagnostics"
              disabled={loadingServer}
            >
              <RefreshCw size={14} className={loadingServer ? 'spin' : ''} />
            </button>
            <button
              type="button"
              className="dev-close-btn"
              onClick={onClose}
              title="Close Dev Drawer (Ctrl+Shift+D)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Drawer Tabs */}
        <div className="dev-tabs-bar">
          <button
            type="button"
            className={`dev-tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <Terminal size={14} />
            <span>Logs ({filteredLogs.length})</span>
          </button>
          <button
            type="button"
            className={`dev-tab-btn ${activeTab === 'server' ? 'active' : ''}`}
            onClick={() => setActiveTab('server')}
          >
            <Database size={14} />
            <span>Database & SSOT</span>
          </button>
          <button
            type="button"
            className={`dev-tab-btn ${activeTab === 'sandbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('sandbox')}
          >
            <AlertTriangle size={14} />
            <span>Error Sandbox</span>
          </button>
        </div>

        <div className="dev-drawer-body">
          {/* TAB 1: LOGS */}
          {activeTab === 'logs' && (
            <div className="dev-logs-container">
              <div className="dev-logs-toolbar">
                <div className="dev-filter-chips">
                  {(['ALL', 'ERROR', 'WARN', 'INFO'] as const).map(lvl => (
                    <button
                      key={lvl}
                      type="button"
                      className={`dev-filter-chip ${logFilter === lvl ? 'active' : ''}`}
                      onClick={() => setLogFilter(lvl)}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="dev-clear-logs-btn"
                  onClick={() => clientLogger.clear()}
                  title="Clear in-memory logs"
                >
                  <Trash2 size={13} />
                  <span>Clear</span>
                </button>
              </div>

              <div className="dev-logs-list">
                {filteredLogs.length === 0 ? (
                  <div className="dev-empty-state">No logs captured yet.</div>
                ) : (
                  filteredLogs.map(log => {
                    const isErr = log.level === 'ERROR';
                    const isWarn = log.level === 'WARN';
                    const badgeClass = isErr ? 'level-error' : isWarn ? 'level-warn' : 'level-info';
                    return (
                      <div key={log.id} className={`dev-log-item ${badgeClass}`}>
                        <div className="dev-log-meta">
                          <span className={`dev-log-badge ${badgeClass}`}>{log.level}</span>
                          <span className="dev-log-cat">[{log.category}]</span>
                          <span className="dev-log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="dev-log-msg">{log.message}</div>
                        {log.error && (
                          <div className="dev-log-error-detail">
                            <div className="dev-error-name">
                              {log.error.code ? `[${log.error.code}] ` : ''}{log.error.message}
                            </div>
                            {log.error.stack && (
                              <pre className="dev-error-stack">{log.error.stack}</pre>
                            )}
                          </div>
                        )}
                        {log.data && (
                          <pre className="dev-log-data">{JSON.stringify(log.data, null, 2)}</pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SERVER & DATABASE & SSOT */}
          {activeTab === 'server' && (
            <div className="dev-server-container">
              {loadingServer && !serverDiag ? (
                <div className="dev-empty-state">Querying backend metrics...</div>
              ) : serverError ? (
                <div className="dev-error-banner">
                  <ShieldAlert size={16} />
                  <span>{serverError}</span>
                </div>
              ) : serverDiag ? (
                <div className="dev-metrics-scroll">
                  {/* Database Metrics */}
                  <div className="dev-section-title">
                    <Database size={15} color="#06b6d4" />
                    <span>SQLite Storage Metrics</span>
                  </div>
                  <div className="dev-stat-cards-grid">
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Activities Ingested</span>
                      <span className="dev-stat-val">{serverDiag.db.activityCount}</span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Intervals Detected</span>
                      <span className="dev-stat-val">{serverDiag.db.intervalCount}</span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Splits Tracked</span>
                      <span className="dev-stat-val">{serverDiag.db.splitCount}</span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Database File Size</span>
                      <span className="dev-stat-val">{serverDiag.db.sizeMb} MB</span>
                    </div>
                  </div>
                  <div className="dev-subtext">File Path: <code>{serverDiag.db.path}</code></div>

                  {/* SSOT Physiological Anchors */}
                  <div className="dev-section-title" style={{ marginTop: '1.25rem' }}>
                    <Activity size={15} color="#10b981" />
                    <span>Athlete SSOT Threshold Anchors</span>
                  </div>
                  <div className="dev-stat-cards-grid">
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Resting HR</span>
                      <span className="dev-stat-val" style={{ color: '#10b981' }}>
                        {serverDiag.athlete.restingHr ?? '—'} bpm
                      </span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Max HR</span>
                      <span className="dev-stat-val" style={{ color: '#f43f5e' }}>
                        {serverDiag.athlete.maxHr ?? '—'} bpm
                      </span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Calibrated LT1 HR</span>
                      <span className="dev-stat-val" style={{ color: '#06b6d4' }}>
                        {serverDiag.athlete.lt1Hr ?? '—'} bpm
                      </span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Calibrated LT2 HR</span>
                      <span className="dev-stat-val" style={{ color: '#f59e0b' }}>
                        {serverDiag.athlete.lt2Hr ?? '—'} bpm
                      </span>
                    </div>
                  </div>

                  {/* System & Memory */}
                  <div className="dev-section-title" style={{ marginTop: '1.25rem' }}>
                    <Cpu size={15} color="#8b5cf6" />
                    <span>Node Process & Memory</span>
                  </div>
                  <div className="dev-stat-cards-grid">
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Node Version</span>
                      <span className="dev-stat-val" style={{ fontSize: '0.95rem' }}>
                        {serverDiag.system.nodeVersion}
                      </span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Server Uptime</span>
                      <span className="dev-stat-val">
                        {Math.floor(serverDiag.system.uptimeSeconds / 60)}m {serverDiag.system.uptimeSeconds % 60}s
                      </span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">Heap Memory</span>
                      <span className="dev-stat-val">
                        {serverDiag.system.memoryMb.heapUsed} / {serverDiag.system.memoryMb.heapTotal} MB
                      </span>
                    </div>
                    <div className="dev-stat-card">
                      <span className="dev-stat-label">RSS Memory</span>
                      <span className="dev-stat-val">
                        {serverDiag.system.memoryMb.rss} MB
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* TAB 3: ERROR SANDBOX */}
          {activeTab === 'sandbox' && (
            <div className="dev-sandbox-container">
              <div className="dev-sandbox-card">
                <h4>Diagnose & Verify Error Handling</h4>
                <p>
                  Trigger simulated backend and frontend errors to confirm that structured error codes, stack traces, and diagnostics render accurately without crashing the application.
                </p>

                <div className="dev-sandbox-actions">
                  <button
                    type="button"
                    className="dev-action-btn"
                    onClick={handleSimulateApiError}
                    disabled={simulatingError}
                  >
                    <AlertTriangle size={15} color="#f59e0b" />
                    <span>{simulatingError ? 'Sending...' : 'Trigger API 400 Error'}</span>
                  </button>

                  <button
                    type="button"
                    className="dev-action-btn"
                    onClick={handleSimulateClientError}
                  >
                    <ShieldAlert size={15} color="#f43f5e" />
                    <span>Trigger Client-Side Error</span>
                  </button>
                </div>
              </div>

              <div className="dev-sandbox-info">
                <h5>Keyboard Shortcuts & Tips</h5>
                <ul>
                  <li>Press <code>Ctrl + Shift + D</code> (or <code>Cmd + Shift + D</code>) anywhere to toggle this Dev Diagnostics Drawer.</li>
                  <li>All HTTP requests, 4xx/5xx responses, and uncaught exceptions are automatically captured in the in-memory ring buffer.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};
