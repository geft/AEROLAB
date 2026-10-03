/**
 * AEROLAB coach-debrief insight vocabulary.
 *
 * An insight is a sentence *plus* how the athlete should read it. The tone is
 * decided by the same branch that produced the sentence (a drift above target,
 * a cadence in the sweet spot, a piece of pure context), and travels with it
 * through storage into the UI, so the client never has to guess a verdict from
 * English text and the two can not drift apart.
 */
import type { CoachMessage } from '../../shared/coaching.js';
export type CoachInsightTone = 'positive' | 'neutral' | 'caution' | 'negative';

/** One graded, readable line of the coach debrief. */
export interface CoachInsight {
  /** The sentence shown to the athlete (English is the source of truth). */
  text: string;
  message: CoachMessage;
  tone: CoachInsightTone;
}

/**
 * Collects insight lines and derives the two parallel arrays the API stores.
 *
 * Every line must be added as a `(tone, text)` pair, and `texts`/`tones` are
 * projected from that single list, so an insight can never end up with another
 * insight's verdict.
 */
export function createInsightLog() {
  const items: CoachInsight[] = [];
  return {
    add(tone: CoachInsightTone, message: CoachMessage): void {
      items.push({ tone, text: message.text, message });
    },
    addAll(insights: CoachInsight[]): void {
      items.push(...insights);
    },
    get texts(): string[] {
      return items.map(i => i.text);
    },
    get tones(): CoachInsightTone[] {
      return items.map(i => i.tone);
    },
    get messages(): CoachMessage[] { return items.map(item => item.message); },
    /** The collected `{ text, tone }` pairs, in the order they were added. */
    get items(): CoachInsight[] {
      return items;
    },
    get size(): number {
      return items.length;
    }
  };
}
