import React from 'react';
import { X, Award, Target, Activity, Zap, CheckCircle } from 'lucide-react';

interface VdotGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVdot?: number;
}

export const VdotGuideModal: React.FC<VdotGuideModalProps> = ({
  isOpen,
  onClose,
  currentVdot = 58
}) => {
  if (!isOpen) return null;

  const tiers = [
    {
      range: '35 – 44',
      label: 'Developing / Recreational',
      equiv5k: '25:12 – 30:40',
      equivHalf: '1:55:00 – 2:21:00',
      equivMarathon: '3:58:00 – 4:51:00',
      badgeColor: '#64748b',
      isCurrent: false
    },
    {
      range: '45 – 54',
      label: 'Trained Distance Runner',
      equiv5k: '21:00 – 25:00',
      equivHalf: '1:36:00 – 1:54:00',
      equivMarathon: '3:20:00 – 3:56:00',
      badgeColor: '#06b6d4',
      isCurrent: false
    },
    {
      range: '55 – 64',
      label: 'Advanced Competitive Club',
      equiv5k: '17:45 – 20:50',
      equivHalf: '1:21:00 – 1:35:00',
      equivMarathon: '2:50:00 – 3:19:00',
      badgeColor: '#10b981',
      isCurrent: true
    },
    {
      range: '65 – 74',
      label: 'Sub-Elite / Regional Podium',
      equiv5k: '15:20 – 17:35',
      equivHalf: '1:10:00 – 1:20:00',
      equivMarathon: '2:27:00 – 2:49:00',
      badgeColor: '#f59e0b',
      isCurrent: false
    },
    {
      range: '75 – 85+',
      label: 'World Class / Elite',
      equiv5k: 'Sub-15:00',
      equivHalf: 'Sub-1:08:00',
      equivMarathon: 'Sub-2:24:00',
      badgeColor: '#8b5cf6',
      isCurrent: false
    }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card vdot-guide-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Award size={20} color="#8b5cf6" />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Estimated VO2 Max &amp; VDOT Guide</h2>
          </div>
          <button
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close guide"
          >
            <X size={18} />
          </button>
        </div>

        <div className="economy-guide-body">
          {/* Core Concept */}
          <div className="economy-concept-box" style={{ borderColor: 'rgba(139, 92, 246, 0.3)', background: 'rgba(139, 92, 246, 0.06)' }}>
            <div className="economy-formula-pill" style={{ color: '#c084fc' }}>
              <span className="formula-part">Daniels' VDOT</span>
              <span className="formula-div">=</span>
              <span className="formula-res" style={{ color: '#a78bfa' }}>
                Effective VO2 Max (Velocity at VO2 Max + Running Economy)
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
              <b>VDOT</b> was pioneered by legendary exercise physiologist Dr. Jack Daniels. 
              Rather than measuring pure laboratory lung capacity, VDOT measures your <i>functional aerobic power</i>: 
              combining your true VO2 Max with your mechanical efficiency and lactate clearance ability.
            </p>
          </div>

          {/* Current Level Highlight */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                VDOT Fitness Tiers &amp; Equivalent Race Potential
              </span>
              <span style={{ fontSize: '0.75rem', color: '#a78bfa', fontWeight: 700 }}>
                Your Estimated VDOT: {currentVdot}
              </span>
            </div>

            <div className="economy-tiers-list">
              {tiers.map(t => (
                <div
                  key={t.range}
                  className={`economy-tier-card ${t.isCurrent ? 'tier-current' : ''}`}
                  style={t.isCurrent ? { borderColor: 'rgba(139, 92, 246, 0.5)', background: 'rgba(139, 92, 246, 0.06)' } : {}}
                >
                  <div className="tier-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="tier-range-badge" style={{ borderColor: t.badgeColor, color: t.badgeColor }}>
                        VDOT {t.range}
                      </span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {t.label}
                      </span>
                    </div>

                    {t.isCurrent && (
                      <span className="tier-tag current" style={{ borderColor: 'rgba(139, 92, 246, 0.4)', background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc' }}>
                        <CheckCircle size={11} style={{ marginRight: 3 }} /> Your Current Level ({currentVdot})
                      </span>
                    )}
                  </div>

                  <div className="tier-desc" style={{ marginTop: '0.35rem', color: 'var(--text-secondary)' }}>
                    <b>Equivalent Race Times:</b> 5K: {t.equiv5k} • Half: {t.equivHalf} • Marathon: {t.equivMarathon}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Training Paces for current VDOT */}
          <div className="economy-gains-banner" style={{ borderColor: 'rgba(139, 92, 246, 0.3)', background: 'rgba(139, 92, 246, 0.07)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <Zap size={16} color="#c084fc" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#c084fc' }}>
                Daniels' Training Paces for VDOT {currentVdot}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem', marginTop: '0.5rem' }}>
              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.4rem 0.6rem', borderRadius: 6 }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Easy / Aerobic Base</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#10b981' }}>5:15 – 5:45 /km</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.4rem 0.6rem', borderRadius: 6 }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Marathon Pace</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#38bdf8' }}>4:05 – 4:15 /km</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.4rem 0.6rem', borderRadius: 6 }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Threshold (LT2)</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f59e0b' }}>3:50 – 4:00 /km</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.25)', padding: '0.4rem 0.6rem', borderRadius: 6 }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Intervals (VO2 Max)</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#ec4899' }}>3:30 – 3:40 /km</div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button className="primary-btn" onClick={onClose}>
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
