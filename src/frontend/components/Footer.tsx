import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="app-footer">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'center' }}>
        <div>
          <b style={{ color: '#fff' }}>AEROLAB</b> Running Dynamics & Physiology Lab • Local & Offline-First
        </div>
        <div style={{ color: '#64748b', fontSize: '0.75rem' }}>
          Designed for GJ • 2026
        </div>
      </div>
    </footer>
  );
};
