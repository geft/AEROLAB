import React from 'react';
import { X, BookOpen, Target, TrendingUp, CheckCircle } from 'lucide-react';
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
  currentEf = 1.15,
  lt1Hr,
  lt2Hr
}) => {
  const { t, language } = useTranslation();
  if (!isOpen) return null;

  const effectiveLt1 = lt1Hr ?? 150;
  const effectiveLt2 = lt2Hr ?? 165;
  const activeEf = currentEf ?? 1.15;

  const tiers = [
    {
      range: '0.90 – 1.05',
      label: t.economyGuide.developingBase,
      paceExample: language === 'zh' ? '6:50 – 7:55 /公里 @ ~140 bpm' : '6:50 – 7:55 /km @ ~140 bpm',
      desc: t.economyGuide.developingBaseDesc,
      badgeColor: '#64748b',
      isCurrent: activeEf >= 0.90 && activeEf < 1.10,
      isTarget: false
    },
    {
      range: '1.10 – 1.25',
      label: t.economyGuide.solidRunner,
      paceExample: language === 'zh' ? '5:45 – 6:30 /公里 @ ~140 bpm' : '5:45 – 6:30 /km @ ~140 bpm',
      desc: t.economyGuide.solidRunnerDesc,
      badgeColor: '#06b6d4',
      isCurrent: activeEf >= 1.10 && activeEf < 1.25,
      isTarget: false
    },
    {
      range: '1.25 – 1.40',
      label: t.economyGuide.advancedRunner,
      paceExample: language === 'zh' ? '5:05 – 5:45 /公里 @ ~140 bpm' : '5:05 – 5:45 /km @ ~140 bpm',
      desc: t.economyGuide.advancedRunnerDesc,
      badgeColor: '#10b981',
      isCurrent: activeEf >= 1.25 && activeEf < 1.45,
      isTarget: activeEf < 1.25
    },
    {
      range: '1.45 – 1.65',
      label: t.economyGuide.competitiveRacer,
      paceExample: language === 'zh' ? '4:20 – 4:55 /公里 @ ~140 bpm' : '4:20 – 4:55 /km @ ~140 bpm',
      desc: t.economyGuide.competitiveRacerDesc,
      badgeColor: '#f59e0b',
      isCurrent: activeEf >= 1.45 && activeEf < 1.70,
      isTarget: activeEf >= 1.25 && activeEf < 1.45
    },
    {
      range: '1.70 – 2.00+',
      label: t.economyGuide.eliteMarathoner,
      paceExample: language === 'zh' ? '3:35 – 4:10 /公里 @ ~140 bpm' : '3:35 – 4:10 /km @ ~140 bpm',
      desc: t.economyGuide.eliteMarathonerDesc,
      badgeColor: '#8b5cf6',
      isCurrent: activeEf >= 1.70,
      isTarget: activeEf >= 1.45 && activeEf < 1.70
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
                {t.economyGuide.yourBaseline}: {currentEf ? Number(currentEf).toFixed(2) : '1.15'} EF
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

          {/* Fitness Gains Highlight */}
          <div className="economy-gains-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <TrendingUp size={16} color="#10b981" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981' }}>
                {t.economyGuide.gainsTitle}
              </span>
            </div>
            {language === 'zh' ? (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                在 <b>2026年1月</b>，您的长距离跑记录为 <b>1.06 EF</b>（~6:32/公里 @ 151 bpm）。到了 <b>2026年9月</b>，
                您的平稳有氧基础跑已提升至 <b>1.16–1.19 EF</b>（~5:50/公里 @ 136–148 bpm）。
                这代表着 <b>+9.4% 至 +12.2% 的有氧跑步经济性跃升</b>！
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                In <b>January 2026</b>, your long run recorded <b>1.06 EF</b> (~6:32/km @ 151 bpm). By <b>September 2026</b>, 
                your steady base runs have reached <b>1.16–1.19 EF</b> (~5:50/km @ 136–148 bpm). 
                That represents a <b>+9.4% to +12.2% gain in aerobic running economy</b>!
              </p>
            )}
          </div>

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

        <div className="modal-actions" style={{ justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button className="primary-btn" onClick={onClose}>
            {t.economyGuide.gotIt}
          </button>
        </div>
      </div>
    </div>
  );
};
