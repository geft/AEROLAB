import { describe, it, expect } from 'vitest';
import {
  translateCalibrationNote,
  translateActivityName,
  translateCoachHeadline,
  translateCoachRecommendation,
  translateCoachFocusAdvice,
  translateCoachInsight,
  translateScoreCategory,
  translateScoreLabel,
  translateScoreDescription
} from '../../src/frontend/i18n/coachTranslator.js';

const legacyAerobicAdvice = 'Biggest Lever — Aerobic Decoupling: 4.0% cardiac drift was the largest single cost (12 of 30 points lost). Start the opening 2 km 10-15 sec/km slower and add easy volume at or below 141 bpm — capillary density, not speed, is the limiter.';
const hotAerobicAdvice = 'Biggest Lever — Aerobic Decoupling: 4.0% cardiac drift was the largest single cost (12 of 30 points lost). The target for these conditions is 4.44% (heat and duration both add drift you cannot pace away), so this is about pacing and fuelling rather than fitness. Start the opening 2 km 10-15 sec/km slower and add easy volume at or below 141 bpm — capillary density, not speed, is the limiter.';

const expectNoPlaceholders = (text: string) => {
  expect(text).not.toMatch(/\$\d/);
  expect(text).not.toContain('undefined');
};

describe('Coach translator — shared copy and fallbacks', () => {
  it('translates known headlines and preserves unknown or non-Chinese headlines', () => {
    expect(translateCoachHeadline('  Low-Stress Active Recovery Jog  ', 'zh')).toBe('低负荷主动恢复慢跑');
    expect(translateCoachHeadline('New headline', 'zh')).toBe('New headline');
    expect(translateCoachHeadline('Low-Stress Active Recovery Jog', 'en')).toBe('Low-Stress Active Recovery Jog');
    expect(translateCoachHeadline('', 'zh')).toBe('');
  });

  it('translates recommendation templates and leaves unmatched copy intact', () => {
    expect(translateCoachRecommendation(
      'If an Easy recovery was intended, slow your initial kilometer pace by 15-20 sec/km to keep heart rate firmly under your LT1 ceiling (145 bpm).',
      'zh'
    )).toContain('LT1上限（145 bpm）以下');
    expect(translateCoachRecommendation('Allow 48 hours of recovery or easy aerobic jogging before the next quality day.', 'zh'))
      .toContain('48小时的恢复');
    expect(translateCoachRecommendation('Unrecognized recommendation', 'zh')).toBe('Unrecognized recommendation');
    expect(translateCoachRecommendation('Maintain easy efforts at this heart rate cap', 'en'))
      .toBe('Maintain easy efforts at this heart rate cap');
    expect(translateCoachRecommendation('', 'zh')).toBe('');
  });

  it('preserves calibration notes and activity names across locales', () => {
    expect(translateCalibrationNote('Based on 8 runs', 'zh')).toBe('Based on 8 runs');
    expect(translateCalibrationNote('Based on 8 runs', 'en')).toBe('Based on 8 runs');
    expect(translateActivityName('Morning Run', 'zh')).toBe('Morning Run');
  });

  it('translates score taxonomy and preserves unknown keys', () => {
    expect(translateScoreCategory('Autonomic Recovery', 'zh')).toBe('自主神经恢复');
    expect(translateScoreCategory('New Category', 'zh')).toBe('New Category');
    expect(translateScoreLabel('Strong Negative-Split Finish', 'zh')).toBe('后程加速（负分段）');
    expect(translateScoreLabel('New Label', 'zh')).toBe('New Label');
    expect(translateScoreLabel('Late-Race Fade', 'en')).toBe('Late-Race Fade');
  });

  it('translates additional score descriptions and returns unmatched copy unchanged', () => {
    expect(translateScoreDescription('170 spm steady cadence', 'zh')).toBe('稳态步频 170 spm');
    expect(translateScoreDescription('320 ms ground contact', 'zh')).toBe('触地时间 320 ms');
    expect(translateScoreDescription('Target volume was cut short before the planned stimulus was delivered', 'zh'))
      .toContain('目标跑量');
    expect(translateScoreDescription('Unrecognized metric', 'zh')).toBe('Unrecognized metric');
    expect(translateScoreDescription('170 spm steady cadence', 'en')).toBe('170 spm steady cadence');
  });

  it('translates walk-break and personal-baseline insight variants', () => {
    const cases: Array<[string, string]> = [
      ['Walk-Break Strategy: 3 walk breaks (12.5% of moving time, average entry 132 bpm) held heart rate under your 150 bpm LT1 ceiling, peaking at 145 bpm.', '平均进入心率 132 bpm'],
      ['Walk-Break Strategy: 2 walk breaks (8.0% of moving time) held heart rate under your 150 bpm LT1 ceiling.', '心率稳定控制在 LT1 上限 150 bpm 以下'],
      ['Work-Rep Interruption: 45s of walking began inside work reps at an average of 176 bpm (at or above LT1). Adjust the first rep.', '平均进入心率 176 bpm'],
      ['Unplanned Walking: 70s of mid-run walking started at about 125 bpm. Check fuelling and sleep.', '约 125 bpm 时开始'],
      ['Training Load Context: your 7-day load is 1.8x your 28-day weekly average — a high-risk spike. Keep the next days easy.', '高风险激增'],
      ['Training Load Context: your 7-day load is 1.4x your 28-day weekly average and ramping fast. Be patient.', '上升较快'],
      ['Training Load Context: your 7-day load is 0.5x your 28-day weekly average — a deload window. Recovery is working.', '属于减量周'],
      ['Training Load Context: your 7-day load is 1.0x your 28-day weekly average, inside the productive 0.8-1.3 tunnel. Good absorption.', '处于 0.8-1.3 的高效区间'],
      ['Personal Baseline: running economy reached 1.12 EF + 4.5%, above your 28-day median across 6 comparable runs. This is a real aerobic gain.', '（+4.5%）'],
      ['Personal Baseline: running economy came in 3.2% below your 28-day median of 1.05 EF. Watch for fatigue.', '中位数 1.05 EF 低 3.2%'],
      ['Pace-Specific Cost: 5:30/km usually costs you 145 bpm across 5 comparable runs; today you paid 6 bpm less. Nice adaptation.', '今天少了 6 bpm'],
      ['Pace-Specific Cost: 5:30/km usually costs you 145 bpm across 5 comparable runs; today it cost 8 bpm more. Check heat.', '今天多了 8 bpm'],
      ['Relative Standing: this was your most stable aerobic session across the last 9 comparable runs.', '最近 9 次可比训练'],
      ['Relative Standing: aerobic stability ranks 2 of your last 9 comparable runs (best 1.2% drift).', '排名第 2'],
      ['Relative Standing: aerobic stability ranks 4 of your last 9 comparable runs.', '排名第 4'],
      ['Volume Milestone: at 18.5 km this is your longest comparable run in the last 90 days. Strong endurance.', '18.5 公里'],
      ['Rubric Coverage: 72% of the grading rubric was measurable. Score uses observed signals.', '72%']
    ];

    for (const [insight, expected] of cases) {
      const translated = translateCoachInsight(insight, 'zh');
      expect(translated).toContain(expected);
      expectNoPlaceholders(translated);
    }
  });

  it('translates measured and modeled air-quality watch-outs', () => {
    const measured = translateCoachInsight(
      "Air Quality Watch: NEA's nearest regional monitor measured 96 µg/m³ PM2.5 near the run midpoint (Elevated 1-hour band). Haze may have added breathing strain; the reading represents the wider region, not the exact route.",
      'zh'
    );
    expect(measured).toContain('NEA 最近的区域监测站');
    expect(measured).toContain('96 µg/m³');
    expect(measured).toContain('烟霾可能增加了呼吸负担');
    expectNoPlaceholders(measured);

    const modeled = translateCoachInsight(
      'Air Quality Estimate: Open-Meteo modeled midpoint PM2.5 at 62.4 µg/m³. This coarse model estimate may indicate haze, but is not a local monitor reading.',
      'zh'
    );
    expect(modeled).toContain('Open-Meteo 模型估算');
    expect(modeled).toContain('62.4 µg/m³');
    expect(modeled).toContain('不是本地监测站的实测值');
    expectNoPlaceholders(modeled);
  });
});

describe('Coach translator — condition-aware copy', () => {
  it('translates threshold-zone time in minutes and seconds', () => {
    const description = '34m 52s in Zone 4 (179-188 bpm), 77.5% of observed work-rep time';
    expect(translateScoreDescription(description, 'zh')).toContain('34 分 52 秒');
    const insight = translateCoachInsight(
      `Threshold Heart Rate: ${description}. Time in the threshold zone is the primary measure of this session; pace is supporting context.`,
      'zh'
    );
    expect(insight).toContain('34 分 52 秒');
    expect(insight).toContain('77.5%');
    expectNoPlaceholders(insight);
  });

  it('translates the biggest-lever advice with and without a heat-adjusted target', () => {
    const legacy = translateCoachFocusAdvice(legacyAerobicAdvice, 'zh');
    expect(legacy).toContain('最大提升杠杆 — 有氧稳定性');
    expect(legacy).toContain('141 bpm');
    expect(legacy).not.toContain('当前条件下的目标');
    expectNoPlaceholders(legacy);

    const hot = translateCoachFocusAdvice(hotAerobicAdvice, 'zh');
    expect(hot).toContain('当前条件下的目标是 4.44%');
    expect(hot).toContain('141 bpm');
    expectNoPlaceholders(hot);
  });

  it('translates the condition-aware cardiac-drift insights', () => {
    const inside = translateCoachInsight(
      'Superb cardiovascular stability with only 1.2% drift, at or inside the 3.84% target that 30°C over 121 min predict. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue.',
      'zh'
    );
    expect(inside).toContain('漂移仅 1.2%');
    expect(inside).toContain('3.84%');
    expectNoPlaceholders(inside);

    const above = translateCoachInsight(
      'Solid aerobic discipline. Decoupling was 4.2%, just above the 3.84% working target for 30°C over 121 min but well within the sub-LT1 gold standard threshold (<5%).',
      'zh'
    );
    expect(above).toContain('4.2%');
    expect(above).toContain('3.84%');
    expectNoPlaceholders(above);

    const drift = translateCoachInsight(
      'Noticeable cardiac drift detected (7.9% against a 4.44% target for 31°C over 130 min). Likely due to thermal strain (31°C), dehydration, or pacing slightly ahead of current aerobic capacity.',
      'zh'
    );
    expect(drift).toContain('7.9%');
    expect(drift).toContain('31°C');
    expectNoPlaceholders(drift);
  });

  it('translates the high-Zone-2 messaging', () => {
    const insight = translateCoachInsight(
      'Zone 2 Ceiling Held, High-Zone-2 Creep: you never crossed the 153 bpm LT1 ceiling, but 55.0% of your running time sat in the top of Zone 2 (146-153 bpm), rising to 75% in the second half. It is still aerobic, and in 32°C much of the late creep is heat rather than pace, but sitting just under the ceiling costs recovery — ease the opening kilometres so the whole run sits nearer 143 bpm.',
      'zh'
    );
    expect(insight).toContain('守住上限，但停留在 2 区上部');
    expect(insight).toContain('146-153 bpm');
    expectNoPlaceholders(insight);

    const lever = translateCoachFocusAdvice(
      'Biggest Lever — Aerobic Intensity: you never crossed the 153 bpm LT1 ceiling, but 55.0% of your running time sat in the top of Zone 2 (146-153 bpm) (16 of 85 points lost). Staying just under the ceiling still costs recovery, so on easy days treat 143 bpm as the ceiling rather than 153 — the hard limit is a safety line, not the target.',
      'zh'
    );
    expect(lever).toContain('最大提升杠杆 — 有氧强度');
    expect(lever).toContain('146-153 bpm');
    expect(lever).toContain('16 / 85');
    expectNoPlaceholders(lever);

    expect(translateScoreDescription('55.0% in the top of Zone 2 (146-153 bpm) · 0.0% above the 153 bpm LT1 ceiling · rising to 75% in the second half', 'zh'))
      .toContain('2 区上部（146-153 bpm）');
    expect(translateScoreDescription('9.0% above the 153 bpm LT1 ceiling (first half: 8.0%) · 20.0% in the top of Zone 2 (146-153 bpm)', 'zh'))
      .toContain('前半程 8.0%');
  });

  it('translates the aerobic intensity copy (category, labels, description, insight, lever)', () => {
    expect(translateScoreCategory('Aerobic Intensity', 'zh')).toBe('有氧强度');
    expect(translateScoreLabel('Disciplined Aerobic Ceiling', 'zh')).toBe('严格遵守有氧心率上限');
    expect(translateScoreLabel('Extended Above the LT1 Ceiling', 'zh')).toBe('长时间超过 LT1 上限');

    expect(translateScoreDescription('0.7% above the 153 bpm LT1 ceiling (first half: 0.0%) · 22.4% in the top of Zone 2 (146-153 bpm)', 'zh'))
      .toContain('153 bpm 的 LT1 上限');
    expect(translateScoreDescription('135 bpm average against a 143 bpm LT1 ceiling (average only — no per-second telemetry)', 'zh'))
      .toContain('无逐秒采样数据');

    const discipline = translateCoachInsight(
      'Aerobic Intensity Discipline: only 0.7% of your running time sat above the 153 bpm LT1 ceiling (0.0% of it in the first half), so this stayed an aerobic session throughout. That’s the point of an easy day: keep the effort easy, whatever the pace.',
      'zh'
    );
    expect(discipline).toContain('有氧强度纪律');
    expectNoPlaceholders(discipline);

    const over = translateCoachInsight(
      'Over-Intensity: 41.2% of your running time sat above the 153 bpm LT1 ceiling, with 30.0% of it in the first half. That is a tempo effort wearing an easy-day label, so it costs recovery without adding aerobic volume.',
      'zh'
    );
    expect(over).toContain('强度超标');
    expect(over).toContain('41.2%');
    expectNoPlaceholders(over);

    const lever = translateCoachFocusAdvice(
      'Biggest Lever — Aerobic Intensity: 24.0% of your running time sat above the 148 bpm LT1 ceiling (19.0% of it in the first half) (20 of 85 points lost). Set a watch alert at 142 bpm and walk any climb that pushes you over it — for an easy day, keeping the ceiling is the whole session.',
      'zh'
    );
    expect(lever).toContain('最大提升杠杆 — 有氧强度');
    expect(lever).toContain('142 bpm');
    expectNoPlaceholders(lever);
  });

  it('translates the set-shape copy', () => {
    expect(translateScoreLabel('Drifted Into VO2 Territory', 'zh')).toBe('漂移至 VO2 强度区间');

    const drift = translateCoachInsight(
      'Session Drift: work reps averaged 193 bpm against your 177 bpm LT2 anchor — 16 bpm above it, so this ran as a VO2 session rather than threshold. That is a different stimulus, not a better one: either log it as intervals_vo2 or ease the pace so the reps stay on the threshold anchor.',
      'zh'
    );
    expect(drift).toContain('课表漂移');
    expect(drift).toContain('193 bpm');
    expect(drift).toContain('177 bpm');
    expectNoPlaceholders(drift);

    const weak = translateCoachInsight(
      'Session Drift: work reps averaged 152 bpm, 25 bpm below your 177 bpm LT2 anchor, so the threshold stimulus was not reached. Nudge the pace up or shorten the recoveries.',
      'zh'
    );
    expect(weak).toContain('未达到阈值刺激');
    expectNoPlaceholders(weak);

    const profile = translateCoachInsight(
      'Set Profile: 3 x 14m 59s work with 1m 24s recoveries — 44m 57s of total work time, graded against the tolerances that set length allows.',
      'zh'
    );
    expect(profile).toContain('课表结构：3 x 14m 59s');
    expect(profile).toContain('恢复 1m 24s');
    expectNoPlaceholders(profile);

    expect(translateScoreDescription('172 bpm peak work HR (60s reps are too short to average to target) against a 178 bpm LT2 anchor', 'zh'))
      .toContain('间歇峰值心率 172 bpm');
    expect(translateScoreDescription('last rep 6s/km slower than the first · work HR 12 bpm higher by the last rep (not graded: short reps carry HR lag) (across 12 reps)', 'zh'))
      .toContain('不评分：短间歇存在心率滞后');
    expect(translateScoreDescription('last rep 4s/km slower than the first (across 10 reps, 5% drift allowed for the set length)', 'zh'))
      .toContain('该时长允许 5% 的漂移');
  });

  it('translates the quality-session fatigue and recovery copy', () => {
    expect(translateScoreCategory('Rep-to-Rep Fatigue', 'zh')).toBe('组内疲劳衰减');
    expect(translateScoreLabel('Late-Rep Collapse', 'zh')).toBe('后段单趟崩塌');
    expect(translateScoreLabel('Held Rep Pace and HR to the End', 'zh')).toBe('末组配速与心率均保持稳定');
    expect(translateScoreDescription('last rep 36s/km slower than the first (across 3 reps)', 'zh'))
      .toContain('末组比首组慢 36 秒/公里');
    expect(translateScoreDescription('last rep 4s/km faster than the first · work HR 6 bpm lower by the last rep (across 4 reps)', 'zh'))
      .toContain('末组平均心率低 6 bpm');
    expect(translateScoreDescription('work HR 8 bpm higher by the last rep (across 3 reps)', 'zh'))
      .toContain('末组平均心率高出 8 bpm');

    const intent = translateCoachInsight(
      'Recovery Intent: 2 recoveries averaged 84s, dropping heart rate 33 bpm (24 bpm/min). Short recoveries deliberately keep heart rate near threshold so more of the set counts as time-in-zone, so the drop size is not graded here — whether the reps held pace and heart rate is.',
      'zh'
    );
    expect(intent).toContain('恢复意图');
    expect(intent).toContain('84 秒');
    expectNoPlaceholders(intent);

    const lever = translateCoachFocusAdvice(
      'Biggest Lever — Rep-to-Rep Fatigue: the set decayed as it went — work HR finished 8 bpm higher than the first rep (4 of 12 points lost). A drifting work HR at held or slower pace points at fuelling, heat and recovery between sets rather than at fitness. Start the first rep 5-8 sec/km easier so the final rep lands on target.',
      'zh'
    );
    expect(lever).toContain('最大提升杠杆 — 组内疲劳衰减');
    expect(lever).toContain('4 / 12');
    expectNoPlaceholders(lever);
  });

  it('translates the pacing-discipline copy for both telemetry sources', () => {
    const telemetry = translateCoachInsight(
      'Pacing Discipline: your running pace held within ±2s per kilometre across 17 running km, with a steady 0.9s/km slowdown through the run. The 6 km that contained stops, junctions or walk breaks were measured on running time only, so navigating the city did not count against you.',
      'zh'
    );
    expect(telemetry).toContain('17 个实际跑动的公里');
    expect(telemetry).toContain('±2 秒/公里');
    expect(telemetry).toContain('6 个公里包含停顿');
    expectNoPlaceholders(telemetry);

    expect(translateScoreDescription('1.3% variance (±6s) across 17 running km, hill-adjusted; 5 km had stops or junctions, measured on running time only', 'zh'))
      .toContain('17 个实际跑动公里内配速波动 1.3%');
    expect(translateScoreDescription('7.1% variance (±28s) across 12 raw km splits (no per-second telemetry)', 'zh'))
      .toContain('无逐秒采样数据');

    const advice = translateCoachFocusAdvice(
      'Biggest Lever — Pacing Consistency: running pace varied more than it needed to (12 of 14 points lost). Your running pace held within ±14s per kilometre across 6 running km. Lock a pace band before the start and check it every kilometre instead of chasing feel.',
      'zh'
    );
    expect(advice).toContain('最大提升杠杆 — 配速一致性');
    expect(advice).toContain('±14 秒/公里');
    expectNoPlaceholders(advice);
  });

  it('translates the walk-break insights and rubric descriptions', () => {
    expectNoPlaceholders(translateCoachInsight(
      'Interval-Break Walking: 235s of walking across 3 breaks fell inside your prescribed recovery windows. That is the session design, so it is not scored as lost work.',
      'zh'
    ));
    expectNoPlaceholders(translateCoachInsight(
      'Turnaround Dips: 14 brief cadence dips (up to 111s total, barely any ground covered) were ignored as loop turnarounds rather than counted as walk breaks.',
      'zh'
    ));
    expect(translateScoreDescription('4.4% cardiac drift against a 4.44% target for 31°C over 130 min', 'zh'))
      .toContain('31°C / 130 分钟条件下目标为 4.44%');
    expect(translateScoreDescription('1.8% cardiac drift (2.4% or lower earns full marks)', 'zh'))
      .toContain('≤2.4% 可获满分');
  });
});
