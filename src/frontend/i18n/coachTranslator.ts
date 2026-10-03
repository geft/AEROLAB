import { zh } from './zh.js';
import { interpolate } from './LanguageContext.js';
/**
 * Session analysis translation service
 * Translates session-analysis headlines, insights, recommendations, and rubric factors into Chinese.
 */

export function translateCoachHeadline(headline: string, lang: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !headline) return headline;

  const mapping: Record<string, string> = {
    'Low-Stress Active Recovery Jog': copy.legacy_001,
    'Near-Perfect Aerobic Base Execution': copy.legacy_002,
    'Productive Zone 2 Aerobic Foundation': copy.legacy_003,
    'High-Quality Lactate Clearance Stimulus': copy.legacy_004,
    'Masterful VO2 Max Interval Execution': copy.legacy_005,
    'Sharp High-Velocity Neuromuscular Stimulus': copy.legacy_006,
    'Unintentional Tempo / Drifted Aerobic Run': copy.legacy_007,
    'Incomplete / Aborted Quality Session': copy.legacy_008,
    'All-Out Benchmark / Masterful Race Execution': copy.legacy_009,
    'All-Out Benchmark Effort (Erratic Pacing)': copy.legacy_010,
    'Strong Aerobic Adaptation Session': copy.legacy_011,
    'Threshold Stimulus with Compromised Execution': copy.legacy_012,
    'Threshold Zone Not Verified': copy.legacy_013
  };

  return mapping[headline.trim()] || headline;
}

export function translateCoachRecommendation(recommendation: string, lang: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !recommendation) return recommendation;

  if (recommendation.includes('Superb discipline keeping heart rate low and muscle tissue unstressed')) {
    return copy.legacy_014;
  }
  if (recommendation.includes('Maintain easy efforts at this heart rate cap')) {
    return copy.legacy_015;
  }
  if (recommendation.includes('Your aerobic system is absorbing current volume smoothly')) {
    return copy.legacy_016;
  }
  if (recommendation.includes('Allow 48 hours of recovery or easy aerobic jogging')) {
    return copy.legacy_017;
  }
  if (recommendation.includes('Focus on leg recovery and adequate protein intake')) {
    return copy.legacy_018;
  }
  if (recommendation.includes('slow your initial kilometer pace by 15-20 sec/km')) {
    return recommendation.replace(
      /If an Easy recovery was intended, slow your initial kilometer pace by 15-20 sec\/km to keep heart rate firmly under your LT1 ceiling \((\d+) bpm\)\./i,
      copy.legacy_019
    );
  }
  if (recommendation.includes('Assess underlying fatigue, heat stress, or nutrition')) {
    return copy.legacy_020;
  }
  if (recommendation.includes('Prioritize complete replenishment, deep sleep, and gentle recovery jogging')) {
    return copy.legacy_021;
  }
  if (recommendation.includes('target an even or slight negative split')) {
    return copy.legacy_022;
  }
  if (recommendation.includes('Prioritize light hydration and low-impact movement')) {
    return copy.legacy_023;
  }

  return recommendation;
}

export function translateCoachInsight(insight: string, lang: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !insight) return insight;

  if (insight.startsWith('Threshold Heart Rate:')) {
    return insight
      .replace(/^Threshold Heart Rate: (\d+)m (\d{2})s within the LT2 band \((\d+)-(\d+) bpm\), ([\d.]+)% of observed work-rep time\. Time near the LT2 range is the primary measure of this session; pace is supporting context\.$/,
        copy.legacy_024)
      .replace('Threshold Heart Rate: Work-rep heart-rate coverage was insufficient to verify time in the threshold zone. This session cannot earn a gold threshold grade from pace alone.',
        copy.legacy_025);
  }

  // 1. Traffic & Walk Break Isolation
  if (insight.startsWith('Traffic & Walk Break Isolation:')) {
    // Traffic & Walk Break Isolation: Removed 9 stationary/traffic stops (5m 46s idle) and 2 walk breaks (19s, 5m) from steady-state analysis. Your true running pace averaged 6:27/km at 133 bpm (178 spm), preventing pause distortion.
    return insight
      .replace('Traffic & Walk Break Isolation: Removed ', copy.legacy_026)
      .replace('stationary/traffic stops', copy.legacy_027)
      .replace('stationary/traffic stop', copy.legacy_027)
      .replace('walk breaks', copy.legacy_028)
      .replace('walk break', copy.legacy_028)
      .replace('idle', copy.legacy_029)
      .replace('from steady-state analysis. Your true running pace averaged ', copy.legacy_030)
      .replace(' at ', copy.legacy_031)
      .replace('preventing pause distortion.', copy.legacy_032);
  }

  // 2. Aerobic Decoupling: Superb cardiovascular stability
  if (insight.includes('Superb cardiovascular stability with only')) {
    if (insight.includes('at or inside the')) {
      return insight.replace(
        /Superb cardiovascular stability with only ([\d.]+)% drift, at or inside the ([\d.]+)% target that (.+?) predict\..*/,
        copy.legacy_033
      );
    }
    return insight.replace(
      /Superb cardiovascular stability with only ([\d.]+)% drift\. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue\./,
      copy.legacy_034
    );
  }

  // 3. Aerobic Decoupling: Solid aerobic discipline
  if (insight.includes('Solid aerobic discipline. Decoupling was')) {
    if (insight.includes('working target')) {
      return insight.replace(
        /Solid aerobic discipline\. Decoupling was ([\d.]+)%, just above the ([\d.]+)% working target for (.+?) but well within .*/,
        copy.legacy_035
      );
    }
    return insight.replace(
      /Solid aerobic discipline\. Decoupling was ([\d.]+)(?:%)?, well within the sub-LT1 gold standard threshold \(<5%\)\./,
      copy.legacy_036
    );
  }

  // 4. Aerobic Decoupling: Noticeable cardiac drift detected
  if (insight.includes('Noticeable cardiac drift detected')) {
    if (insight.includes('against a')) {
      return insight.replace(
        /Noticeable cardiac drift detected \(([\d.]+)% against a ([\d.]+)% target for (.+?)\)\. Likely due to thermal strain(?: \(([\d.]+)°C\))?, dehydration, or pacing slightly ahead of current aerobic capacity\./,
        (_m, drift, target, conditions, temp) =>
          interpolate(copy.legacy_038, { p0: drift, p1: conditions, p2: target, p3: temp ? interpolate(copy.legacy_037, { p0: temp }) : '。' })
      );
    }
    return insight
      .replace('Noticeable cardiac drift detected (', copy.legacy_039)
      .replace('). Likely due to thermal strain', copy.legacy_040)
      .replace(', dehydration, or pacing slightly ahead of current aerobic capacity.', copy.legacy_041);
  }

  // 5. Cadence: Sweet spot
  if (insight.includes('Cadence was right in the sweet spot')) {
    return insight.replace(
      /Cadence was right in the sweet spot \((\d+) spm\), minimizing vertical braking forces and maximizing elastic recoil\./,
      copy.legacy_042
    );
  }

  // 6. Cadence: High turnover
  if (insight.includes('High turnover') && insight.includes('maintained during steady running')) {
    return insight.replace(
      /High turnover \((\d+) spm\) maintained during steady running, promoting quick foot turnover\./,
      copy.legacy_043
    );
  }

  // 7. Cadence: Low turnover
  if (insight.includes('Steady running cadence averaged') && insight.includes('Increasing turnover toward 170-180 spm')) {
    return insight.replace(
      /Steady running cadence averaged (\d+) spm\. Increasing turnover toward 170-180 spm will decrease ground contact time and reduce joint impact\./,
      copy.legacy_044
    );
  }

  // 8. Running dynamics: Swift ground reaction
  if (insight.includes('Swift ground reaction:')) {
    return insight.replace(
      /Swift ground reaction: (\d+) ms stance time demonstrates crisp ground clearance and leg spring stiffness\./,
      copy.legacy_045
    );
  }

  // 9. Microclimate Weather
  if (insight.startsWith('Microclimate Weather:')) {
    let res = insight.replace('Microclimate Weather:', copy.legacy_046);
    res = res.replace('ambient', copy.legacy_047);
    res = res.replace('Overcast', copy.legacy_048);
    res = res.replace('Clear', copy.legacy_049);
    res = res.replace('Rain', copy.legacy_050);
    res = res.replace(/(Light|Moderate|Heavy) snow showers?/gi, copy.legacy_051);
    res = res.replace(/(Light|Moderate|Heavy) snow/gi, copy.legacy_051);
    res = res.replace(/(Light|Moderate|Heavy) rain showers?/gi, copy.legacy_052);
    res = res.replace('Partly Cloudy', copy.legacy_053);
    res = res.replace('with', copy.legacy_054);
    res = res.replace('humidity', '');
    res = res.replace('feels like', copy.legacy_055);
    res = res.replace('Garmin watch sensor:', copy.legacy_056);
    res = res.replace('High tropical humidity restricts evaporative cooling and directly explains elevated cardiac drift.', copy.legacy_057);
    res = res.replace('Microclimate weather verified from local meteorological reanalysis.', copy.legacy_058);
    res = res.replace(/Precipitation conditions \((.+?)\) may have affected comfort and footing\./, copy.legacy_059);
    res = res.replace(/Warmer than your recent fetched-run average \(([\d.]+)°C\), adding heat strain\./, copy.legacy_060);
    res = res.replace(/NEA's nearest regional monitor reported ([\d.]+) µg\/m³ PM2\.5 near the run midpoint \((Normal|Elevated|High|Very High) 1-hour band\); haze may have added breathing strain\./, copy.legacy_061);
    res = res.replace(/Open-Meteo modeled midpoint PM2\.5 at ([\d.]+) µg\/m³; this is a model estimate, and haze may have added breathing strain\./, copy.legacy_062);
    return res;
  }

  if (insight.startsWith('Air Quality Watch:')) {
    return insight.replace(
      /Air Quality Watch: NEA's nearest regional monitor measured ([\d.]+) µg\/m³ PM2\.5 near the run midpoint \((Elevated|High|Very High) 1-hour band\)\. Haze may have added breathing strain; the reading represents the wider region, not the exact route\./,
      copy.legacy_063
    );
  }

  if (insight.startsWith('Air Quality Estimate:')) {
    return insight.replace(
      /Air Quality Estimate: Open-Meteo modeled midpoint PM2\.5 at ([\d.]+) µg\/m³\. This coarse model estimate may indicate haze, but is not a local monitor reading\./,
      copy.legacy_064
    );
  }

  // 10. Hot conditions fallback
  if (insight.includes('Executed in hot conditions')) {
    return insight.replace(
      /Executed in hot conditions \((\d+)°C\)\. In high heat, heart rate naturally drifts 4-8 bpm higher; effective aerobic pacing was maintained despite the thermal burden\./,
      copy.legacy_065
    );
  }

  // 11. Elevation & Ramps
  if (insight.startsWith('Elevation & Ramps:')) {
    return insight.replace(
      /Elevation & Ramps: Gained \+(\d+)m ascent\. Uphill grade segments and ramp walks were isolated to keep your flat-ground running economy unskewed\./,
      copy.legacy_066
    );
  }

  // 12. Pacing Alert: Accidental tempo
  if (insight.startsWith('Pacing Alert:')) {
    return insight.replace(
      /Pacing Alert: Heart rate drifted notably higher than pure Zone 2 \((\d+) bpm avg\)\. This functioned as an unintentional 'grey-zone' tempo effort rather than a low-stress aerobic recovery session\./,
      copy.legacy_067
    );
  }

  // 13. Interval reps: Laser precision
  if (insight.includes('Exceptional Rep Consistency:')) {
    return insight.replace(
      /Exceptional Rep Consistency: Executed (\d+) work reps with laser precision \(([\d.]+)% duration variance, ±(\d+)s spread\)\. Zero early overshoot or late-rep collapse\./,
      copy.legacy_068
    );
  }

  // 14. Interval reps: Disciplined Interval Structure
  if (insight.includes('Disciplined Interval Structure:')) {
    return insight.replace(
      /Disciplined Interval Structure: Held (\d+) work reps consistently \(([\d.]+)% duration variance\)\./,
      copy.legacy_069
    );
  }

  // 15. Interval reps: Rep Variance Warning
  if (insight.includes('Rep Variance Warning:')) {
    return insight.replace(
      /Rep Variance Warning: High duration variance across reps \(([\d.]+)%\)\. Focus on even rep durations to keep the stimulus consistent across the entire set\./,
      copy.legacy_070
    );
  }

  // 16. Target VO2 Stimulus Achieved
  if (insight.includes('Target VO2 Stimulus Achieved:')) {
    return insight.replace(
      /Target VO2 Stimulus Achieved: Heart rate peaked at (\d+) bpm \(([\d.]+)% HRmax\), successfully stimulating maximal oxygen uptake and cardiac stroke volume adaptations\./,
      copy.legacy_071
    );
  }

  // 17. Aborted workout
  if (insight.includes('Incomplete / Aborted Quality Effort:')) {
    return copy.legacy_072;
  }

  // 18. Set shape: what was actually being graded
  if (insight.startsWith('Session Drift:')) {
    if (insight.includes('ran as a VO2 session')) {
      return insight.replace(
        /^Session Drift: work reps (peaked at|averaged) (\d+) bpm against your (\d+) bpm LT2 anchor — (\d+) bpm above it.*$/,
        (_m, mode, hr, anchor, over) =>
          interpolate(copy.legacy_075, { p0: mode === 'peaked at' ? copy.legacy_074 : copy.legacy_073, p1: hr, p2: anchor, p3: over })
      );
    }
    return insight.replace(
      /^Session Drift: work reps averaged (\d+) bpm, (\d+) bpm below your (\d+) bpm LT2 anchor.*$/,
      copy.legacy_076
    );
  }

  if (insight.startsWith('Set Profile:')) {
    return insight.replace(
      /^Set Profile: (\d+) x (.+?) work(?: with (.+?) recoveries)? — (.+?) of total work time.*$/,
      (_m, reps, repDuration, recovery, totalWork) =>
        interpolate(copy.legacy_078, { p0: reps, p1: repDuration, p2: recovery ? interpolate(copy.legacy_077, { p0: recovery }) : '', p3: totalWork })
    );
  }

  // 19. Aerobic intensity: the one thing an easy run is graded on
  if (insight.startsWith('Clearly Easy:')) {
    return insight.replace(
      /^Clearly Easy: (?:only ([\d.]+)% of your running time sat above the (\d+) bpm LT1 ceiling; )?([\d.]+)% of your running time sat in upper Zone 2 \(([\d-]+) bpm\), below the 40% clearly-easy guide\..*$/,
      (_m, above, lt1, zone2, band) => interpolate(copy.legacy_080, { p0: above ? interpolate(copy.legacy_079, { p0: above, p1: lt1 }) : '', p1: zone2, p2: band })
    );
  }
  if (insight.startsWith('Normal Easy:')) {
    return insight.replace(
      /^Normal Easy: you never crossed the (\d+) bpm LT1 ceiling, and ([\d.]+)% of your running time sat in upper Zone 2 \(([\d-]+) bpm\), within the 40-60% normal-easy range\..*$/,
      (_m, lt1, zone2, band) => interpolate(copy.legacy_081, { p0: lt1, p1: zone2, p2: band })
    );
  }
  if (insight.startsWith('Zone 2 Ceiling Held, High-Zone-2 Creep:')) {
    return insight.replace(
      /^Zone 2 Ceiling Held, High-Zone-2 Creep: you never crossed the (\d+) bpm LT1 ceiling, but ([\d.]+)% of your running time sat in upper Zone 2 \(([\d-]+) bpm\), rising to (\d+)% in the second half\..*$/,
      (_m, lt1, zone2, band, late) =>
        interpolate(copy.legacy_084, { p0: lt1, p1: zone2, p2: band, p3: late, p4: Number(zone2) <= 75 ? copy.legacy_083 : copy.legacy_082, p5: Number(lt1) - 10 })
    );
  }

  if (insight.startsWith('Recovery Intent:')) {
    return insight.replace(
      /^Recovery Intent: (\d+) recoveries averaged (\d+)s, dropping heart rate (\d+) bpm \((\d+) bpm\/min\)\..*$/,
      copy.legacy_085
    );
  }

  if (insight.startsWith('Recovery Rate:')) {
    if (insight.includes('slow even for recoveries')) {
      return insight.replace(
        /^Recovery Rate: (\d+) recoveries averaged (\d+)s with a (\d+) bpm drop \((\d+) bpm\/min\), which is slow even for recoveries of that length\..*$/,
        copy.legacy_086
      );
    }
    return insight.replace(
      /^Recovery Rate: (\d+) recoveries averaged (\d+)s with a (\d+) bpm drop \((\d+) bpm\/min\), a healthy decay for that recovery length\.$/,
      copy.legacy_087
    );
  }

  if (insight.startsWith('Aerobic Intensity Discipline:')) {
    return insight.replace(
      /^Aerobic Intensity Discipline: only ([\d.]+)% of your running time sat above the (\d+) bpm LT1 ceiling \(([\d.]+)% of it in the first half\), so this stayed an aerobic session throughout\..*$/,
      copy.legacy_088
    );
  }

  if (insight.startsWith('Grey-Zone Creep:')) {
    return insight.replace(
      /^Grey-Zone Creep: ([\d.]+)% of running time was above your (\d+) bpm LT1 ceiling \(([\d.]+)% of it in the first half\)\..*$/,
      copy.legacy_089
    );
  }

  if (insight.startsWith('Over-Intensity:')) {
    return insight.replace(
      /^Over-Intensity: ([\d.]+)% of your running time sat above the (\d+) bpm LT1 ceiling, with ([\d.]+)% of it in the first half\..*$/,
      copy.legacy_090
    );
  }

  // 19. Walk breaks: classified by why they happened (never moralised)
  if (insight.startsWith('Pacing Discipline: your running pace held within')) {
    return insight.replace(
      /^Pacing Discipline: your running pace held within ±(\d+)s per kilometre across (\d+) running km(?:, (?:(?:with )?a steady ([\d.]+)s\/km slowdown|progressively ([\d.]+)s\/km faster) through the run)?\. The (\d+) km that contained stops, junctions or walk breaks were measured on running time only, so navigating the city did not count against you\.$/,
      (_m, spread, km, slowdown, faster, affected) =>
        interpolate(copy.legacy_093, { p0: km, p1: spread, p2: slowdown ? interpolate(copy.legacy_091, { p0: slowdown }) : '', p3: faster ? interpolate(copy.legacy_092, { p0: faster }) : '', p4: affected })
    );
  }

  if (insight.startsWith('Interval-Break Walking:')) {
    return insight.replace(
      /^Interval-Break Walking: (\d+)s of walking across (\d+) breaks fell inside your prescribed recovery windows\..*/,
      copy.legacy_094
    );
  }

  if (insight.startsWith('Turnaround Dips:')) {
    return insight.replace(
      /^Turnaround Dips: (\d+) brief cadence dips \(up to (\d+)s total, barely any ground covered\) were ignored.*/,
      copy.legacy_095
    );
  }

  if (insight.startsWith('Walk-Break Strategy:')) {
    return insight.replace(
      /^Walk-Break Strategy: (\d+) walk breaks \(([\d.]+)% of moving time(?:, average entry (\d+) bpm)?\) held heart rate under your (\d+) bpm LT1 ceiling(?:, peaking at (\d+) bpm)?\..*/,
      (_m, count, pct, entryHr, lt1, peakHr) =>
        interpolate(copy.legacy_098, { p0: count, p1: pct, p2: entryHr ? interpolate(copy.legacy_096, { p0: entryHr }) : '', p3: lt1, p4: peakHr ? interpolate(copy.legacy_097, { p0: peakHr }) : '' })
    );
  }

  if (insight.startsWith('Work-Rep Interruption:')) {
    return insight.replace(
      /^Work-Rep Interruption: (\d+)s of walking began inside work reps at an average of ([^\s]+) bpm \(at or above LT1\)\..*/,
      copy.legacy_099
    );
  }

  if (insight.startsWith('Unplanned Walking:')) {
    return insight.replace(
      /^Unplanned Walking: (\d+)s of mid-run walking started at about ([^\s]+) bpm.*/,
      copy.legacy_100
    );
  }

  // 19. Personal-baseline context (athlete's own recent history)
  if (insight.startsWith('Training Load Context:')) {
    if (insight.includes('high-risk spike')) {
      return insight.replace(
        /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average — a high-risk spike\..*/,
        copy.legacy_101
      );
    }
    if (insight.includes('ramping fast')) {
      return insight.replace(
        /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average and ramping fast\..*/,
        copy.legacy_102
      );
    }
    if (insight.includes('deload window')) {
      return insight.replace(
        /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average — a deload window\..*/,
        copy.legacy_103
      );
    }
    return insight.replace(
      /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average, inside the productive 0\.8-1\.3 tunnel.*/,
      copy.legacy_104
    );
  }

  if (insight.startsWith('Personal Baseline:')) {
    if (insight.includes('a real aerobic gain')) {
      return insight.replace(
        /Personal Baseline: running economy reached ([\d.]+) EF \+ ([\d.]+)%, above your 28-day median across (\d+) comparable runs.*/,
        copy.legacy_105
      );
    }
    return insight.replace(
      /Personal Baseline: running economy came in ([\d.]+)% below your 28-day median of ([\d.]+) EF\..*/,
      copy.legacy_106
    );
  }

  if (insight.startsWith('Pace-Specific Cost:')) {
    if (insight.includes('less')) {
      return insight.replace(
        /Pace-Specific Cost: (\S+) usually costs you (\d+) bpm across (\d+) comparable runs; today you paid (\d+) bpm less.*/,
        copy.legacy_107
      );
    }
    return insight.replace(
      /Pace-Specific Cost: (\S+) usually costs you (\d+) bpm across (\d+) comparable runs; today it cost (\d+) bpm more.*/,
      copy.legacy_108
    );
  }

  if (insight.startsWith('Relative Standing:')) {
    if (insight.includes('most stable')) {
      return insight.replace(
        /Relative Standing: this was your most stable aerobic session across the last (\d+) comparable runs\./,
        copy.legacy_109
      );
    }
    if (insight.includes('(best ')) {
      return insight.replace(
        /Relative Standing: aerobic stability ranks (\d+) of your last (\d+) comparable runs \(best ([\d.]+)% drift\)\./,
        copy.legacy_110
      );
    }
    return insight.replace(
      /Relative Standing: aerobic stability ranks (\d+) of your last (\d+) comparable runs\./,
      copy.legacy_111
    );
  }

  if (insight.startsWith('Volume Milestone:')) {
    return insight.replace(
      /Volume Milestone: at ([\d.]+) km this is your longest comparable run in the last (\d+) days.*/,
      copy.legacy_112
    );
  }

  if (insight.startsWith('Rubric Coverage:')) {
    return insight.replace(
      /Rubric Coverage: (\d+)% of the grading rubric was measurable.*/,
      copy.legacy_113
    );
  }

  return insight;
}

export function translateScoreCategory(cat: string, lang: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !cat) return cat;
  const map: Record<string, string> = {
    'Base Execution': copy.legacy_114,
    'Aerobic Decoupling': copy.legacy_115,
    'Aerobic Intensity': copy.legacy_116,
    'Running Turnover': copy.legacy_117,
    'Interval Execution': copy.legacy_118,
    'Rep-to-Rep Fatigue': copy.legacy_119,
    'Cardiovascular Stimulus': copy.legacy_120,
    'Autonomic Recovery': copy.legacy_121,
    'Pacing Discipline': copy.legacy_122,
    'Threshold Zone Time': copy.legacy_123,
    'Threshold Heart Rate': copy.legacy_124,
    'Pacing Consistency': copy.legacy_125,
    'Race Pacing Execution': copy.legacy_126,
    'Race Finish Execution': copy.legacy_127,
    'Workout Completion': copy.legacy_128
  };
  return map[cat] || cat;
}

export function translateScoreLabel(label: string, lang: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !label) return label;
  const map: Record<string, string> = {
    'Standard Quality Baseline': copy.legacy_129,
    'Superb Cardiovascular Stability': copy.legacy_130,
    'Solid Sub-LT1 Aerobic Base': copy.legacy_131,
    'Elevated Cardiac Drift / Thermal Strain': copy.legacy_132,
    'Textbook Aerobic Discipline': copy.legacy_133,
    'Disciplined Aerobic Ceiling': copy.legacy_134,
    'Clearly Easy': copy.legacy_135,
    'Normal Easy': copy.legacy_136,
    'Upper Easy / Aerobic Steady': copy.legacy_137,
    'Potentially Too Close to LT1': copy.legacy_138,
    'Drifting Into High Zone 2': copy.legacy_139,
    'Extended Above the LT1 Ceiling': copy.legacy_140,
    'Substantially Walked Session': copy.legacy_141,
    'Walk-Dominated Session': copy.legacy_142,
    'Mostly Aerobic, Slightly Hot': copy.legacy_143,
    'Grey-Zone Drift Above LT1': copy.legacy_144,
    'Optimal Cadence Sweet Spot': copy.legacy_145,
    'Adequate Turnover': copy.legacy_146,
    'Sub-Optimal Cadence Turnover': copy.legacy_147,
    'Metronomic Split Consistency': copy.legacy_148,
    'Minor Split Variance': copy.legacy_149,
    'Erratic Split Pacing': copy.legacy_150,
    'Unbroken Session': copy.legacy_151,
    'Deliberate Walk-Break Strategy': copy.legacy_152,
    'Minor Break Time': copy.legacy_153,
    'Heavily Interrupted Session': copy.legacy_154,
    'Rep-Interrupting Walk Breaks': copy.legacy_155,
    'Walk Breaks Inside the Race Effort': copy.legacy_156,
    'Laser Rep Consistency': copy.legacy_157,
    'Held Rep Pace to the End': copy.legacy_158,
    'Held Rep Pace and HR to the End': copy.legacy_159,
    'Slight Late-Rep Fade': copy.legacy_160,
    'Late-Rep Pace Collapse': copy.legacy_161,
    'Late-Rep Collapse': copy.legacy_162,
    'Disciplined Interval Structure': copy.legacy_163,
    'High Rep Variance Across Set': copy.legacy_164,
    'Target VO2 Stimulus Achieved': copy.legacy_165,
    'Partial Cardiovascular Stimulus': copy.legacy_166,
    'Insufficient Cardiovascular Stimulus': copy.legacy_167,
    'Rapid Cardiovascular Recovery Drop': copy.legacy_168,
    'Normal Recovery Kinetics': copy.legacy_169,
    'Blunted Recovery Response': copy.legacy_170,
    'On-Target Intensity Control': copy.legacy_171,
    'Sustained Threshold Heart Rate': copy.legacy_172,
    'Partial Threshold Exposure': copy.legacy_173,
    'Little Threshold Exposure': copy.legacy_174,
    'Drifted Into VO2 Territory': copy.legacy_175,
    'Grey-Zone Intensity Drift': copy.legacy_176,
    'Overreaching Intensity': copy.legacy_177,
    'Aggressive Early Surge / Positive Split': copy.legacy_178,
    'Laser Race Pacing Discipline': copy.legacy_179,
    'Controlled Race Pacing': copy.legacy_180,
    'Volatile Split Pacing': copy.legacy_181,
    'Strong Negative-Split Finish': copy.legacy_182,
    'Held Form to the Line': copy.legacy_183,
    'Late-Race Fade': copy.legacy_184,
    'Full Race-Day Heart Rate Utilisation': copy.legacy_185,
    'Partial Race-Day Effort': copy.legacy_186,
    'Conservative Heart Rate Ceiling': copy.legacy_187,
    'Unintentional Tempo Pacing Alert': copy.legacy_188,
    'Aborted / Incomplete Quality Workout': copy.legacy_189
  };
  return map[label] || label;
}

/**
 * Score-factor descriptions carry the measured statistic behind each rubric
 * line (drift %, cadence, split variance, ...). Canonical templates keep this
 * mapping to one rule per metric.
 */
export function translateScoreDescription(description: string, lang: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !description) return description;

  const rules: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/^(\d+)m (\d{2})s within the LT2 band \((\d+)-(\d+) bpm\), ([\d.]+)% of observed work-rep time$/, copy.legacy_190],
    [/^([\d.]+)% cardiac drift \(([\d.]+)% or lower earns full marks\)$/, copy.legacy_191],
    [
      /^([\d.]+)% above the (\d+) bpm LT1 ceiling \(first half: ([\d.]+)%\) · ([\d.]+)% in the top of Zone 2 \(([\d-]+) bpm\)$/,
      copy.legacy_192
    ],
    [
      /^([\d.]+)% in the top of Zone 2 \(([\d-]+) bpm\) · ([\d.]+)% above the (\d+) bpm LT1 ceiling · rising to (\d+)% in the second half$/,
      copy.legacy_193
    ],
    [/^([\d.]+)% cardiac drift against a ([\d.]+)% target for (\d+)°C over (\d+) min$/, copy.legacy_194],
    [/^(\d+) bpm average against a (\d+) bpm LT1 ceiling \(average only — no per-second telemetry\)$/, copy.legacy_195],
    [/^([\d.]+)% of moving time in walk breaks \(up to 45% is free on easy sessions\)$/, copy.legacy_196],
    [/^([\d.]+)% variance \(±(\d+)s\) across (\d+) running km([^;]*?)(?:; (\d+) km had stops or junctions, measured on running time only)?$/, (_m, cv, spread, km, extra, affected) => interpolate(copy.legacy_201, { p0: km, p1: cv, p2: spread, p3: String(extra).includes('hill-adjusted') ? copy.legacy_197 : '', p4: String(extra).includes('slowing') ? copy.legacy_199 : String(extra).includes('progressing') ? copy.legacy_198 : '', p5: affected ? interpolate(copy.legacy_200, { p0: affected }) : '' })],
    [/^([\d.]+)% variance \(±(\d+)s\) across (\d+) raw km splits \(no per-second telemetry\)([^;]*)$/, (_m, cv, spread, km, extra) => interpolate(copy.legacy_202, { p0: km, p1: cv, p2: spread, p3: String(extra).includes('slowing') ? copy.legacy_199 : String(extra).includes('progressing') ? copy.legacy_198 : '' })],
    [/^([\d.]+)% of moving time paused or walking \((\d+)% or less earns full marks\)$/, copy.legacy_203],
    [/^([\d.]+)% of moving time in walk breaks \((\d+)% or less earns full marks; traffic stops are excluded\)$/, copy.legacy_204],
    [/^([\d.]+)% of moving time in walk breaks \(races rarely need them\)$/, copy.legacy_205],
    [/^([\d.]+)% of moving time in walk breaks$/, copy.legacy_206],
    [/^([\d.]+)% of moving time paused or walking$/, copy.legacy_207],
    [/^([\d.]+)% duration variance across (\d+) reps \(±(\d+)s spread\)$/, copy.legacy_208],
    [/^(\d+) bpm steady HR against a (\d+) bpm LT1 cap$/, copy.legacy_209],
    [/^(\d+) spm steady cadence · (\d+) ms ground contact$/, copy.legacy_210],
    [/^(\d+) spm steady cadence$/, copy.legacy_211],
    [/^(\d+) ms ground contact$/, copy.legacy_212],
    [/^Peaked at (\d+) bpm \((\d+)% HRmax\)$/, copy.legacy_213],
    [/^(\d+) bpm average HR drop across (\d+) recoveries$/, copy.legacy_214],
    [/^(\d+) bpm average work HR against a (\d+) bpm LT2 anchor$/, copy.legacy_215],
    [/^(\d+) walk breaks · ([\d.]+)% of moving time · (\d+)s not explained by ceiling, gradient or warm-up$/, copy.legacy_216],
    [/^(\d+) walk breaks on a planned run\/walk rhythm$/, copy.legacy_217],
    [/^(\d+) walk breaks · ([\d.]+)% of moving time \(gradient, start and cool-down walks are free\)$/, copy.legacy_218],
    [/^Last rep (\d+)s\/km slower than the first \(([\d.]+)% fade across (\d+) reps\)$/, copy.legacy_219],
    [/^last rep (\d+)s\/km slower than the first · work HR (\d+) bpm higher by the last rep \(across (\d+) reps\)$/, copy.legacy_220],
    [
      /^(?:last rep (\d+)s\/km (slower|faster) than the first)?(?: · )?(?:work HR (\d+) bpm (higher|lower) by the last rep(?: \(not graded: short reps carry HR lag\))?)? \(across (\d+) reps(?:, (\d+)% drift allowed for the set length)?\)$/,
      (_m, paceSec, paceDir, hrBpm, hrDir, reps, drift) => {
        const parts: string[] = [];
        if (paceSec) parts.push(interpolate(copy.legacy_223, { p0: paceDir === 'slower' ? copy.legacy_222 : copy.legacy_221, p1: paceSec }));
        if (hrBpm) parts.push(interpolate(copy.legacy_226, { p0: hrDir === 'higher' ? copy.legacy_225 : copy.legacy_224, p1: hrBpm }));
        if (!parts.length) return description;
        const lagNote = description.includes('not graded: short reps carry HR lag') ? copy.legacy_227 : '';
        const driftNote = drift ? interpolate(copy.legacy_228, { p0: drift }) : '';
        return interpolate(copy.legacy_229, { p0: parts.join(' · '), p1: reps, p2: lagNote, p3: driftNote });
      }
    ],
    [/^([\d.]+) bpm peak work HR \((\d+)s reps are too short to average to target\) against a (\d+) bpm LT2 anchor$/, copy.legacy_230],
    [/^last rep (\d+)s\/km faster than the first · work HR (\d+) bpm lower by the last rep \(across (\d+) reps\)$/, copy.legacy_231],
    [/^work HR (\d+) bpm higher by the last rep \(across (\d+) reps\)$/, copy.legacy_232],
    [/^work HR (\d+) bpm lower by the last rep \(across (\d+) reps\)$/, copy.legacy_233],
    [/^Last rep (\d+)s\/km faster than the first across (\d+) reps$/, copy.legacy_234],
    [/^(\d+) work reps · (\d+)s of walking inside work reps \(average entry ([^)]+) bpm\)$/, copy.legacy_235],
    [/^(\d+) work reps · ([\d.]+)% of moving time in walk breaks$/, copy.legacy_236],
    [/^Km 1 opened at (\S+) then faded (\d+)s\/km to (\S+)$/, copy.legacy_237],
    [/^(\d+)s\/km slower in the second half$/, copy.legacy_238],
    [/^(\d+)s\/km faster in the second half$/, copy.legacy_239],
    [/^Target volume was cut short before the planned stimulus was delivered$/, copy.legacy_240]
  ];

  for (const [pattern, replacement] of rules) {
    if (pattern.test(description)) {
      return typeof replacement === 'string'
        ? description.replace(pattern, replacement)
        : description.replace(pattern, replacement);
    }
  }
  return description;
}

/**
 * The "biggest lever" sentence names the factor that lost the most points plus
 * the concrete fix. Each English template is mapped back to its Chinese copy.
 */
export function translateCoachFocusAdvice(advice: string, lang: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !advice) return advice;

  const rules: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/^Biggest Lever — Threshold Zone Time: ([\d.]+)% of observed work-rep time was within the LT2 band \((\d+)-(\d+) bpm\) \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_241],
    [/^Biggest Lever — Threshold Heart Rate: work-rep heart rate missed the (\d+) bpm LT2 anchor \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_242],
    [
      /^Biggest Lever — Aerobic Intensity: you never crossed the (\d+) bpm LT1 ceiling, and ([\d.]+)% of your running time sat in the top of Zone 2 \(([\d-]+) bpm\) \((\d+) of (\d+) points lost\)\. That is (normal easy|upper-easy \/ aerobic steady|potentially too close to LT1 for a routine easy day)\. (.*)$/,
      (_m, lt1, zone2, band, lost, max, classification) => {
        const translatedClass = classification === 'normal easy'
          ? copy.legacy_136
          : classification === 'upper-easy / aerobic steady'
            ? copy.legacy_137
            : copy.legacy_243;
        const guidance = classification === 'normal easy'
          ? copy.legacy_244
          : interpolate(copy.legacy_245, { p0: Number(lt1) - 10 });
        return interpolate(copy.legacy_246, { p0: lt1, p1: zone2, p2: band, p3: lost, p4: max, p5: translatedClass, p6: guidance });
      }
    ],
    [
      /^Biggest Lever — Aerobic Intensity: ([\d.]+)% of your running time sat above the (\d+) bpm LT1 ceiling \(([\d.]+)% of it in the first half\) \((\d+) of (\d+) points lost\)\..*$/,
      (_m, above, lt1, early, lost, max) =>
        interpolate(copy.legacy_247, { p0: above, p1: lt1, p2: early, p3: lost, p4: max, p5: Number(lt1) - 6 })
    ],
    [
      /^Biggest Lever — Rep-to-Rep Fatigue: the set decayed as it went(?: — .+?)? \((\d+) of (\d+) points lost\)\..*$/,
      (_m, lost, max) =>
        interpolate(copy.legacy_248, { p0: lost, p1: max })
    ],
    [
      /^Biggest Lever — Aerobic Decoupling: ([\d.]+)% cardiac drift was the largest single cost \((\d+) of (\d+) points lost\)\.(?: The target for these conditions is ([\d.]+)% \(heat and duration both add drift you cannot pace away\), so this is about pacing and fuelling rather than fitness\.)? Start the opening 2 km 10-15 sec\/km slower and add easy volume at or below (\d+) bpm.*$/,
      (_m, drift, lost, max, target, ceiling) =>
        interpolate(copy.legacy_250, { p0: drift, p1: lost, p2: max, p3: target ? interpolate(copy.legacy_249, { p0: target }) : '', p4: ceiling })
    ],
    [
      /^Biggest Lever — Pacing Discipline: steady HR reached (\d+) bpm against a (\d+) bpm LT1 cap \((\d+) of (\d+) points lost\)\. Slow the opening 15-20 sec\/km and cap the watch at (\d+) bpm.*$/,
      copy.legacy_251
    ],
    [
      /^Biggest Lever — Pacing Discipline: work intervals averaged (\d+) bpm against a (\d+) bpm LT2 anchor \((\d+) of (\d+) points lost\)\. Set the watch to alert above (\d+) bpm.*$/,
      copy.legacy_252
    ],
    [
      /^Biggest Lever — Running Turnover: (\d+) spm cost the most execution points \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_253
    ],
    [
      /^Biggest Lever — Pacing Consistency: running pace varied more than it needed to \((\d+) of (\d+) points lost\)\.(?: Your running pace held within ±(\d+)s per kilometre across (\d+) running km\.)?(?: The steady ([\d.]+)s\/km slowdown through the run points at an opening that was too quick or under-fuelling\.)? Lock a pace band.*$/,
      (_m, lost, max, spread, km, slowdown) =>
        interpolate(copy.legacy_256, { p0: lost, p1: max, p2: spread ? interpolate(copy.legacy_254, { p0: km, p1: spread }) : '', p3: slowdown ? interpolate(copy.legacy_255, { p0: slowdown }) : '' })
    ],
    [
      /^Biggest Lever — Workout Completion: (\d+)s of mid-run walking started while heart rate was already below your aerobic band \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_257
    ],
    [
      /^Biggest Lever — Workout Completion: (\d+)s of walking started inside work reps at an average of ([^\s]+) bpm \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_258
    ],
    [
      /^Biggest Lever — Workout Completion: ([\d.]+)% of moving time was spent in walk breaks \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_259
    ],
    [
      /^Biggest Lever — Workout Completion: the session was aborted before the planned stimulus landed \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_260
    ],
    [
      /^Biggest Lever — Interval Execution: rep durations varied by ([\d.]+)% \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_261
    ],
    [
      /^Biggest Lever — Cardiovascular Stimulus: peak work HR only reached (\d+)% of HRmax \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_262
    ],
    [
      /^Biggest Lever — Cardiovascular Stimulus: the race peaked at (\d+)% of HRmax \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_263
    ],
    [
      /^Biggest Lever — Autonomic Recovery: heart rate fell slowly between reps \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_264
    ],
    [
      /^Biggest Lever — Race Pacing Execution: opening pace discipline was the biggest cost \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_265
    ],
    [
      /^Biggest Lever — Race Finish Execution: the second half slowed noticeably \((\d+) of (\d+) points lost\)\..*$/,
      copy.legacy_266
    ]
  ];

  for (const [pattern, replacement] of rules) {
    if (pattern.test(advice)) {
      return typeof replacement === 'string'
        ? advice.replace(pattern, replacement)
        : advice.replace(pattern, replacement);
    }
  }

  return advice;
}

export function translateCalibrationNote(note: string, _lang?: string): string {
  return note;
}

export function translateActivityName(name: string, lang?: string, copy: Record<string, string> = zh.browse.coachLegacyTemplates): string {
  if (lang !== 'zh' || !name) return name;
  const knownNames: Record<string, string> = {
    'long run': copy.legacy_267,
    'endurance long run': copy.legacy_268,
    'long-distance endurance run (lsd)': copy.legacy_268,
    'long distance endurance run (lsd)': copy.legacy_268,
    'easy base': copy.legacy_269,
    'easy aerobic base': copy.legacy_269,
    'threshold': copy.legacy_270,
    'lactate threshold (lt2)': copy.legacy_271,
    'vo2 max intervals': copy.legacy_272,
    'recovery jog': copy.legacy_273
  };
  return knownNames[name.trim().toLowerCase()] ?? name;
}
