import type { AerobicAssessment } from '../../shared/aerobic-assessment.js';
import { useTranslation } from '../i18n/LanguageContext.js';
import { formatPace } from '../utils/formatters.js';

export function Lt1Reassessment({ assessment }: { assessment: AerobicAssessment }) {
  const { t, format, plural, formatDate } = useTranslation();
  const date = (value: string) => format(t.progress.lt1AssessmentDate, {
    date: formatDate(value, { month: 'short', day: 'numeric' }),
    year: formatDate(value, { year: 'numeric' })
  });
  const metric = (hr: number, pace: number) => format(t.progress.lt1AssessmentMetric, {
    hr: Math.round(hr), pace: formatPace(pace, false)
  });
  const { reference, candidate } = assessment;
  return (
    <section className="aerobic-evidence-panel">
      <h3>{t.progress.lt1AssessmentTitle}</h3>
      <div className="aerobic-evidence-summary">
        <span>{format(t.progress.lt1AssessmentSummary, {
          assessed: assessment.assessedRunCount, usable: assessment.usableRunCount
        })}</span>
        <span>{format(t.progress.lt1AssessmentLatest, {
          date: assessment.latestEvidenceDate ? date(assessment.latestEvidenceDate) : t.stats.notCalibrated
        })}</span>
      </div>
      <div className="aerobic-evidence-cards">
        <article className="aerobic-evidence-card">
          <h4>{t.progress.lt1AssessmentReferenceTitle}</h4>
          {reference ? <>
            <strong>{metric(reference.hr, reference.paceSecKm)}</strong>
            <p>{format(t.progress.lt1AssessmentReference, {
              date: date(reference.date), support: plural(reference.supportCount, t.stats.thresholdSupportCount),
              freshness: reference.stale ? t.progress.lt1AssessmentOlder : t.progress.lt1AssessmentRecent
            })}</p>
            {reference.basis === 'run_walk' && <p className="aerobic-evidence-caveat">{t.stats.runWalkEvidence}</p>}
          </> : <p>{t.progress.lt1AssessmentNoReference}</p>}
        </article>
        {candidate && <article className="aerobic-evidence-card">
          <h4>{t.progress.lt1AssessmentCandidateTitle}</h4>
          <strong>{metric(candidate.hr, candidate.paceSecKm)}</strong>
          <p>{format(t.progress.lt1AssessmentCandidate, {
            minutes: Math.round(candidate.runningSeconds / 60), drift: candidate.decouplingPct.toFixed(1), date: date(candidate.date)
          })}</p>
          {candidate.basis === 'run_walk' && <p className="aerobic-evidence-caveat">{t.stats.runWalkEvidence}</p>}
        </article>}
      </div>
      <details className="aerobic-evidence-note">
        <summary>{t.progress.lt1AssessmentMethod}</summary>
        <p>{t.progress.lt1AssessmentNote}</p>
      </details>
    </section>
  );
}
