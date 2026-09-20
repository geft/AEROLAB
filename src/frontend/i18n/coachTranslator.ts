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
    'Strong Aerobic Adaptation Session': '高效有氧适应训练',
    'Threshold Stimulus with Compromised Execution': '阈值刺激达成但执行质量不足'
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
    if (insight.includes('at or inside the')) {
      return insight.replace(
        /Superb cardiovascular stability with only ([\d.]+)% drift, at or inside the ([\d.]+)% target that (.+?) predict\..*/,
        '心血管稳定性极佳，漂移仅 $1%，已达到甚至优于 $3 应有的 $2% 目标。毛细血管有氧基础高效运作，后程无心血管疲劳。'
      );
    }
    return insight.replace(
      /Superb cardiovascular stability with only ([\d.]+)% drift\. Your aerobic capillary base is working efficiently with zero late-run cardiac fatigue\./,
      '心血管稳定性极佳，漂移仅 $1%。毛细血管有氧基础高效运作，后程无心血管疲劳。'
    );
  }

  // 3. Aerobic Decoupling: Solid aerobic discipline
  if (insight.includes('Solid aerobic discipline. Decoupling was')) {
    if (insight.includes('working target')) {
      return insight.replace(
        /Solid aerobic discipline\. Decoupling was ([\d.]+)%, just above the ([\d.]+)% working target for (.+?) but well within .*/,
        '扎实的有氧自律性。有氧脱耦为 $1%，略高于 $3 的 $2% 目标，但仍完全处于LT1以下的黄金标准门槛（<5%）。'
      );
    }
    return insight.replace(
      /Solid aerobic discipline\. Decoupling was ([\d.]+)(?:%)?, well within the sub-LT1 gold standard threshold \(<5%\)\./,
      '扎实的有氧自律性。有氧脱耦仅为 $1%，完全处于LT1以下的黄金标准门槛（<5%）。'
    );
  }

  // 4. Aerobic Decoupling: Noticeable cardiac drift detected
  if (insight.includes('Noticeable cardiac drift detected')) {
    if (insight.includes('against a')) {
      return insight.replace(
        /Noticeable cardiac drift detected \(([\d.]+)% against a ([\d.]+)% target for (.+?)\)\. Likely due to thermal strain(?: \(([\d.]+)°C\))?, dehydration, or pacing slightly ahead of current aerobic capacity\./,
        (_m, drift, target, conditions, temp) =>
          `检测到明显的心血管漂移（${drift}%，而 ${conditions} 的目标为 ${target}%）${temp ? `。当前气温 ${temp}°C，` : '。'}可能是由于热负荷应激、脱水或配速略微超出当前有氧能力所致。`
      );
    }
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

  // 18. Set shape: what was actually being graded
  if (insight.startsWith('Session Drift:')) {
    if (insight.includes('ran as a VO2 session')) {
      return insight.replace(
        /^Session Drift: work reps (peaked at|averaged) (\d+) bpm against your (\d+) bpm LT2 anchor — (\d+) bpm above it.*$/,
        (_m, mode, hr, anchor, over) =>
          `课表漂移：间歇${mode === 'peaked at' ? '峰值心率' : '平均心率'}为 ${hr} bpm，而你的 LT2 锚点为 ${anchor} bpm——高出 ${over} bpm，本次实际上跑成了 VO2 课，而不是阈值课。这是不同的刺激，并不代表更好：要么把它标记为 intervals_vo2，要么放慢配速让每组回到阈值锚点。`
      );
    }
    return insight.replace(
      /^Session Drift: work reps averaged (\d+) bpm, (\d+) bpm below your (\d+) bpm LT2 anchor.*$/,
      '课表漂移：间歇平均心率仅 $1 bpm，比你的 LT2 锚点 $3 bpm 低 $2 bpm，未达到阈值刺激。建议适当提速或缩短恢复时间。'
    );
  }

  if (insight.startsWith('Set Profile:')) {
    return insight.replace(
      /^Set Profile: (\d+) x (.+?) work(?: with (.+?) recoveries)? — (.+?) of total work time.*$/,
      (_m, reps, repDuration, recovery, totalWork) =>
        `课表结构：${reps} x ${repDuration} 跑量${recovery ? `，恢复 ${recovery}` : ''} —— 总跑动时间 ${totalWork}，评分按该时长允许的波动范围计算。`
    );
  }

  // 19. Aerobic intensity: the one thing an easy run is graded on
  if (insight.startsWith('Zone 2 Ceiling Held, High-Zone-2 Creep:')) {
    return insight.replace(
      /^Zone 2 Ceiling Held, High-Zone-2 Creep: you never crossed the (\d+) bpm LT1 ceiling, but ([\d.]+)% of your running time sat in the top of Zone 2 \(([\d-]+) bpm\), rising to (\d+)% in the second half\..*$/,
      (_m, lt1, zone2, band, late) =>
        `守住上限，但停留在 2 区上部：你从未超过 ${lt1} bpm 的 LT1 上限，但有 ${zone2}% 的跑动时间停留在 2 区上部（${band} bpm），后半程升至 ${late}%。这仍属有氧训练，在高温下后半程的漂移多由天气造成；但贴近上限跑会增加恢复成本——把前几公里放慢，让全程更接近 ${Number(lt1) - 10} bpm。`
    );
  }

  if (insight.startsWith('Recovery Intent:')) {
    return insight.replace(
      /^Recovery Intent: (\d+) recoveries averaged (\d+)s, dropping heart rate (\d+) bpm \((\d+) bpm\/min\)\..*$/,
      '恢复意图：$1 次恢复平均 $2 秒，心率下降 $3 bpm（$4 bpm/分钟）。较短的恢复有意让心率维持在阈值附近，以增加处在目标区间的时间，因此这里不评价下降幅度，而是评价每组是否保持了配速与心率。'
    );
  }

  if (insight.startsWith('Recovery Rate:')) {
    if (insight.includes('slow even for recoveries')) {
      return insight.replace(
        /^Recovery Rate: (\d+) recoveries averaged (\d+)s with a (\d+) bpm drop \((\d+) bpm\/min\), which is slow even for recoveries of that length\..*$/,
        '恢复速率：$1 次恢复平均 $2 秒，心率仅下降 $3 bpm（$4 bpm/分钟），即使按该恢复时长来看也偏慢。建议检查补给，并确认每组是否超出了目标强度。'
      );
    }
    return insight.replace(
      /^Recovery Rate: (\d+) recoveries averaged (\d+)s with a (\d+) bpm drop \((\d+) bpm\/min\), a healthy decay for that recovery length\.$/,
      '恢复速率：$1 次恢复平均 $2 秒，心率下降 $3 bpm（$4 bpm/分钟），对该恢复时长而言属于健康回落。'
    );
  }

  if (insight.startsWith('Aerobic Intensity Discipline:')) {
    return insight.replace(
      /^Aerobic Intensity Discipline: only ([\d.]+)% of your running time sat above the (\d+) bpm LT1 ceiling \(([\d.]+)% of it in the first half\), so this stayed an aerobic session throughout\..*$/,
      '有氧强度纪律：跑动时间中仅 $1% 超过 $2 bpm 的 LT1 上限（其中 $3% 出现在前半程），因此全程都保持在有氧区间。这种控制——而不是配速——正是轻松跑的目的。'
    );
  }

  if (insight.startsWith('Grey-Zone Creep:')) {
    return insight.replace(
      /^Grey-Zone Creep: ([\d.]+)% of running time was above your (\d+) bpm LT1 ceiling \(([\d.]+)% of it in the first half\)\..*$/,
      '灰色地带渗透：有 $1% 的跑动时间超过 $2 bpm 的 LT1 上限（其中 $3% 出现在前半程）。少量尚可接受，但轻松跑的价值来自始终低于该上限。'
    );
  }

  if (insight.startsWith('Over-Intensity:')) {
    return insight.replace(
      /^Over-Intensity: ([\d.]+)% of your running time sat above the (\d+) bpm LT1 ceiling, with ([\d.]+)% of it in the first half\..*$/,
      '强度超标：有 $1% 的跑动时间超过 $2 bpm 的 LT1 上限，其中 $3% 出现在前半程。这实际上是一次披着轻松跑外衣的节奏跑，只消耗恢复能力，并不增加有氧跑量。'
    );
  }

  // 19. Walk breaks: classified by why they happened (never moralised)
  if (insight.startsWith('Pacing Discipline: your running pace held within')) {
    return insight.replace(
      /^Pacing Discipline: your running pace held within ±(\d+)s per kilometre across (\d+) running km(?:, (?:(?:with )?a steady ([\d.]+)s\/km slowdown|progressively ([\d.]+)s\/km faster) through the run)?\. The (\d+) km that contained stops, junctions or walk breaks were measured on running time only, so navigating the city did not count against you\.$/,
      (_m, spread, km, slowdown, faster, affected) =>
        `配速纪律：在 ${km} 个实际跑动的公里中，你的配速波动仅为 ±${spread} 秒/公里${slowdown ? `，全程稳定放慢 ${slowdown} 秒/公里` : ''}${faster ? `，全程逐步加快 ${faster} 秒/公里` : ''}。其中 ${affected} 个公里包含停顿、路口或步行休息，已按净跑动时间计算，因此城市路况不会被计入配速问题。`
    );
  }

  if (insight.startsWith('Interval-Break Walking:')) {
    return insight.replace(
      /^Interval-Break Walking: (\d+)s of walking across (\d+) breaks fell inside your prescribed recovery windows\..*/,
      '组间休息步行：有 $1 秒步行（共 $2 次）发生在既定恢复区间内。这属于课表设计的一部分，因此不计为训练缺失。'
    );
  }

  if (insight.startsWith('Turnaround Dips:')) {
    return insight.replace(
      /^Turnaround Dips: (\d+) brief cadence dips \(up to (\d+)s total, barely any ground covered\) were ignored.*/,
      '折返点降频：$1 次极短暂的步频下降（合计约 $2 秒，几乎未产生位移）已按折返点处理并忽略，不计为步行休息。'
    );
  }

  if (insight.startsWith('Walk-Break Strategy:')) {
    return insight.replace(
      /^Walk-Break Strategy: (\d+) walk breaks \(([\d.]+)% of moving time(?:, average entry (\d+) bpm)?\) held heart rate under your (\d+) bpm LT1 ceiling(?:, peaking at (\d+) bpm)?\..*/,
      (_m, count, pct, entryHr, lt1, peakHr) =>
        `步行休息策略：共 ${count} 次步行休息（占运动时间 ${pct}%${entryHr ? `，平均进入心率 ${entryHr} bpm` : ''}），将心率稳定控制在 LT1 上限 ${lt1} bpm 以下${peakHr ? `，最高仅 ${peakHr} bpm` : ''}。这是心率上限纪律，而不是训练时间的损失。`
    );
  }

  if (insight.startsWith('Work-Rep Interruption:')) {
    return insight.replace(
      /^Work-Rep Interruption: (\d+)s of walking began inside work reps at an average of ([^\s]+) bpm \(at or above LT1\)\..*/,
      '间歇内步行：有 $1 秒的步行发生在间歇片段之中，平均进入心率 $2 bpm（已达到或超过 LT1）。在该心率下步行是正确选择，因此应从源头调整：第一组放慢配速，或改在不易被打断的路段完成。'
    );
  }

  if (insight.startsWith('Unplanned Walking:')) {
    return insight.replace(
      /^Unplanned Walking: (\d+)s of mid-run walking started at about ([^\s]+) bpm.*/,
      '计划外步行：途中有 $1 秒步行在约 $2 bpm 时开始——此时心率已低于有氧区间，且并非上坡所致。建议检查补给、睡眠与负荷，或确认是否是路线本身频繁迫使停步。'
    );
  }

  // 19. Personal-baseline context (athlete's own recent history)
  if (insight.startsWith('Training Load Context:')) {
    if (insight.includes('high-risk spike')) {
      return insight.replace(
        /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average — a high-risk spike\..*/,
        '训练负荷背景：近7天负荷为28天周均值的 $1 倍，属于高风险激增。今天的配速下降或心率偏高反映的是累积疲劳，而非体能退步，接下来3天请保持真正的轻松训练。'
      );
    }
    if (insight.includes('ramping fast')) {
      return insight.replace(
        /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average and ramping fast\..*/,
        '训练负荷背景：近7天负荷已达28天周均值的 $1 倍且上升较快。在本周期被身体吸收之前，轻松跑的同等配速会伴随更高心率。'
      );
    }
    if (insight.includes('deload window')) {
      return insight.replace(
        /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average — a deload window\..*/,
        '训练负荷背景：近7天负荷仅为28天周均值的 $1 倍，属于减量周。恢复充分解释了同等心率下配速更快。'
      );
    }
    return insight.replace(
      /Training Load Context: your 7-day load is ([\d.]+)x your 28-day weekly average, inside the productive 0\.8-1\.3 tunnel.*/,
      '训练负荷背景：近7天负荷为28天周均值的 $1 倍，处于 0.8-1.3 的高效区间，本次训练被正常吸收。'
    );
  }

  if (insight.startsWith('Personal Baseline:')) {
    if (insight.includes('a real aerobic gain')) {
      return insight.replace(
        /Personal Baseline: running economy reached ([\d.]+) EF \+ ([\d.]+)%, above your 28-day median across (\d+) comparable runs.*/,
        '个人基准对比：跑姿经济性达到 $1 EF（+$2%），高于你在 $3 次可比训练中的28天中位数——这是真实的有氧能力提升，而非单日波动。'
      );
    }
    return insight.replace(
      /Personal Baseline: running economy came in ([\d.]+)% below your 28-day median of ([\d.]+) EF\..*/,
      '个人基准对比：跑姿经济性比你的28天中位数 $2 EF 低 $1%。单次训练属于正常波动，但连续两次通常意味着疲劳累积。'
    );
  }

  if (insight.startsWith('Pace-Specific Cost:')) {
    if (insight.includes('less')) {
      return insight.replace(
        /Pace-Specific Cost: (\S+) usually costs you (\d+) bpm across (\d+) comparable runs; today you paid (\d+) bpm less.*/,
        '同配速心率成本：$1 通常需要 $2 bpm（基于 $3 次可比训练），今天少了 $4 bpm，说明有氧引擎确实变强了。'
      );
    }
    return insight.replace(
      /Pace-Specific Cost: (\S+) usually costs you (\d+) bpm across (\d+) comparable runs; today it cost (\d+) bpm more.*/,
      '同配速心率成本：$1 通常需要 $2 bpm（基于 $3 次可比训练），今天多了 $4 bpm，说明限制因素来自高温、补给或累积疲劳，而不是体能。'
    );
  }

  if (insight.startsWith('Relative Standing:')) {
    if (insight.includes('most stable')) {
      return insight.replace(
        /Relative Standing: this was your most stable aerobic session across the last (\d+) comparable runs\./,
        '历史相对位置：在最近 $1 次可比训练中，这是你心率最稳定的一次有氧课。'
      );
    }
    if (insight.includes('(best ')) {
      return insight.replace(
        /Relative Standing: aerobic stability ranks (\d+) of your last (\d+) comparable runs \(best ([\d.]+)% drift\)\./,
        '历史相对位置：有氧稳定性在最近 $2 次可比训练中排名第 $1（最佳漂移为 $3%）。'
      );
    }
    return insight.replace(
      /Relative Standing: aerobic stability ranks (\d+) of your last (\d+) comparable runs\./,
      '历史相对位置：有氧稳定性在最近 $2 次可比训练中排名第 $1。'
    );
  }

  if (insight.startsWith('Volume Milestone:')) {
    return insight.replace(
      /Volume Milestone: at ([\d.]+) km this is your longest comparable run in the last (\d+) days.*/,
      '跑量里程碑：距离达到 $1 公里，是最近 $2 天里最长的一次同类训练，进一步抬高了耐力上限。'
    );
  }

  if (insight.startsWith('Rubric Coverage:')) {
    return insight.replace(
      /Rubric Coverage: (\d+)% of the grading rubric was measurable.*/,
      '评分覆盖率：本次仅 $1% 的评分指标可被测量，因此执行度分数只基于实际采集到的信号。'
    );
  }

  return insight;
}

export function translateScoreCategory(cat: string, lang: string): string {
  if (lang !== 'zh' || !cat) return cat;
  const map: Record<string, string> = {
    'Base Execution': '基础执行',
    'Aerobic Decoupling': '有氧脱耦',
    'Aerobic Intensity': '有氧强度',
    'Running Turnover': '步频运转',
    'Interval Execution': '间歇执行',
    'Rep-to-Rep Fatigue': '组内疲劳衰减',
    'Cardiovascular Stimulus': '心血管刺激',
    'Autonomic Recovery': '自主神经恢复',
    'Pacing Discipline': '配速自律',
    'Pacing Consistency': '配速一致性',
    'Race Pacing Execution': '比赛配速执行',
    'Race Finish Execution': '比赛后程执行',
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
    'Textbook Aerobic Discipline': '教科书级有氧自律',
    'Disciplined Aerobic Ceiling': '严格遵守有氧心率上限',
    'Drifting Into High Zone 2': '漂移至 2 区上部',
    'Extended Above the LT1 Ceiling': '长时间超过 LT1 上限',
    'Substantially Walked Session': '步行比例明显偏高',
    'Walk-Dominated Session': '以步行为主的训练',
    'Mostly Aerobic, Slightly Hot': '基本有氧但心率偏高',
    'Grey-Zone Drift Above LT1': '漂移至 LT1 以上的灰色地带',
    'Optimal Cadence Sweet Spot': '最佳步频甜点区',
    'Adequate Turnover': '步频尚可',
    'Sub-Optimal Cadence Turnover': '步频运转偏慢',
    'Metronomic Split Consistency': '如节拍器般稳定的分段配速',
    'Minor Split Variance': '分段配速略有波动',
    'Erratic Split Pacing': '分段配速波动明显',
    'Unbroken Session': '全程连贯无中断',
    'Deliberate Walk-Break Strategy': '计划性的步行休息策略',
    'Minor Break Time': '轻微中断时间',
    'Heavily Interrupted Session': '中断时间偏多',
    'Rep-Interrupting Walk Breaks': '间歇内出现步行休息',
    'Walk Breaks Inside the Race Effort': '比赛中段出现步行休息',
    'Laser Rep Consistency': '极高单趟一致性',
    'Held Rep Pace to the End': '末组仍保持原配速',
    'Held Rep Pace and HR to the End': '末组配速与心率均保持稳定',
    'Slight Late-Rep Fade': '后段单趟略有衰减',
    'Late-Rep Pace Collapse': '后段单趟配速崩塌',
    'Late-Rep Collapse': '后段单趟崩塌',
    'Disciplined Interval Structure': '严谨的间歇结构',
    'High Rep Variance Across Set': '整组间歇波动较大',
    'Target VO2 Stimulus Achieved': '达成目标VO2刺激',
    'Partial Cardiovascular Stimulus': '心血管刺激仅部分达成',
    'Insufficient Cardiovascular Stimulus': '心血管刺激不足',
    'Rapid Cardiovascular Recovery Drop': '间歇心率回落迅速',
    'Normal Recovery Kinetics': '恢复动力学正常',
    'Blunted Recovery Response': '恢复反应迟钝',
    'On-Target Intensity Control': '强度控制精准',
    'Drifted Into VO2 Territory': '漂移至 VO2 强度区间',
    'Grey-Zone Intensity Drift': '强度漂移至灰色地带',
    'Overreaching Intensity': '强度过高',
    'Aggressive Early Surge / Positive Split': '前段过快 / 正分段',
    'Laser Race Pacing Discipline': '比赛配速极其严谨',
    'Controlled Race Pacing': '比赛配速控制良好',
    'Volatile Split Pacing': '分段配速波动大',
    'Strong Negative-Split Finish': '后程加速（负分段）',
    'Held Form to the Line': '后程保持稳定',
    'Late-Race Fade': '后程掉速',
    'Full Race-Day Heart Rate Utilisation': '比赛日心率充分利用',
    'Partial Race-Day Effort': '比赛日发挥不完全',
    'Conservative Heart Rate Ceiling': '心率上限保守',
    'Unintentional Tempo Pacing Alert': '无意提速警报',
    'Aborted / Incomplete Quality Workout': '提前中止 / 未达标课表'
  };
  return map[label] || label;
}

/**
 * Score-factor descriptions carry the measured statistic behind each rubric
 * line (drift %, cadence, split variance, ...). Canonical templates keep this
 * mapping to one rule per metric.
 */
export function translateScoreDescription(description: string, lang: string): string {
  if (lang !== 'zh' || !description) return description;

  const rules: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [/^([\d.]+)% cardiac drift \(([\d.]+)% or lower earns full marks\)$/, '$1% 心率漂移（≤$2% 可获满分）'],
    [
      /^([\d.]+)% above the (\d+) bpm LT1 ceiling \(first half: ([\d.]+)%\) · ([\d.]+)% in the top of Zone 2 \(([\d-]+) bpm\)$/,
      '$2 bpm 的 LT1 上限中超限 $1%（前半程 $3%）· $4% 位于 2 区上部（$5 bpm）'
    ],
    [
      /^([\d.]+)% in the top of Zone 2 \(([\d-]+) bpm\) · ([\d.]+)% above the (\d+) bpm LT1 ceiling · rising to (\d+)% in the second half$/,
      '$1% 位于 2 区上部（$2 bpm）· $3% 超过 $4 bpm 的 LT1 上限 · 后半程升至 $5%'
    ],
    [/^([\d.]+)% cardiac drift against a ([\d.]+)% target for (\d+)°C over (\d+) min$/, '$1% 心率漂移（$3°C / $4 分钟条件下目标为 $2%）'],
    [/^(\d+) bpm average against a (\d+) bpm LT1 ceiling \(average only — no per-second telemetry\)$/, '平均心率 $1 bpm，对比 LT1 上限 $2 bpm（仅有平均值——无逐秒采样数据）'],
    [/^([\d.]+)% of moving time in walk breaks \(up to 45% is free on easy sessions\)$/, '运动时间中 $1% 为步行休息（轻松跑中不超过 45% 不扣分）'],
    [/^([\d.]+)% variance \(±(\d+)s\) across (\d+) running km([^;]*?)(?:; (\d+) km had stops or junctions, measured on running time only)?$/, (_m, cv, spread, km, extra, affected) => `${km} 个实际跑动公里内配速波动 ${cv}%（±${spread} 秒）${String(extra).includes('hill-adjusted') ? '，已做坡度修正' : ''}${String(extra).includes('slowing') ? '，全程稳定放慢' : String(extra).includes('progressing') ? '，全程逐步加快' : ''}${affected ? `；其中 ${affected} 个公里含停顿或路口，已按净跑动时间计算` : ''}`],
    [/^([\d.]+)% variance \(±(\d+)s\) across (\d+) raw km splits \(no per-second telemetry\)([^;]*)$/, (_m, cv, spread, km, extra) => `${km} 个原始分段配速波动 ${cv}%（±${spread} 秒）${String(extra).includes('slowing') ? '，全程稳定放慢' : String(extra).includes('progressing') ? '，全程逐步加快' : ''}（无逐秒采样数据）`],
    [/^([\d.]+)% of moving time paused or walking \((\d+)% or less earns full marks\)$/, '运动时间中 $1% 为停顿或步行（≤$2% 可获满分）'],
    [/^([\d.]+)% of moving time in walk breaks \((\d+)% or less earns full marks; traffic stops are excluded\)$/, '运动时间中 $1% 为步行休息（≤$2% 可获满分；红绿灯停顿不计入）'],
    [/^([\d.]+)% of moving time in walk breaks \(races rarely need them\)$/, '运动时间中 $1% 为步行休息（比赛中几乎不需要步行）'],
    [/^([\d.]+)% of moving time in walk breaks$/, '运动时间中 $1% 为步行休息'],
    [/^([\d.]+)% of moving time paused or walking$/, '运动时间中 $1% 为停顿或步行'],
    [/^([\d.]+)% duration variance across (\d+) reps \(±(\d+)s spread\)$/, '$2 个间歇片段的用时方差 $1%（离散 ±$3 秒）'],
    [/^(\d+) bpm steady HR against a (\d+) bpm LT1 cap$/, '稳态心率 $1 bpm（LT1 上限 $2 bpm）'],
    [/^(\d+) spm steady cadence · (\d+) ms ground contact$/, '稳态步频 $1 spm · 触地时间 $2 ms'],
    [/^(\d+) spm steady cadence$/, '稳态步频 $1 spm'],
    [/^(\d+) ms ground contact$/, '触地时间 $1 ms'],
    [/^Peaked at (\d+) bpm \((\d+)% HRmax\)$/, '峰值心率 $1 bpm（最大心率的 $2%）'],
    [/^(\d+) bpm average HR drop across (\d+) recoveries$/, '每次恢复平均心率回落 $1 bpm（共 $2 次）'],
    [/^(\d+) bpm average work HR against a (\d+) bpm LT2 anchor$/, '间歇平均心率 $1 bpm（LT2 锚点 $2 bpm）'],
    [/^(\d+) walk breaks · ([\d.]+)% of moving time · (\d+)s not explained by ceiling, gradient or warm-up$/, '$1 次步行休息 · 占运动时间 $2% · 其中 $3 秒无法用心率上限、坡度或热身/冷身解释'],
    [/^(\d+) walk breaks on a planned run\/walk rhythm$/, '$1 次步行休息，呈规律的跑走节奏（计划性策略）'],
    [/^(\d+) walk breaks · ([\d.]+)% of moving time \(gradient, start and cool-down walks are free\)$/, '$1 次步行休息 · 占运动时间 $2%（上下坡、起跑与冷身阶段的步行不扣分）'],
    [/^Last rep (\d+)s\/km slower than the first \(([\d.]+)% fade across (\d+) reps\)$/, '末组比首组慢 $1 秒/公里（$3 个片段整体衰减 $2%）'],
    [/^last rep (\d+)s\/km slower than the first · work HR (\d+) bpm higher by the last rep \(across (\d+) reps\)$/, '末组比首组慢 $1 秒/公里 · 末组平均心率高出 $2 bpm（共 $3 个片段）'],
    [
      /^(?:last rep (\d+)s\/km (slower|faster) than the first)?(?: · )?(?:work HR (\d+) bpm (higher|lower) by the last rep(?: \(not graded: short reps carry HR lag\))?)? \(across (\d+) reps(?:, (\d+)% drift allowed for the set length)?\)$/,
      (_m, paceSec, paceDir, hrBpm, hrDir, reps, drift) => {
        const parts: string[] = [];
        if (paceSec) parts.push(`末组比首组${paceDir === 'slower' ? '慢' : '快'} ${paceSec} 秒/公里`);
        if (hrBpm) parts.push(`末组平均心率${hrDir === 'higher' ? '高出' : '低'} ${hrBpm} bpm`);
        if (!parts.length) return description;
        const lagNote = description.includes('not graded: short reps carry HR lag') ? '，不评分：短间歇存在心率滞后' : '';
        const driftNote = drift ? `，该时长允许 ${drift}% 的漂移` : '';
        return `${parts.join(' · ')}（共 ${reps} 个片段${lagNote}${driftNote}）`;
      }
    ],
    [/^([\d.]+) bpm peak work HR \((\d+)s reps are too short to average to target\) against a (\d+) bpm LT2 anchor$/, '$3 bpm 的 LT2 锚点下，间歇峰值心率 $1 bpm（单趟仅 $2 秒，平均心率无法达到目标）'],
    [/^last rep (\d+)s\/km faster than the first · work HR (\d+) bpm lower by the last rep \(across (\d+) reps\)$/, '末组比首组快 $1 秒/公里 · 末组平均心率低 $2 bpm（共 $3 个片段）'],
    [/^work HR (\d+) bpm higher by the last rep \(across (\d+) reps\)$/, '末组平均心率高出 $1 bpm（共 $2 个片段）'],
    [/^work HR (\d+) bpm lower by the last rep \(across (\d+) reps\)$/, '末组平均心率低 $1 bpm（共 $2 个片段）'],
    [/^Last rep (\d+)s\/km faster than the first across (\d+) reps$/, '末组比首组快 $1 秒/公里（共 $2 个片段）'],
    [/^(\d+) work reps · (\d+)s of walking inside work reps \(average entry ([^)]+) bpm\)$/, '$1 个间歇片段 · 组内步行 $2 秒（平均进入心率 $3 bpm）'],
    [/^(\d+) work reps · ([\d.]+)% of moving time in walk breaks$/, '$1 个间歇片段 · 运动时间中 $2% 为步行休息'],
    [/^Km 1 opened at (\S+) then faded (\d+)s\/km to (\S+)$/, '第1公里 $1，随后每公里放慢 $2 秒至 $3'],
    [/^(\d+)s\/km slower in the second half$/, '后半程每公里慢 $1 秒'],
    [/^(\d+)s\/km faster in the second half$/, '后半程每公里快 $1 秒'],
    [/^Target volume was cut short before the planned stimulus was delivered$/, '目标跑量在刺激达成前被提前中止']
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
export function translateCoachFocusAdvice(advice: string, lang: string): string {
  if (lang !== 'zh' || !advice) return advice;

  const rules: Array<[RegExp, string | ((substring: string, ...args: string[]) => string)]> = [
    [
      /^Biggest Lever — Aerobic Intensity: you never crossed the (\d+) bpm LT1 ceiling, but ([\d.]+)% of your running time sat in the top of Zone 2 \(([\d-]+) bpm\) \((\d+) of (\d+) points lost\)\..*$/,
      (_m, lt1, zone2, band, lost, max) =>
        `最大提升杠杆 — 有氧强度：你从未超过 ${lt1} bpm 的 LT1 上限，但有 ${zone2}% 的跑动时间停留在 2 区上部（${band} bpm）（损失 ${lost} / ${max} 分）。一直贴着上限跑依然会增加恢复成本，因此轻松跑请把 ${Number(lt1) - 10} bpm 当作实际上限——${lt1} bpm 是安全线，而不是目标。`
    ],
    [
      /^Biggest Lever — Aerobic Intensity: ([\d.]+)% of your running time sat above the (\d+) bpm LT1 ceiling \(([\d.]+)% of it in the first half\) \((\d+) of (\d+) points lost\)\..*$/,
      (_m, above, lt1, early, lost, max) =>
        `最大提升杠杆 — 有氧强度：有 ${above}% 的跑动时间超过 ${lt1} bpm 的 LT1 上限，其中 ${early}% 出现在前半程（损失 ${lost} / ${max} 分）。将手表心率告警设为 ${Number(lt1) - 6} bpm，遇到会让你超限的坡段就改为步行——对轻松跑而言，守住上限就是全部训练目的。`
    ],
    [
      /^Biggest Lever — Rep-to-Rep Fatigue: the set decayed as it went(?: — .+?)? \((\d+) of (\d+) points lost\)\..*$/,
      (_m, lost, max) =>
        `最大提升杠杆 — 组内疲劳衰减：整组随时间出现衰减（损失 ${lost} / ${max} 分）。若配速保持或变慢而心率仍在升高，通常指向补给、高温与组间恢复不足，而非体能问题；请让第一组放慢 5-8 秒/公里，使最后一组仍能命中目标。`
    ],
    [
      /^Biggest Lever — Aerobic Decoupling: ([\d.]+)% cardiac drift was the largest single cost \((\d+) of (\d+) points lost\)\.(?: The target for these conditions is ([\d.]+)% \(heat and duration both add drift you cannot pace away\), so this is about pacing and fuelling rather than fitness\.)? Start the opening 2 km 10-15 sec\/km slower and add easy volume at or below (\d+) bpm.*$/,
      (_m, drift, lost, max, target, ceiling) =>
        `最大提升杠杆 — 有氧稳定性：${drift}% 的心率漂移是本次最大的失分点（损失 ${lost} / ${max} 分）。${target ? `当前条件下的目标是 ${target}%（高温与时长都会带来无法靠配速消除的漂移），因此问题在于配速与补给，而非体能。` : ''}前2公里放慢10-15秒/公里，并在 ${ceiling} bpm 以下累积轻松跑量——限制因素是毛细血管密度，而不是速度。`
    ],
    [
      /^Biggest Lever — Pacing Discipline: steady HR reached (\d+) bpm against a (\d+) bpm LT1 cap \((\d+) of (\d+) points lost\)\. Slow the opening 15-20 sec\/km and cap the watch at (\d+) bpm.*$/,
      '最大提升杠杆 — 配速自律：稳态心率达到 $1 bpm，而 LT1 上限为 $2 bpm（损失 $3 / $4 分）。开局放慢15-20秒/公里，并把表上心率上限设为 $5 bpm，让轻松跑真正轻松。'
    ],
    [
      /^Biggest Lever — Pacing Discipline: work intervals averaged (\d+) bpm against a (\d+) bpm LT2 anchor \((\d+) of (\d+) points lost\)\. Set the watch to alert above (\d+) bpm.*$/,
      '最大提升杠杆 — 强度控制：间歇平均心率 $1 bpm，而 LT2 锚点为 $2 bpm（损失 $3 / $4 分）。把心率告警设为 $5 bpm，并压低第一组配速，让第三组仍能命中目标。'
    ],
    [
      /^Biggest Lever — Running Turnover: (\d+) spm cost the most execution points \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 步频运转：$1 spm 是本次失分最多的因素（损失 $2 / $3 分）。每周两次 4 x 20 秒加速跑（步频 180+），可在不增加有氧负荷的前提下提升步频。'
    ],
    [
      /^Biggest Lever — Pacing Consistency: running pace varied more than it needed to \((\d+) of (\d+) points lost\)\.(?: Your running pace held within ±(\d+)s per kilometre across (\d+) running km\.)?(?: The steady ([\d.]+)s\/km slowdown through the run points at an opening that was too quick or under-fuelling\.)? Lock a pace band.*$/,
      (_m, lost, max, spread, km, slowdown) =>
        `最大提升杠杆 — 配速一致性：实际跑动中的配速波动偏大（损失 ${lost} / ${max} 分）。${spread ? `在 ${km} 个实际跑动公里中，配速波动在 ±${spread} 秒/公里以内。` : ''}${slowdown ? `全程稳定放慢 ${slowdown} 秒/公里，通常意味着开局过快或补给不足。` : ''}出发前先确定配速区间，每公里核对一次，而不是凭感觉跑。`
    ],
    [
      /^Biggest Lever — Workout Completion: (\d+)s of mid-run walking started while heart rate was already below your aerobic band \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 课表完成度：有 $1 秒的途中步行是在心率已低于有氧区间时开始的（损失 $2 / $3 分）。建议检查补给、睡眠与负荷，或确认是否是路线本身频繁迫使停步。'
    ],
    [
      /^Biggest Lever — Workout Completion: (\d+)s of walking started inside work reps at an average of ([^\s]+) bpm \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 间歇执行：有 $1 秒步行发生在间歇片段内，平均进入心率 $2 bpm（损失 $3 / $4 分）。在该心率下步行是正确选择，应从源头调整：第一组放慢 5-8 秒/公里，或改在不易被打断的路段完成。'
    ],
    [
      /^Biggest Lever — Workout Completion: ([\d.]+)% of moving time was spent in walk breaks \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 课表完成度：运动时间中有 $1% 为步行休息（损失 $2 / $3 分）。选择过街更少的路线，或把步行休息固定在预定点，让有氧区块保持连续。'
    ],
    [
      /^Biggest Lever — Workout Completion: the session was aborted before the planned stimulus landed \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 课表完成度：目标刺激尚未达成便提前中止（损失 $1 / $2 分）。重跑同一课表前，请先检查睡眠、补给与过去48小时的负荷。'
    ],
    [
      /^Biggest Lever — Interval Execution: rep durations varied by ([\d.]+)% \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 间歇执行：单趟用时波动 $1%（损失 $2 / $3 分）。固定单趟时长而非配速——用时均匀才能真正产生目标刺激。'
    ],
    [
      /^Biggest Lever — Cardiovascular Stimulus: peak work HR only reached (\d+)% of HRmax \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 心血管刺激：间歇峰值心率仅达到最大心率的 $1%（损失 $2 / $3 分）。最后一组请跑到最大心率的90%以上，以充分刺激每搏输出量。'
    ],
    [
      /^Biggest Lever — Cardiovascular Stimulus: the race peaked at (\d+)% of HRmax \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 心血管刺激：比赛最高心率仅为最大心率的 $1%（损失 $2 / $3 分）。可通过 2 x 8 分钟的 LT2 训练，让比赛配速变得更熟悉可控。'
    ],
    [
      /^Biggest Lever — Autonomic Recovery: heart rate fell slowly between reps \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 自主神经恢复：组间心率回落缓慢（损失 $1 / $2 分）。将恢复延长到 90-120 秒轻松慢跑，让每一组都在 LT2 以下重新开始。'
    ],
    [
      /^Biggest Lever — Race Pacing Execution: opening pace discipline was the biggest cost \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 比赛配速执行：开局配速失控是最大失分点（损失 $1 / $2 分）。前2公里比目标配速慢约10秒/公里——首公里过快会提前堆积乳酸，导致后程崩盘。'
    ],
    [
      /^Biggest Lever — Race Finish Execution: the second half slowed noticeably \((\d+) of (\d+) points lost\)\..*$/,
      '最大提升杠杆 — 比赛后程执行：后半程明显掉速（损失 $1 / $2 分）。每周安排一次长跑，并在最后20分钟按目标比赛配速完成，以模拟后程状态。'
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

export function translateActivityName(name: string, _lang?: string): string {
  return name;
}

