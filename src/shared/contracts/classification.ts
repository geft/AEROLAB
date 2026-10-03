export const CLASSIFICATION_RULE_IDS = ['continuous_race', 'structured_threshold', 'structured_vo2',
  'aerobic_run_walk', 'continuous_threshold', 'long_duration', 'low_hrr_recovery', 'aerobic_default'] as const;
export type ClassificationRuleId = typeof CLASSIFICATION_RULE_IDS[number];

export interface ClassificationEvidence {
  ruleId: ClassificationRuleId;
  measurements: Record<string, number | null>;
  policy: Record<string, number>;
  /** Fixed rule strength is not a statistically calibrated probability. */
  confidence: { kind: 'heuristic'; score: number };
}

export function parseClassificationEvidence(value: unknown): ClassificationEvidence | undefined {
  const object = (entry: unknown): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry);
  const finite = (entry: unknown): entry is number => typeof entry === 'number' && Number.isFinite(entry);
  if (!object(value) || !(CLASSIFICATION_RULE_IDS as readonly unknown[]).includes(value.ruleId)
    || !object(value.measurements) || !Object.values(value.measurements).every(entry => entry === null || finite(entry))
    || !object(value.policy) || !Object.values(value.policy).every(finite)
    || !object(value.confidence) || value.confidence.kind !== 'heuristic' || !finite(value.confidence.score)) return undefined;
  return value as unknown as ClassificationEvidence;
}
