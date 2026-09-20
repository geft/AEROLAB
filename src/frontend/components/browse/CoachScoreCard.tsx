import React, { useState } from 'react';
import type { Translations } from '../../i18n/types.js';
import type { CoachInsightTone } from '../../types/api.js';
import { ShieldCheck, ChevronDown } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.js';
import {
  translateCoachHeadline,
  translateCoachInsight,
  translateCoachRecommendation,
  translateCoachFocusAdvice,
  translateScoreCategory,
  translateScoreLabel,
  translateScoreDescription
} from '../../i18n/coachTranslator';

export function scoreToStars(score: number | null | undefined): number {
  if (score == null) return 0;
  if (score <= 3) return Math.min(3, Math.max(1, Math.round(score)));
  if (score >= 85) return 3;
  if (score >= 70) return 2;
  return 1;
}

/** Signed display for a delta that is already a number from the API payload. */
const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

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
      maxPoints?: number;
      isFocus?: boolean;
    }>;
    keyInsights?: string[];
    /** One tone per `keyInsights` entry, index-for-index. */
    insightTones?: CoachInsightTone[];
    recommendation?: string;
    focusAdvice?: string | null;
    rubricCoveragePct?: number | null;
    rubricFamily?: string | null;
    context?: {
      windowDays: number;
      comparableRuns: number;
      baselineEf: number | null;
      efDeltaPct: number | null;
      baselineHrAtPace: number | null;
      hrAtPaceDeltaBpm: number | null;
      hrAtPaceSamples: number;
      decouplingRank: number | null;
      decouplingSamples: number;
      longestDistanceKm: number | null;
      isLongestRun: boolean;
      acwr: number | null;
    } | null;
  };
  language: 'en' | 'zh';
  t: Translations;
}

export const CoachScoreCard: React.FC<CoachScoreCardProps> = ({
  coachSummary,
  language,
  t
}) => {
  const [showScoreBreakdown, setShowScoreBreakdown] = useState<boolean>(false);
  const { format } = useTranslation();

  const rawStars = coachSummary.stars ?? scoreToStars(coachSummary.effectivenessScore ?? coachSummary.rating5);
  const coachStars = Math.max(1, Math.min(3, rawStars > 3 ? (rawStars >= 4 ? 3 : 2) : (rawStars || 1)));
  const effScore = coachSummary.effectivenessScore;
  const tierLabel = coachStars === 3 ? 'gold' : coachStars === 2 ? 'silver' : 'bronze';
  const context = coachSummary.context;
  const coverage = coachSummary.rubricCoveragePct;

  // Tone verdicts travel beside the sentences. A length mismatch means the row
  // was written before tones existed, so the list stays plain rather than
  // labelling an insight with a neighbour's verdict.
  const insights = coachSummary.keyInsights || [];
  const tones = coachSummary.insightTones?.length === insights.length
    ? coachSummary.insightTones
    : [];

  const toneLabel = (tone: CoachInsightTone): string =>
    tone === 'positive' ? t.browse.coachToneGood
      : tone === 'caution' ? t.browse.coachToneWatch
        : tone === 'negative' ? t.browse.coachToneFix
          : t.browse.coachToneInfo;

  // Severity first, so anything needing action reads before the praise.
  const toneCounts = (['negative', 'caution', 'positive', 'neutral'] as CoachInsightTone[])
    .map(tone => ({ tone, count: tones.filter(entry => entry === tone).length }))
    .filter(entry => entry.count > 0);

  const baselineChips: string[] = [];
  if (context && context.comparableRuns >= 2) {
    if (context.acwr != null) baselineChips.push(format(t.browse.coachContextAcwr, { acwr: context.acwr }));
    if (context.efDeltaPct != null && Math.abs(context.efDeltaPct) >= 2) {
      baselineChips.push(format(t.browse.coachContextEconomy, { delta: signed(context.efDeltaPct) }));
    }
    if (context.hrAtPaceDeltaBpm != null && Math.abs(context.hrAtPaceDeltaBpm) >= 2) {
      baselineChips.push(format(t.browse.coachContextHrAtPace, {
        delta: signed(context.hrAtPaceDeltaBpm),
        samples: context.hrAtPaceSamples
      }));
    }
    if (context.decouplingRank != null) {
      baselineChips.push(format(t.browse.coachContextDecoupling, {
        rank: context.decouplingRank,
        total: context.decouplingSamples
      }));
    }
    if (context.isLongestRun && context.longestDistanceKm != null) {
      baselineChips.push(format(t.browse.coachContextLongest, { days: context.windowDays }));
    }
  }

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

          {coverage != null && coverage < 100 && (
            <p className="score-coverage-note">{format(t.browse.coachScoreCoverage, { pct: coverage })}</p>
          )}

          <div className="score-breakdown-factors">
            {(coachSummary.scoreBreakdown || []).map((factor, fIdx) => {
              const isPos = factor.points > 0;
              const isNeg = factor.points < 0;
              const weight = factor.maxPoints ?? null;
              const share = weight ? Math.round((factor.points / weight) * 100) : null;
              return (
                <div key={fIdx} className={`score-factor-row${factor.isFocus ? ' score-factor-focus' : ''}`}>
                  <div className="score-factor-main">
                    <span className="score-factor-cat">
                      {translateScoreCategory(factor.category, language)}
                      {factor.isFocus ? <span className="score-factor-focus-tag">{t.browse.coachFocusTag}</span> : null}
                    </span>
                    <span className="score-factor-label">{translateScoreLabel(factor.label, language)}</span>
                    {factor.description && (
                      <span className="score-factor-desc">{translateScoreDescription(factor.description, language)}</span>
                    )}
                    {share != null && (
                      <span className="score-factor-bar" aria-hidden="true">
                        <span className="score-factor-bar-fill" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
                      </span>
                    )}
                  </div>
                  <span className={`score-factor-points ${isPos ? 'points-positive' : (isNeg ? 'points-negative' : 'points-neutral')}`}>
                    {isPos ? `+${factor.points}` : factor.points}
                    {weight != null ? <span className="score-factor-max"> / {weight}</span> : null}
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

      {/* Tone legend: how many read-outs are strengths, watch-outs or context */}
      {insights.length > 0 && toneCounts.length > 1 && (
        <div className="coach-insight-mix">
          <span className="coach-insight-mix-title">{t.browse.coachInsightMix}</span>
          {toneCounts.map(({ tone, count }) => (
            <span key={tone} className={`coach-tone-pill tone-${tone}`}>
              <span className="coach-tone-dot" aria-hidden="true" />
              {toneLabel(tone)}
              <b>{count}</b>
            </span>
          ))}
        </div>
      )}

      <ul className="coach-insights-list">
        {insights.map((insight, idx) => {
          const tone = tones[idx];
          return (
            <li key={idx} className={`coach-insight-item tone-${tone ?? 'neutral'}`}>
              <span className="coach-insight-bullet" aria-hidden="true">◆</span>
              <span className="coach-insight-text">
                {tone && <span className={`coach-insight-tag tone-${tone}`}>{toneLabel(tone)}</span>}
                {translateCoachInsight(insight, language)}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Personal baseline: how this session compares with the athlete's own history */}
      {baselineChips.length > 0 && (
        <div className="coach-baseline">
          <span className="coach-baseline-title">{t.browse.coachBaselineTitle}</span>
          <div className="coach-baseline-chips">
            {baselineChips.map((chip, idx) => (
              <span key={idx} className="coach-baseline-chip">{chip}</span>
            ))}
          </div>
        </div>
      )}

      {/* Biggest lever: the factor that cost the most points, with the fix */}
      {coachSummary.focusAdvice && (
        <div className="coach-focus-lever">
          <span className="coach-focus-tag">{t.browse.coachFocusLever}</span>
          <p className="coach-focus-text">{translateCoachFocusAdvice(coachSummary.focusAdvice, language)}</p>
        </div>
      )}

      <div className="coach-recommendation">
        <strong style={{ color: '#06b6d4' }}>{t.browse.nextStep}: </strong>
        {translateCoachRecommendation(coachSummary.recommendation || '', language)}
      </div>
    </section>
  );
};
