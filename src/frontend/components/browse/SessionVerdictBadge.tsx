import React from 'react';
import { parseSessionVerdict, type SessionVerdict } from '../../../shared/session-verdict.js';
import { useTranslation } from '../../i18n/LanguageContext.js';

const symbols: Record<SessionVerdict, string> = {
  on_track: '✓', some_deviation: '−', off_target: '!', insufficient_evidence: '?'
};

export function SessionVerdictBadge({ verdict }: { verdict?: SessionVerdict }) {
  const { t } = useTranslation();
  const status = parseSessionVerdict(verdict);
  const labels = {
    on_track: t.browse.verdictOnTrack,
    some_deviation: t.browse.verdictSomeDeviation,
    off_target: t.browse.verdictOffTarget,
    insufficient_evidence: t.browse.verdictInsufficientEvidence
  };
  return (
    <span className={`session-verdict verdict-${status}`} title={labels[status]}>
      <span className="session-verdict-symbol" aria-hidden="true">{symbols[status]}</span>
      <span className="session-verdict-label">{labels[status]}</span>
    </span>
  );
}
