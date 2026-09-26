// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { CoachScoreCard } from '../../src/frontend/components/browse/CoachScoreCard.js';
import { en } from '../../src/frontend/i18n/en.js';

const summary = {
  headline: 'Productive Zone 2 Aerobic Foundation',
  effectivenessScore: 74,
  stars: 2,
  verdict: 'some_deviation' as const,
  rubricCoveragePct: 76,
  rubricFamily: 'aerobic',
  focusAdvice: 'Biggest Lever — Aerobic Decoupling: 5.4% cardiac drift was the largest single cost (12 of 30 points lost). Start the opening 2 km 10-15 sec/km slower and add easy volume at or below 138 bpm — capillary density, not speed, is the limiter.',
  scoreBreakdown: [
    {
      category: 'Aerobic Decoupling',
      label: 'Solid Sub-LT1 Aerobic Base',
      description: '5.4% cardiac drift (1.5% or lower earns full marks)',
      points: 18,
      maxPoints: 30,
      isFocus: true
    },
    {
      category: 'Pacing Discipline',
      label: 'Textbook Aerobic Discipline',
      description: '138 bpm steady HR against a 148 bpm LT1 cap',
      points: 24,
      maxPoints: 26
    }
  ],
  keyInsights: ['Solid aerobic discipline. Decoupling was 5.4%, well within the sub-LT1 gold standard threshold (<5%).'],
  recommendation: 'Maintain easy efforts at this heart rate cap to reinforce mitochondrial density.',
  context: {
    windowDays: 90,
    comparableRuns: 9,
    baselineEf: 1.24,
    efDeltaPct: 6.5,
    baselineHrAtPace: 141,
    hrAtPaceDeltaBpm: -8,
    hrAtPaceSamples: 6,
    decouplingRank: 3,
    decouplingSamples: 10,
    longestDistanceKm: 21,
    isLongestRun: true,
    acwr: 1.4
  }
};

describe('CoachScoreCard weighted rubric UI', () => {
  afterEach(() => cleanup());

  it('shows a verdict and observations without scores, stars or point weights', () => {
    render(<CoachScoreCard coachSummary={summary} language="en" t={en} />);

    // Badge keeps the numeric score
    expect(screen.queryByText('74/100')).toBeNull();
    expect(screen.getByText('Some deviation')).toBeTruthy();

    // Open the transparent breakdown
    fireEvent.click(screen.getByRole('button', { name: /Some deviation/ }));

    // Weighted rubric rows expose the weight behind each factor
    expect(screen.queryByText('+18')).toBeNull();
    expect(Array.from(document.querySelectorAll('.score-factor-max')).map(el => el.textContent)).toEqual([]);
    expect(screen.getByText('Session observations')).toBeTruthy();
    expect(screen.queryByText(/graded on 76% of the rubric/i)).toBeNull();

    // Biggest lever + personal baseline blocks
    expect(screen.queryByText('Biggest Lever')).toBeNull();
    expect(screen.queryByText(/points lost/i)).toBeNull();
    expect(screen.getByText('Your Baseline')).toBeTruthy();
    expect(screen.getByText('Load 1.4x 28-day average')).toBeTruthy();
    expect(screen.getByText('Economy +6.5% vs 28-day median')).toBeTruthy();
    expect(screen.getByText('HR at pace -8 bpm vs 6 runs')).toBeTruthy();
    expect(screen.getByText('Drift rank 3 of 10')).toBeTruthy();
    expect(screen.getByText('Longest run in 90 days')).toBeTruthy();
  });

  it('hides the new blocks for older persisted summaries without the analysis payload', () => {
    render(
      <CoachScoreCard
        coachSummary={{
          headline: 'Near-Perfect Aerobic Base Execution',
          effectivenessScore: 95,
          keyInsights: ['Superb aerobic base'],
          recommendation: 'Absorbing volume smoothly.',
          scoreBreakdown: [{ category: 'Base Execution', label: 'Standard Quality Baseline', points: 85 }]
        }}
        language="en"
        t={en}
      />
    );

    expect(screen.queryByText('95/100')).toBeNull();
    expect(screen.getByText('Insufficient evidence')).toBeTruthy();
    expect(screen.queryByText('Biggest Lever')).toBeNull();
    expect(screen.queryByText('Your Baseline')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Insufficient evidence/ }));
    // Legacy rows have no weight, so no "/ max" is rendered
    expect(document.querySelectorAll('.score-factor-max')).toHaveLength(0);
  });

  it('colour-codes each read-out and summarises the mix by tone', () => {
    render(
      <CoachScoreCard
        coachSummary={{
          headline: 'Productive Zone 2 Aerobic Foundation',
          effectivenessScore: 76,
          keyInsights: [
            'Superb cardiovascular stability with only 2.8% drift.',
            'Zone 2 Ceiling Held, High-Zone-2 Creep: you never crossed the ceiling.',
            'Over-Intensity: 34.0% of your running time sat above the LT1 ceiling.',
            'Microclimate Weather: 30.4°C ambient.'
          ],
          insightTones: ['positive', 'caution', 'negative', 'neutral'],
          recommendation: 'Maintain easy efforts at this heart rate cap.'
        }}
        language="en"
        t={en}
      />
    );

    // One verdict badge per read-out, in the engine's order
    expect(Array.from(document.querySelectorAll('.coach-insight-tag')).map(el => el.textContent))
      .toEqual(['Good', 'Watch', 'Fix', 'Info']);

    // The row accent carries the same verdict as a class the stylesheet colours
    expect(Array.from(document.querySelectorAll('.coach-insight-item')).map(el => el.className))
      .toEqual([
        'coach-insight-item tone-positive',
        'coach-insight-item tone-caution',
        'coach-insight-item tone-negative',
        'coach-insight-item tone-neutral'
      ]);

    // Mix strip counts every tone, worst first
    expect(screen.getByRole('group', { name: 'Insight mix' })).toBeTruthy();
    expect(Array.from(document.querySelectorAll('.coach-tone-pill')).map(el => el.textContent))
      .toEqual(['All insights', 'Fix1', 'Watch1', 'Good1', 'Info1']);
    fireEvent.click(screen.getByRole('button', { name: 'Fix1' }));
    expect(document.querySelectorAll('.coach-insight-item')).toHaveLength(1);
    expect(document.querySelector('.coach-insight-item.tone-negative')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All insights' }));
    expect(document.querySelectorAll('.coach-insight-item')).toHaveLength(4);
  });

  it('leaves summaries written before tones existed uncoloured', () => {
    render(
      <CoachScoreCard
        coachSummary={{
          headline: 'Near-Perfect Aerobic Base Execution',
          effectivenessScore: 95,
          keyInsights: ['Superb aerobic base'],
          recommendation: 'Absorbing volume smoothly.'
        }}
        language="en"
        t={en}
      />
    );

    expect(document.querySelectorAll('.coach-insight-tag')).toHaveLength(0);
    expect(document.querySelectorAll('.coach-tone-pill')).toHaveLength(0);
    expect(document.querySelector('.coach-insight-item.tone-neutral')).toBeTruthy();
  });

  it('keeps elevated measured haze visible in the Watch filter', () => {
    render(
      <CoachScoreCard
        coachSummary={{
          headline: 'Productive Zone 2 Aerobic Foundation',
          effectivenessScore: 84,
          keyInsights: [
            "Air Quality Watch: NEA's nearest regional monitor measured 96 µg/m³ PM2.5 near the run midpoint (Elevated 1-hour band). Haze may have added breathing strain; the reading represents the wider region, not the exact route.",
            'Pace-Specific Cost: 6:19/km usually costs you 138 bpm across 29 comparable runs; today it cost 8 bpm more.'
          ],
          insightTones: ['caution', 'neutral'],
          recommendation: 'Keep the next run easy.'
        }}
        language="en"
        t={en}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Watch/ }));

    expect(document.querySelectorAll('.coach-insight-item.tone-caution')).toHaveLength(1);
    expect(document.querySelectorAll('.coach-insight-item.tone-neutral')).toHaveLength(0);
    expect(screen.getByText(/Haze may have added breathing strain/)).toBeTruthy();
  });

  it('ignores a tone list that does not line up with the insights', () => {
    render(
      <CoachScoreCard
        coachSummary={{
          headline: 'Near-Perfect Aerobic Base Execution',
          effectivenessScore: 95,
          keyInsights: ['Superb aerobic base', 'Tapered load this week.'],
          // Shorter than the insight list: mislabelling a line is worse than no colour
          insightTones: ['positive'],
          recommendation: 'Absorbing volume smoothly.'
        }}
        language="en"
        t={en}
      />
    );

    expect(document.querySelectorAll('.coach-insight-tag')).toHaveLength(0);
    expect(document.querySelectorAll('.coach-tone-pill')).toHaveLength(0);
  });
});
