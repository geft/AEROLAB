import { SessionVerdictBadge } from './SessionVerdictBadge.js';
import type { SessionVerdict } from '../../../shared/session-verdict.js';
import React, { useState } from 'react';
import type { Translations } from '../../i18n/types.js';
import type { CoachContext, CoachInsightTone } from '../../types/api.js';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.js';
import { formatPace } from '../../utils/formatters.js';
import { selectNotableRunComparison } from '../../utils/coachComparison.js';
import {
  translateCoachHeadline,
  translateCoachInsight,
  translateCoachRecommendation,
  translateScoreCategory,
  translateScoreLabel,
  translateScoreDescription
} from '../../i18n/coachTranslator';


/** Signed display for a delta that is already a number from the API payload. */
const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

interface CoachScoreCardProps {
  coachSummary: {
    verdict?: SessionVerdict;
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
    context?: Pick<CoachContext,
      'windowDays' | 'comparableRuns' | 'baselineEf' | 'efDeltaPct' |
      'baselineHrAtPace' | 'hrAtPaceDeltaBpm' | 'hrAtPaceSamples' |
      'decouplingRank' | 'decouplingSamples' | 'longestDistanceKm' |
      'isLongestRun' | 'acwr'> & Partial<Pick<CoachContext,
      'lastSimilarRun' | 'currentHeartRate' | 'currentPaceSecKm' | 'currentAboveCeilingPct'>> | null;
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
  const [toneFilter, setToneFilter] = useState<CoachInsightTone | null>(null);
  const { format, formatDate } = useTranslation();

  const context = coachSummary.context;
  const comparison = selectNotableRunComparison(context);
  const comparisonDate = comparison ? formatDate(comparison.startTime, { day: 'numeric', month: 'short' }) : '';
  const comparisonInsight = comparison?.kind === 'intensity'
    ? format(t.browse.coachCompareIntensity, {
      date: comparisonDate,
      previous: comparison.previous.toFixed(1),
      current: comparison.current.toFixed(1)
    })
    : comparison?.kind === 'pace'
      ? format(comparison.direction === 'faster' ? t.browse.coachComparePaceFaster : t.browse.coachComparePaceSlower, {
        date: comparisonDate,
        delta: comparison.secondsPerKm,
        previous: comparison.previousHr,
        current: comparison.currentHr
      })
      : comparison?.kind === 'heartRate'
        ? format(comparison.direction === 'lower' ? t.browse.coachCompareHrLower : t.browse.coachCompareHrHigher, {
          date: comparisonDate,
          delta: comparison.bpm,
          previous: formatPace(comparison.previousPace),
          current: formatPace(comparison.currentPace)
        })
        : null;

  // Tone verdicts travel beside the sentences. A length mismatch means the row
  // was written before tones existed, so the list stays plain rather than
  // labelling an insight with a neighbour's verdict.
  const rawInsights = coachSummary.keyInsights || [];
  const rawTones = coachSummary.insightTones?.length === rawInsights.length ? coachSummary.insightTones : [];
  const visibleInsights: Array<{ text: string; tone?: CoachInsightTone; localized?: boolean }> = rawInsights.map((text, index) => ({ text, tone: rawTones[index] }))
    .filter(entry => !entry.text.startsWith('Rubric Coverage:'));
  if (comparisonInsight) visibleInsights.push({ text: comparisonInsight, tone: 'neutral', localized: true });
  const insights = visibleInsights.map(entry => entry.text);
  const tones = visibleInsights.map(entry => entry.tone);

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
            {t.browse.coachTextOverrides[coachSummary.headline || ''] ?? translateCoachHeadline(coachSummary.headline || '', language)}
          </h3>
        </div>
        <button
          type="button"
          className="coach-score-badge"
          onClick={() => setShowScoreBreakdown(prev => !prev)}
          title={t.browse.verdictDetails}
          aria-expanded={showScoreBreakdown}
          style={{ cursor: 'pointer', font: 'inherit', color: 'inherit' }}
        >
          <SessionVerdictBadge verdict={coachSummary.verdict} />
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

      {showScoreBreakdown && (
        <div className="score-breakdown-card">
          <div className="score-breakdown-header">
            <span className="score-breakdown-title">{t.browse.verdictDetails}</span>
          </div>
          <p className="score-coverage-note">{t.browse.verdictExplanation}</p>
          <div className="score-breakdown-factors">
            {(coachSummary.scoreBreakdown || []).map((factor, fIdx) => (
              <div key={fIdx} className="score-factor-row">
                <div className="score-factor-main">
                  <span className="score-factor-cat">{translateScoreCategory(factor.category, language)}</span>
                  <span className="score-factor-label">{translateScoreLabel(factor.label, language)}</span>
                  {factor.description && <span className="score-factor-desc">{translateScoreDescription(factor.description, language)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tone legend: how many read-outs are strengths, watch-outs or context */}
      {insights.length > 0 && toneCounts.length > 1 && (
        <div className="coach-insight-mix" role="group" aria-label={t.browse.coachInsightMix}>
          <button type="button" className="coach-tone-pill" aria-pressed={toneFilter === null} onClick={() => setToneFilter(null)}>{t.browse.coachAllInsights}</button>
          {toneCounts.map(({ tone, count }) => (
            <button type="button" key={tone} className={`coach-tone-pill tone-${tone}`} aria-pressed={toneFilter === tone} onClick={() => setToneFilter(current => current === tone ? null : tone)}>
              <span className="coach-tone-dot" aria-hidden="true" />
              {toneLabel(tone)}
              <b>{count}</b>
            </button>
          ))}
        </div>
      )}

      <ul className="coach-insights-list">
        {visibleInsights.map((entry, idx) => {
          const tone = entry.tone;
          if (toneFilter && toneCounts.length > 1 && tone !== toneFilter) return null;
          return (
            <li key={idx} className={`coach-insight-item tone-${tone ?? 'neutral'}`}>
              <span className="coach-insight-bullet" aria-hidden="true">◆</span>
              <span className="coach-insight-text">
                {tone && <span className={`coach-insight-tag tone-${tone}`}>{toneLabel(tone)}</span>}
                {entry.localized ? entry.text : (t.browse.coachTextOverrides[entry.text] ?? translateCoachInsight(entry.text, language))}
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

      <div className="coach-recommendation">
        <strong style={{ color: '#06b6d4' }}>{t.browse.nextStep}: </strong>
        {t.browse.coachTextOverrides[coachSummary.recommendation || ''] ?? translateCoachRecommendation(coachSummary.recommendation || '', language)}
      </div>
    </section>
  );
};
