const Database = require('better-sqlite3');
const db = new Database('data/runs.db');

// Otsu's thresholding on 1D speeds
function findOtsuThreshold(speeds) {
  if (speeds.length < 20) return Infinity;
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  if (max - min < 0.8) return Infinity; // Not enough spread

  const numBins = 50;
  const binWidth = (max - min) / numBins;
  const hist = new Array(numBins).fill(0);
  for (const s of speeds) {
    const bin = Math.min(numBins - 1, Math.floor((s - min) / binWidth));
    hist[bin]++;
  }

  const total = speeds.length;
  let sum = 0;
  for (let i = 0; i < numBins; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thresholdBin = -1;

  for (let t = 0; t < numBins; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);

    if (betweenVar > maxVar) {
      maxVar = betweenVar;
      thresholdBin = t;
    }
  }

  if (thresholdBin < 0) return Infinity;
  const thresholdSpeed = min + (thresholdBin + 0.5) * binWidth;
  
  // Calculate the mean of values above and below threshold
  const below = speeds.filter(s => s < thresholdSpeed);
  const above = speeds.filter(s => s >= thresholdSpeed);
  const meanBelow = below.reduce((a, b) => a + b, 0) / below.length;
  const meanAbove = above.reduce((a, b) => a + b, 0) / above.length;

  // The two clusters must be separated by at least 0.6 m/s (e.g. ~1:15/km pace gap)
  if (meanAbove - meanBelow < 0.6) {
    return Infinity;
  }

  return thresholdSpeed;
}

const activities = db.prepare('SELECT id, name FROM activities ORDER BY start_time ASC').all();
for (const a of activities) {
  const records = db.prepare('SELECT speed_mps FROM activity_records WHERE activity_id = ? AND speed_mps > 0.5').all(a.id);
  const speeds = records.map(r => r.speed_mps);
  const thresh = findOtsuThreshold(speeds);
  const threshPace = thresh !== Infinity ? `${Math.floor(1000/thresh/60)}:${String(Math.floor((1000/thresh)%60)).padStart(2,'0')}/km` : 'none';
  console.log(`[${a.id}] "${a.name}": thresh = ${thresh !== Infinity ? thresh.toFixed(2) + ' m/s (' + threshPace + ')' : 'NONE'}`);
}
