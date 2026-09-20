import React from 'react';
import { X, BookOpen, Target, CheckCircle } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext.js';

interface EconomyGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEf?: number | null;
  lt1Hr?: number | null;
  lt2Hr?: number | null;
}

export const EconomyGuideModal: React.FC<EconomyGuideModalProps> = ({
  isOpen,
  onClose,
  currentEf = null,
  lt1Hr,
  lt2Hr
}) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  const effectiveLt1 = lt1Hr ?? '—';
  const effectiveLt2 = lt2Hr ?? '—';
  const activeEf = currentEf ?? 0;

  const tiers = [
    {
      range: '0.90 – 1.05',
      label: t.economyGuide.developingBase,
      paceExample: t.economyGuide.paceDeveloping,
      desc: t.economyGuide.developingBaseDesc,
      badgeColor: '#64748b',
      isCurrent: currentEf != null && activeEf >= 0.90 && activeEf < 1.10,
      isTarget: false
    },
    {
      range: '1.10 – 1.25',
      label: t.economyGuide.solidRunner,
      paceExample: t.economyGuide.paceSolid,
      desc: t.economyGuide.solidRunnerDesc,
      badgeColor: '#06b6d4',
      isCurrent: currentEf != null && activeEf >= 1.10 && activeEf < 1.25,
      isTarget: false
    },
    {
      range: '1.25 – 1.40',
      label: t.economyGuide.advancedRunner,
      paceExample: t.economyGuide.paceAdvanced,
      desc: t.economyGuide.advancedRunnerDesc,
      badgeColor: '#10b981',
      isCurrent: currentEf != null && activeEf >= 1.25 && activeEf < 1.45,
      isTarget: currentEf != null && activeEf < 1.25
    },
    {
      range: '1.45 – 1.65',
      label: t.economyGuide.competitiveRacer,
      paceExample: t.economyGuide.paceCompetitive,
      desc: t.economyGuide.competitiveRacerDesc,
      badgeColor: '#f59e0b',
      isCurrent: currentEf != null && activeEf >= 1.45 && activeEf < 1.70,
      isTarget: currentEf != null && activeEf >= 1.25 && activeEf < 1.45
    },
    {
      range: '1.70 – 2.00+',
      label: t.economyGuide.eliteMarathoner,
      paceExample: t.economyGuide.paceElite,
      desc: t.economyGuide.eliteMarathonerDesc,
      badgeColor: '#8b5cf6',
      isCurrent: currentEf != null && activeEf >= 1.70,
      isTarget: currentEf != null && activeEf >= 1.45 && activeEf < 1.70
    }
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card economy-guide-modal"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <BookOpen size={20} color="var(--accent-cyan)" />
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{t.economyGuide.modalTitle}</h2>
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
          {/* Core Concept Banner */}
          <div className="economy-concept-box">
            <div className="economy-formula-pill">
              <span className="formula-part">{t.economyGuide.speedPart}</span>
              <span className="formula-div">÷</span>
              <span className="formula-part">{t.economyGuide.hrPart}</span>
              <span className="formula-div">=</span>
              <span className="formula-res">{t.economyGuide.formulaResult}</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
              {t.economyGuide.conceptDesc}
            </p>
          </div>

          {/* Benchmark Tiers */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {t.economyGuide.tiersTitle}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                {t.economyGuide.yourBaseline}: {currentEf ? Number(currentEf).toFixed(2) : '—'} EF
              </span>
            </div>
            <p style={{ margin: '0 0 0.65rem 0', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              {t.economyGuide.normalizedDesc}
            </p>

            <div className="economy-tiers-list">
              {tiers.map(tier => (
                <div
                  key={tier.range}
                  className={`economy-tier-card ${tier.isCurrent ? 'tier-current' : ''} ${tier.isTarget ? 'tier-target' : ''}`}
                >
                  <div className="tier-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="tier-range-badge" style={{ borderColor: tier.badgeColor, color: tier.badgeColor }}>
                        {tier.range} EF
                      </span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {tier.label}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {tier.isCurrent && (
                        <span className="tier-tag current">
                          <CheckCircle size={11} style={{ marginRight: 3 }} /> {t.economyGuide.yourCurrentLevel}
                        </span>
                      )}
                      {tier.isTarget && (
                        <span className="tier-tag target">
                          <Target size={11} style={{ marginRight: 3 }} /> {t.economyGuide.nextTarget}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="tier-pace">
                    <b>{t.economyGuide.typicalOutput}:</b> {tier.paceExample}
                  </div>
                  <div className="tier-desc">
                    {tier.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="economy-gains-banner">
            {t.economyGuide.comparisonNote}
          </p>

          {/* Practical Action Tips */}
          <div style={{ marginTop: '1.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {t.economyGuide.tipsTitle}
            </span>
            <ul className="economy-tips-list">
              <li>
                <b>{t.economyGuide.tipLt1Title} ({effectiveLt1} bpm):</b> {t.economyGuide.tipLt1Desc}
              </li>
              <li>
                <b>{t.economyGuide.tipStridesTitle}:</b> {t.economyGuide.tipStridesDesc}
              </li>
              <li>
                <b>{t.economyGuide.tipLt2Title} ({effectiveLt2} bpm):</b> {t.economyGuide.tipLt2Desc}
              </li>
              <li>
                <b>{t.economyGuide.tipWeatherTitle}:</b> {t.economyGuide.tipWeatherDesc}
              </li>
            </ul>
          </div>
        </div>

        <div className="modal-actions">
          <button className="primary-btn" onClick={onClose}>
            {t.economyGuide.gotIt}
          </button>
        </div>
      </div>
    </div>
  );
};
