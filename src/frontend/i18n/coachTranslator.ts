/**
 * Physiological Coach AI Translation Service
 * Translates AI-generated coach headlines, key insights, recommendations, and execution score rubric factors into Chinese.
 */

export function translateCoachHeadline(headline: string, lang: string): string {
  if (lang !== 'zh' || !headline) return headline;

  const mapping: Record<string, string> = {
    'Low-Stress Active Recovery Jog': '低负荷主动恢复慢跑',
    'Near-Perfect Aerobic Base Execution': '近乎完美的有氧基础执行',
    'Productive Zone 2 Aerobic Foundation': '高效的2区有氧基础训练',
    'High-Quality Lactate Clearance Stimulus': '高质量乳酸清除刺激',
    'Masterful VO2 Max Interval Execution': '出色的最大摄氧量(VO2 Max)间歇执行',
    'Sharp High-Velocity Neuromuscular Stimulus': '敏锐的高速神经肌肉刺激',
    'Unintentional Tempo / Drifted Aerobic Run': '无意提速节奏跑 / 漂移的有氧跑',
    'Incomplete / Aborted Quality Session': '未完成 / 提前终止的质量训练',
    'All-Out Benchmark / Masterful Race Execution': '全力基准测试 / 完美的比赛执行',
    'All-Out Benchmark Effort (Erratic Pacing)': '全力基准测试（配速波动）',
    'Strong Aerobic Adaptation Session': '高效有氧适应训练'
  };

  return mapping[headline.trim()] || headline;
}

export function translateCoachRecommendation(recommendation: string, lang: string): string {
  if (lang !== 'zh' || !recommendation) return recommendation;

  if (recommendation.includes('Superb discipline keeping heart rate low and muscle tissue unstressed')) {
    return '保持低心率且肌肉组织无压力的优秀自律性。已准备好迎接下一个计划中的质量训练日。';
  }
  if (recommendation.includes('Maintain easy efforts at this heart rate cap')) {
    return '保持在此心率上限内的轻松跑，以强化线粒体密度。';
  }
  if (recommendation.includes('Your aerobic system is absorbing current volume smoothly')) {
    return '您的有氧系统正在平稳吸收当前的跑量。已准备好进行渐进节奏跑或乳酸阈值刺激。';
  }
  if (recommendation.includes('Allow 48 hours of recovery or easy aerobic jogging')) {
    return '在下一个高质量间歇日之前，请安排48小时的恢复或轻松有氧慢跑。';
  }
  if (recommendation.includes('Focus on leg recovery and adequate protein intake')) {
    return '注重腿部恢复并补充充足蛋白质，以重建快肌纤维。';
  }
  if (recommendation.includes('slow your initial kilometer pace by 15-20 sec/km')) {
    return recommendation.replace(
      /If an Easy recovery was intended, slow your initial kilometer pace by 15-20 sec\/km to keep heart rate firmly under your LT1 ceiling \((\d+) bpm\)\./i,
      '若本次目标为轻松恢复跑，请将前几公里配速放慢15-20秒/公里，使心率稳定控制在LT1上限（$1 bpm）以下。'
    );
  }
  if (recommendation.includes('Assess underlying fatigue, heat stress, or nutrition')) {
    return '评估潜在疲劳、热负荷应激或营养状态。在尝试下一次质量训练前请先安排一次恢复日。';
  }
  if (recommendation.includes('Prioritize complete replenishment, deep sleep, and gentle recovery jogging')) {
    return '非凡的竞技发挥。接下来的48-72小时内请优先保证全面营养补给、深度睡眠与轻柔的主动恢复慢跑。';
  }
  if (recommendation.includes('target an even or slight negative split')) {
    return '值得赞许的全力以赴。在下次基准测试中，争取保持均速或轻微的后程加速（负分段），以避免过早乳酸堆积。';
  }
  if (recommendation.includes('Prioritize light hydration and low-impact movement')) {
    return '在下一次高强度训练前，优先进行适当补水与低冲击活动。';
  }

  return recommendation;
}

export function translateCoachInsight(insight: string, lang: string): string {
  if (lang !== 'zh' || !insight) return insight;

  // 1. Traffic & Walk Break Isolation
  if (insight.startsWith('Traffic & Walk Break Isolation:')) {
    // Traffic & Walk Break Isolation: Removed 9 stationary/traffic stops (5m 46s idle) and 2 walk breaks (19s, 5m) from steady-state analysis. Your true running pace averaged 6:27/km at 133 bpm (178 spm), preventing pause distortion.
    return insight
      .replace('Traffic & Walk Break Isolation: Removed ', '交通与步行中断过滤：已从稳态分析中剔除 ')
      .replace('stationary/traffic stops', '处交通/红绿灯停顿')
      .replace('stationary/traffic stop', '处交通/红绿灯停顿')
      .replace('walk breaks', '次步行过渡')
      .replace('walk break', '次步行过渡')
      .replace('idle', '静止')
      .replace('from steady-state analysis. Your true running pace averaged ', '。您的真实跑步配速平均为 ')
      .replace(' at ', '，平均心率 ')
      .replace('preventing pause distortion.', '消除了停顿失真。');
  }

  // 2. Aerobic Decoupling: Superb cardiovascular stability
  if (insight.includes('Superb cardiovascular stability with only')) {
    return insight.replace(
      /Superb cardiovascular stability with only ([\d.]+)% drift\. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue\./,
      '心血管稳定性极佳，漂移仅 $1%。毛细血管有氧基础高效运作，后程无心血管疲劳。'
    );
  }

  // 3. Aerobic Decoupling: Solid aerobic discipline
  if (insight.includes('Solid aerobic discipline. Decoupling was')) {
    return insight.replace(
      /Solid aerobic discipline\. Decoupling was ([\d.]+)(?:%)?, well within the sub-LT1 gold standard threshold \(<5%\)\./,
      '扎实的有氧自律性。有氧脱耦仅为 $1%，完全处于LT1以下的黄金标准门槛（<5%）。'
    );
  }

  // 4. Aerobic Decoupling: Noticeable cardiac drift detected
  if (insight.includes('Noticeable cardiac drift detected')) {
    return insight
      .replace('Noticeable cardiac drift detected (', '检测到明显的心血管漂移（')
      .replace('). Likely due to thermal strain', '）。可能是由于热负荷应激')
      .replace(', dehydration, or pacing slightly ahead of current aerobic capacity.', '、脱水或配速略微超出当前有氧能力所致。');
  }

  // 5. Cadence: Sweet spot
  if (insight.includes('Cadence was right in the sweet spot')) {
    return insight.replace(
      /Cadence was right in the sweet spot \((\d+) spm\), minimizing vertical braking forces and maximizing elastic recoil\./,
      '步频处于最佳甜点区（$1 spm），最大程度减少了垂直制动力并放大了弹性势能反馈。'
    );
  }

  // 6. Cadence: High turnover
  if (insight.includes('High turnover') && insight.includes('maintained during steady running')) {
    return insight.replace(
      /High turnover \((\d+) spm\) maintained during steady running, promoting quick foot turnover\./,
      '稳态跑步过程中保持了敏捷的高步频（$1 spm），有助于加快足部离地运转。'
    );
  }

  // 7. Cadence: Low turnover
  if (insight.includes('Steady running cadence averaged') && insight.includes('Increasing turnover toward 170-180 spm')) {
    return insight.replace(
      /Steady running cadence averaged (\d+) spm\. Increasing turnover toward 170-180 spm will decrease ground contact time and reduce joint impact\./,
      '稳态跑步平均步频为 $1 spm。将步频提高至170-180 spm可缩短触地时间并减少关节冲击。'
    );
  }

  // 8. Running dynamics: Swift ground reaction
  if (insight.includes('Swift ground reaction:')) {
    return insight.replace(
      /Swift ground reaction: (\d+) ms stance time demonstrates crisp ground clearance and leg spring stiffness\./,
      '敏捷的地面反作用力：$1 ms 的触地时间体现了干脆利落的离地效率与良好的腿部弹簧刚度。'
    );
  }

  // 9. Microclimate Weather
  if (insight.startsWith('Microclimate Weather:')) {
    let res = insight.replace('Microclimate Weather:', '微气候环境：');
    res = res.replace('ambient', '环境');
    res = res.replace('Overcast', '阴天');
    res = res.replace('Clear', '晴朗');
    res = res.replace('Rain', '下雨');
    res = res.replace('Partly Cloudy', '多云');
    res = res.replace('with', '相对湿度');
    res = res.replace('humidity', '');
    res = res.replace('feels like', '体感');
    res = res.replace('Garmin watch sensor:', 'Garmin 手表传感器:');
    res = res.replace('High tropical humidity restricts evaporative cooling and directly explains elevated cardiac drift.', '热带高湿度限制了汗液蒸发散热，直接解释了心血管漂移升高的现象。');
    res = res.replace('Microclimate weather verified from local meteorological reanalysis.', '微气候天气已通过本地气象再分析数据验证。');
    return res;
  }

  // 10. Hot conditions fallback
  if (insight.includes('Executed in hot conditions')) {
    return insight.replace(
      /Executed in hot conditions \((\d+)°C\)\. In high heat, heart rate naturally drifts 4-8 bpm higher; effective aerobic pacing was maintained despite the thermal burden\./,
      '在高温环境（$1°C）下完成。在炎热条件下心率会自然上升4-8 bpm；顶住热负荷依然保持了有效的有氧配速。'
    );
  }

  // 11. Elevation & Ramps
  if (insight.startsWith('Elevation & Ramps:')) {
    return insight.replace(
      /Elevation & Ramps: Gained \+(\d+)m ascent\. Uphill grade segments and ramp walks were isolated to keep your flat-ground running economy unskewed\./,
      '爬升与坡道：累计爬升 +$1 米。已将上坡路段与坡道步行单独剔除，以确保平路跑步经济性不受干扰。'
    );
  }

  // 12. Pacing Alert: Accidental tempo
  if (insight.startsWith('Pacing Alert:')) {
    return insight.replace(
      /Pacing Alert: Heart rate drifted notably higher than pure Zone 2 \((\d+) bpm avg\)\. This functioned as an unintentional 'grey-zone' tempo effort rather than a low-stress aerobic recovery session\./,
      '配速警报：心率显著漂移超出了纯2区上限（平均 $1 bpm）。本次训练实际演变成了无意的“灰色地带”节奏跑，而非低负荷有氧恢复课。'
    );
  }

  // 13. Interval reps: Laser precision
  if (insight.includes('Exceptional Rep Consistency:')) {
    return insight.replace(
      /Exceptional Rep Consistency: Executed (\d+) work reps with laser precision \(([\d.]+)% duration variance, ±(\d+)s spread\)\. Zero early overshoot or late-rep collapse\./,
      '单趟间歇一致性极高：执行了 $1 个间歇片段，用时方差仅 $2%（离散幅度 ±$3 秒）。没有前期盲目冲速或后期体力崩溃。'
    );
  }

  // 14. Interval reps: Disciplined Interval Structure
  if (insight.includes('Disciplined Interval Structure:')) {
    return insight.replace(
      /Disciplined Interval Structure: Held (\d+) work reps consistently \(([\d.]+)% duration variance\)\./,
      '严谨的间歇结构：稳定完成了 $1 个间歇片段（用时方差 $2%）。'
    );
  }

  // 15. Interval reps: Rep Variance Warning
  if (insight.includes('Rep Variance Warning:')) {
    return insight.replace(
      /Rep Variance Warning: High duration variance across reps \(([\d.]+)%\)\. Focus on even rep durations to keep the stimulus consistent across the entire set\./,
      '间歇波动预警：单趟用时波动较大（方差 $1%）。建议专注于更平稳的单趟节奏，以确保整组刺激的一致性。'
    );
  }

  // 16. Target VO2 Stimulus Achieved
  if (insight.includes('Target VO2 Stimulus Achieved:')) {
    return insight.replace(
      /Target VO2 Stimulus Achieved: Heart rate peaked at (\d+) bpm \(([\d.]+)% HRmax\), successfully stimulating maximal oxygen uptake and cardiac stroke volume adaptations\./,
      '达成目标VO2刺激：心率峰值达到 $1 bpm（占最大心率 $2%），成功激发了最大摄氧量与心脏搏出量的有氧适应。'
    );
  }

  // 17. Aborted workout
  if (insight.includes('Incomplete / Aborted Quality Effort:')) {
    return '⚠️ 未完成 / 提前中止的质量训练：目标间歇跑量缩水或后程配速崩塌。在下一次大强度课表前请重新评估身体疲劳度。';
  }

  return insight;
}

export function translateScoreCategory(cat: string, lang: string): string {
  if (lang !== 'zh' || !cat) return cat;
  const map: Record<string, string> = {
    'Base Execution': '基础执行',
    'Aerobic Decoupling': '有氧脱耦',
    'Running Turnover': '步频运转',
    'Interval Execution': '间歇执行',
    'Cardiovascular Stimulus': '心血管刺激',
    'Autonomic Recovery': '自主神经恢复',
    'Pacing Discipline': '配速自律',
    'Workout Completion': '课表完成度'
  };
  return map[cat] || cat;
}

export function translateScoreLabel(label: string, lang: string): string {
  if (lang !== 'zh' || !label) return label;
  const map: Record<string, string> = {
    'Standard Quality Baseline': '标准质量基准',
    'Superb Cardiovascular Stability': '极佳心血管稳定性',
    'Solid Sub-LT1 Aerobic Base': '扎实的基础有氧 (sub-LT1)',
    'Elevated Cardiac Drift / Thermal Strain': '心率漂移过高 / 热负荷过大',
    'Optimal Cadence Sweet Spot': '最佳步频甜点区',
    'Sub-Optimal Cadence Turnover': '步频运转偏慢',
    'Laser Rep Consistency': '极高单趟一致性',
    'Disciplined Interval Structure': '严谨的间歇结构',
    'High Rep Variance Across Set': '整组间歇波动较大',
    'Target VO2 Stimulus Achieved': '达成目标VO2刺激',
    'Rapid Cardiovascular Recovery Drop': '间歇心率回落迅速',
    'Unintentional Tempo Pacing Alert': '无意提速警报',
    'Aborted / Incomplete Quality Workout': '提前中止 / 未达标课表'
  };
  return map[label] || label;
}

export function translateCalibrationNote(note: string, _lang?: string): string {
  return note;
}

export function translateActivityName(name: string, _lang?: string): string {
  return name;
}

