import type { CoachMessage, CoachMessageParam } from '../../shared/coaching.js';
import type { Translations } from './types.js';

/** Format typed clauses through the active dictionary; old English remains a fallback. */
export function formatCoachMessage(message: CoachMessage, t: Translations, format: (template: string, values: Record<string, string | number>) => string): string {
  const value = (param: CoachMessageParam): string | number => Array.isArray(param)
    ? param.map(value).join(String(value(message.params.separator ?? '')))
    : param !== null && typeof param === 'object' ? formatCoachMessage(param, t, format) : param ?? '—';
  const parameters = Object.fromEntries(Object.entries(message.params).map(([key, param]) => [key, value(param)]));
  return format(t.browse.coachMessageOverrides[message.id] ?? message.text, parameters);
}
