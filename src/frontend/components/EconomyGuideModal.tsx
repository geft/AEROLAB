import React from 'react';
import { X, BookOpen, Target, TrendingUp, CheckCircle } from 'lucide-react';

interface EconomyGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEf?: number | null;
}

export const EconomyGuideModal: React.FC<EconomyGuideModalProps> = ({
  isOpen,
  onClose,
  currentEf = 1.15
}) => {
  if (!isOpen) return null;

  const tiers = [
    {
      range: '0.90 – 1.05',
      label: 'Developing Base',
      paceExample: '6:45 – 7:30 /km @ 140–150 bpm',
      desc: 'Early aerobic adaptation. Higher cardiovascular cost per meter traveled.',
      badgeColor: '#64748b',
      isCurrent: false,
      isTarget: false
    },
    {
      range: '1.10 – 1.25',
      label: 'Solid Trained Runner',
      paceExample: '5:45 – 6:15 /km @ 140–148 bpm',
      desc: 'Healthy stroke volume, good aerobic foundation, resilient cardiovascular drift.',
      badgeColor: '#06b6d4',
      isCurrent: true,
      isTarget: false
    },
    {
      range: '1.25 – 1.40',
      label: 'Advanced Distance Runner',
      paceExample: '4:50 – 5:25 /km @ 140–148 bpm',
      desc: 'High mitochondrial density and strong fatigue resistance on 90+ min runs.',
      badgeColor: '#10b981',
      isCurrent: false,
      isTarget: true
    },
    {
      range: '1.45 – 1.65',
      label: 'Competitive Club Racer',
      paceExample: '4:00 – 4:30 /km @ 145–155 bpm',
      desc: 'Highly optimized running economy; typical of sub-18 5K / sub-3:00 marathoners.',
      badgeColor: '#f59e0b',
      isCurrent: false,
      isTarget: false
    },
    {
      range: '1.70 – 2.00+',
      label: 'Elite Marathoner',
      paceExample: '3:10 – 3:30 /km @ 150–160 bpm',
      desc: 'World-class aerobic efficiency, exceptional tendon elasticity, and oxygen extraction.',
      badgeColor: '#8b5cf6',
      isCurrent: false,
      isTarget: false
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
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Running Economy Reference Guide</h2>
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
              <span className="formula-part">Speed (m/min)</span>
              <span className="formula-div">÷</span>
              <span className="formula-part">Heart Rate (bpm)</span>
              <span className="formula-div">=</span>
              <span className="formula-res">Meters Per Heartbeat</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.75rem 0 0', lineHeight: 1.5 }}>
              Your <b>Efficiency Factor (EF)</b> measures how far forward your body moves with every single heartbeat. 
              As your heart strengthens and muscle capillaries expand, your heart pumps more blood per stroke, letting you run faster at the exact same heart rate.
            </p>
          </div>

          {/* Benchmark Tiers */}
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Target Benchmark Tiers (Steady Zone 2 Running)
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                Your Baseline: {currentEf ? Number(currentEf).toFixed(2) : '1.15'} EF
              </span>
            </div>

            <div className="economy-tiers-list">
              {tiers.map(t => (
                <div
                  key={t.range}
                  className={`economy-tier-card ${t.isCurrent ? 'tier-current' : ''} ${t.isTarget ? 'tier-target' : ''}`}
                >
                  <div className="tier-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="tier-range-badge" style={{ borderColor: t.badgeColor, color: t.badgeColor }}>
                        {t.range} EF
                      </span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {t.label}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {t.isCurrent && (
                        <span className="tier-tag current">
                          <CheckCircle size={11} style={{ marginRight: 3 }} /> Your Current Level
                        </span>
                      )}
                      {t.isTarget && (
                        <span className="tier-tag target">
                          <Target size={11} style={{ marginRight: 3 }} /> Next Target
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="tier-pace">
                    <b>Typical Output:</b> {t.paceExample}
                  </div>
                  <div className="tier-desc">
                    {t.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Your 2026 Fitness Gains Highlight */}
          <div className="economy-gains-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <TrendingUp size={16} color="#10b981" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981' }}>
                Your Documented Fitness Gains in 2026
              </span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              In <b>January 2026</b>, your long run recorded <b>1.06 EF</b> (~6:32/km @ 151 bpm). By <b>September 2026</b>, 
              your steady base runs have reached <b>1.16–1.19 EF</b> (~5:50/km @ 136–148 bpm). 
              That represents a <b>+9.4% to +12.2% gain in aerobic running economy</b>!
            </p>
          </div>

          {/* Practical Action Tips */}
          <div style={{ marginTop: '1.25rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              How to Boost Your Running Economy
            </span>
            <ul className="economy-tips-list">
              <li>
                <b>Stay Under the LT1 Ceiling (148 bpm):</b> High volume of steady Zone 2 stimulates capillary growth without autonomic nervous system stress.
              </li>
              <li>
                <b>Weekly Strides for Elastic Recoil:</b> 4–6 short strides (15–20s fast, full recovery) teach your achilles and calves to return free elastic energy.
              </li>
              <li>
                <b>Lactate Clearance at LT2 (167 bpm):</b> Sustained threshold intervals (8–12 min reps) train muscles to shuttle and re-use lactate as fuel.
              </li>
              <li>
                <b>Apples-to-Apples Comparisons:</b> Compare runs under similar temperature and humidity, as extreme heat causes cardiac drift (elevating HR and lowering EF).
              </li>
            </ul>
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
