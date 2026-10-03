# Tempo classification

Tempo is a primary run type for substantial upper-aerobic work diluted by easy
warmup and cooldown. Detected work blocks must last at least 20 minutes, average
above the workout-date LT1 and below the LT2 training band, and occupy at least
25% of active session duration. These are conservative heuristic requirements,
not physiological boundaries or proof of adherence to a planned marathon pace.

Race, threshold and VO2 evidence retain precedence. The existing long-duration
rule uses a 100-minute cutoff: a 90-minute easy run stays easy. A 20-minute warmup,
60-minute upper-aerobic block and 20-minute cooldown now classify as Tempo.

Tempo uses its own bilingual title and tag. It is separate from Threshold in
the browse filters, remains included in quality history, and exposes work blocks.
Coaching does not score its HR against LT2 or VO2 targets, or penalize a continuous
block for lacking repetitions. Target adherence remains unverified without a
dedicated tempo prescription model.

The `structured-tempo-v1` analysis upgrade replays stored activities once,
preserving manual classifications. Import and replay share the same classifier.
