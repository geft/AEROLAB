import React, { useState } from 'react';
import { ShieldCheck, ChevronDown } from 'lucide-react';
import {
  translateCoachHeadline,
  translateCoachInsight,
  translateCoachRecommendation,
  translateScoreCategory,
  translateScoreLabel
} from '../../i18n/coachTranslator';

export function scoreToStars(score: number | null | undefined): number {
  if (score == null) return 0;
  if (score <= 3) return Math.min(3, Math.max(1, Math.round(score)));
  if (score >= 85) return 3;
  if (score >= 70) return 2;
  return 1;
}

interface CoachScoreCardProps {
  coachSummary: {
    headline?: string;
    stars?: number;
    effectivenessScore?: number;
    rating5?: number;
    scoreBreakdown?: Array<{
      category: string;
      label: string;
      description?: string;
      points: number;
    }>;
    keyInsights?: string[];
    recommendation?: string;
  };
  language: 'en' | 'zh';
  t: any;
}

export const CoachScoreCard: React.FC<CoachScoreCardProps> = ({
  coachSummary,
  language,
  t
}) => {
  const [showScoreBreakdown, setShowScoreBreakdown] = useState<boolean>(false);

  const rawStars = coachSummary.stars ?? scoreToStars(coachSummary.effectivenessScore ?? coachSummary.rating5);
  const coachStars = Math.max(1, Math.min(3, rawStars > 3 ? (rawStars >= 4 ? 3 : 2) : (rawStars || 1)));
  const effScore = coachSummary.effectivenessScore;
  const tierLabel = coachStars === 3 ? 'gold' : coachStars === 2 ? 'silver' : 'bronze';

  return (
    <section className="coach-summary-card">
      <div className="coach-header">
        <div className="coach-title-group">
          <span className="coach-tag">{t.browse.coachTag || 'Coach AI'}</span>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {translateCoachHeadline(coachSummary.headline || '', language)}
          </h3>
        </div>
        <button
          type="button"
          className="coach-score-badge"
          onClick={() => setShowScoreBreakdown(prev => !prev)}
          title="Click to toggle full execution score breakdown & grading rubric"
          style={{ cursor: 'pointer', font: 'inherit', color: 'inherit' }}
        >
          <ShieldCheck size={16} />
          <span className={`execution-emblem emblem-${tierLabel}`} style={{ fontSize: '0.85rem', padding: '0.2rem 0.55rem' }}>
            {'★'.repeat(coachStars)}{'☆'.repeat(Math.max(0, 3 - coachStars))}
            {effScore ? <span style={{ opacity: 0.75, marginLeft: '0.4rem', fontWeight: 600, fontSize: '0.78rem' }}>{effScore}/100</span> : null}
          </span>
          <ChevronDown
            size={14}
            style={{
              marginLeft: '4px',
              transform: showScoreBreakdown ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s ease',
              opacity: 0.6
            }}
          />
        </button>
      </div>

      {/* Transparent Execution Score Breakdown & Rubric */}
      {showScoreBreakdown && (
        <div className="score-breakdown-card">
          <div className="score-breakdown-header">
            <span className="score-breakdown-title">{t.browse.scoreBreakdownTitle}</span>
            <span className="score-breakdown-total">
              {t.browse.scoreFinalExecution}: <b>{effScore ?? '—'} / 100</b>
              {' · '}
              {coachStars === 3 ? t.browse.medalGold : coachStars === 2 ? t.browse.medalSilver : t.browse.medalBronze}
            </span>
          </div>

          <div className="score-breakdown-factors">
            {(coachSummary.scoreBreakdown || []).map((factor, fIdx) => {
              const isPos = factor.points > 0;
              const isNeg = factor.points < 0;
              return (
                <div key={fIdx} className="score-factor-row">
                  <div className="score-factor-main">
                    <span className="score-factor-cat">{translateScoreCategory(factor.category, language)}</span>
                    <span className="score-factor-label">{translateScoreLabel(factor.label, language)}</span>
                    {factor.description && (
                      <span className="score-factor-desc">{factor.description}</span>
                    )}
                  </div>
                  <span className={`score-factor-points ${isPos ? 'points-positive' : (isNeg ? 'points-negative' : 'points-neutral')}`}>
                    {isPos ? `+${factor.points}` : factor.points}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Physiological Grading Rubric (3-tier) */}
          <div className="score-rubric-legend">
            <span className="rubric-legend-title">{t.browse.scoreGradingTiers}</span>
            <div className="rubric-tiers">
              <span className={coachStars === 3 ? 'rubric-active' : ''}>
                <b>{t.browse.scoreGoldTier}:</b> {t.browse.scoreGoldDesc}
              </span>
              <span className={coachStars === 2 ? 'rubric-active' : ''}>
                <b>{t.browse.scoreSilverTier}:</b> {t.browse.scoreSilverDesc}
              </span>
              <span className={coachStars === 1 ? 'rubric-active' : ''}>
                <b>{t.browse.scoreBronzeTier}:</b> {t.browse.scoreBronzeDesc}
              </span>
            </div>
          </div>
        </div>
      )}

      <ul className="coach-insights-list">
        {(coachSummary.keyInsights || []).map((insight, idx) => (
          <li key={idx} className="coach-insight-item">
            <span className="coach-insight-bullet">◆</span>
            <span>{translateCoachInsight(insight, language)}</span>
          </li>
        ))}
      </ul>

      <div className="coach-recommendation">
        <strong style={{ color: '#06b6d4' }}>{t.browse.nextStep}: </strong>
        {translateCoachRecommendation(coachSummary.recommendation || '', language)}
      </div>
    </section>
  );
};
