/** A session has one classification and may additionally contain strides. */
export const RUN_TYPE_LABELS: Record<string, string> = {
  easy_base: 'Easy Base', long_run: 'Long Run', recovery: 'Recovery',
  threshold_lt2: 'Threshold', intervals_vo2: 'VO2 Max', tempo: 'Tempo', race: 'Race'
};

export function sessionTags(runType: string | null | undefined, tags: readonly string[]): string[] {
  const label = RUN_TYPE_LABELS[runType || ''];
  return [...(label ? [label] : []), ...(tags.some(tag => tag.toLowerCase() === 'strides') ? ['Strides'] : [])];
}
