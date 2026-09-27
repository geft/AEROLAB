import React from 'react';
import { X, Award, Zap, CheckCircle, Target } from 'lucide-react';
import { formatPace } from '../utils/formatters.js';
import { useTranslation } from '../i18n/LanguageContext.js';

interface VdotGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVdot?: number | null;
}

export const VdotGuideModal: React.FC<VdotGuideModalProps> = ({
  isOpen,
  onClose,
  currentVdot = null
}) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const effVdot = currentVdot && currentVdot >= 25 && currentVdot <= 85 ? currentVdot : 45.0;
  // Calculate threshold velocity (m/min) at 88% VO2max from VDOT
  const a = 0.000104;
  const b = 0.182258;
  const c = -(0.88 * effVdot + 4.6);
  const disc = Math.max(0, b * b - 4 * a * c);
  const vMpm = (-b + Math.sqrt(disc)) / (2 * a);
  const thresholdSecKm = vMpm > 0 ? (1000 / vMpm) * 60 : 277;

  const easyPaceRange = `${formatPace(thresholdSecKm * 1.28)} – ${formatPace(thresholdSecKm * 1.42)}`;
  const marathonPaceRange = `${formatPace(thresholdSecKm * 1.10)} – ${formatPace(thresholdSecKm * 1.16)}`;
  const thresholdPaceRange = `${formatPace(thresholdSecKm * 0.98)} – ${formatPace(thresholdSecKm * 1.02)}`;
  const intervalPaceRange = `${formatPace(thresholdSecKm * 0.91)} – ${formatPace(thresholdSecKm * 0.94)}`;

  const tiers = [
    {
      range: '35 – 44',
      label: t.vdotGuide.recreational,
      equiv5k: '25:12 – 30:40',
      equivHalf: '1:55:00 – 2:21:00',
      equivMarathon: '3:58:00 – 4:51:00',
      badgeColor: '#64748b',
      isCurrent: currentVdot != null && currentVdot >= 35 && currentVdot < 45,
      isTarget: false
    },
    {
      range: '45 – 54',
      label: t.vdotGuide.trainedRunner,
      equiv5k: '21:00 – 25:00',
      equivHalf: '1:36:00 – 1:54:00',
      equivMarathon: '3:20:00 – 3:56:00',
      badgeColor: '#06b6d4',
      isCurrent: currentVdot != null && currentVdot >= 45 && currentVdot < 55,
      isTarget: currentVdot != null && currentVdot >= 35 && currentVdot < 45
    },
    {
      range: '55 – 64',
      label: t.vdotGuide.advancedClub,
      equiv5k: '17:45 – 20:50',
      equivHalf: '1:21:00 – 1:35:00',
      equivMarathon: '2:50:00 – 3:19:00',
      badgeColor: '#10b981',
      isCurrent: currentVdot != null && currentVdot >= 55 && currentVdot < 65,
      isTarget: currentVdot != null && currentVdot >= 45 && currentVdot < 55
    },
    {
      range: '65 – 74',
      label: t.vdotGuide.subElite,
      equiv5k: '15:20 – 17:35',
      equivHalf: '1:10:00 – 1:20:00',
      equivMarathon: '2:27:00 – 2:49:00',
      badgeColor: '#f59e0b',
      isCurrent: currentVdot != null && currentVdot >= 65 && currentVdot < 75,
      isTarget: currentVdot != null && currentVdot >= 55 && currentVdot < 65
    },
    {
      range: '75 – 85+',
      label: t.vdotGuide.worldClass,
      equiv5k: t.vdotGuide.equivSub15,
      equivHalf: t.vdotGuide.equivSub108,
      equivMarathon: t.vdotGuide.equivSub224,
      badgeColor: '#8b5cf6',
      isCurrent: currentVdot != null && currentVdot >= 75 && currentVdot < 100,
      isTarget: currentVdot != null && currentVdot >= 65 && currentVdot < 75
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
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{t.vdotGuide.modalTitle}</h2>
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
              <span className="formula-part">{t.vdotGuide.formulaTitle}</span>
              <span className="formula-div">=</span>
              <span className="formula-res" style={{ color: '#a78bfa' }}>
                {t.vdotGuide.formulaResult}
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
              {t.vdotGuide.conceptDesc}
            </p>
          </div>

          {/* Current Level Highlight */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.vdotGuide.tiersTitle}
              </span>
              <span style={{ fontSize: '0.75rem', color: '#a78bfa', fontWeight: 700 }}>
                {t.vdotGuide.estimatedVdot}: {currentVdot ?? '—'}
              </span>
            </div>

            <div className="economy-tiers-list">
              {tiers.map(tier => (
                <div
                  key={tier.range}
                  className={`economy-tier-card ${tier.isCurrent ? 'tier-current' : ''} ${tier.isTarget ? 'tier-target' : ''}`}
                  style={tier.isCurrent ? { borderColor: 'rgba(139, 92, 246, 0.5)', background: 'rgba(139, 92, 246, 0.06)' } : {}}
                >
                  <div className="tier-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="tier-range-badge" style={{ borderColor: tier.badgeColor, color: tier.badgeColor }}>
                        VDOT {tier.range}
                      </span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {tier.label}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {tier.isCurrent && (
                        <span className="tier-tag current" style={{ borderColor: 'rgba(139, 92, 246, 0.4)', background: 'rgba(139, 92, 246, 0.15)', color: '#c084fc' }}>
                          <CheckCircle size={11} style={{ marginRight: 3 }} /> {t.vdotGuide.yourCurrentLevel} ({currentVdot ?? '—'})
                        </span>
                      )}
                      {tier.isTarget && (
                        <span className="tier-tag target">
                          <Target size={11} style={{ marginRight: 3 }} /> {t.economyGuide.nextTarget}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="tier-desc" style={{ marginTop: '0.35rem', color: 'var(--text-secondary)' }}>
                    <b>{t.vdotGuide.equivRaceTimes}:</b> 5K: {tier.equiv5k} • {t.vdotGuide.equivHalf}: {tier.equivHalf} • {t.vdotGuide.equivFull}: {tier.equivMarathon}
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
                {t.vdotGuide.trainingPacesTitle} {currentVdot ?? '—'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem', marginTop: '0.5rem' }}>
              <div className="vdot-pace-range">
                <div>{t.vdotGuide.easyBase}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--chart-series-green)' }}>{easyPaceRange} /km</div>
              </div>
              <div className="vdot-pace-range">
                <div>{t.vdotGuide.marathonPace}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--chart-series-cyan)' }}>{marathonPaceRange} /km</div>
              </div>
              <div className="vdot-pace-range">
                <div>{t.vdotGuide.thresholdLt2}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--chart-series-amber)' }}>{thresholdPaceRange} /km</div>
              </div>
              <div className="vdot-pace-range">
                <div>{t.vdotGuide.intervalsVo2}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--chart-series-pink)' }}>{intervalPaceRange} /km</div>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="primary-btn" onClick={onClose}>
            {t.vdotGuide.gotIt}
          </button>
        </div>
      </div>
    </div>
  );
};
