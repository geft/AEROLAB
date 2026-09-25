import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// One-time, developer-run snapshot. The app reads only the generated JSON offline.
const distances = {
  '5K': '5k-times',
  '10K': '10k-times',
  'Half Marathon': 'half-marathon-times',
  Marathon: 'marathon-times'
};
const snapshot = {
  source: 'Running Level',
  sourceUrl: 'https://runninglevel.com/running-times/',
  capturedAt: new Date().toISOString().slice(0, 10),
  percentileFasterThan: [5, 20, 50, 80, 95],
  ages: {}
};

for (const [distance, slug] of Object.entries(distances)) {
  const response = await fetch(`${snapshot.sourceUrl}${slug}`);
  if (!response.ok) throw new Error(`Could not fetch ${slug}: ${response.status}`);
  const html = await response.text();
  snapshot.ages[distance] = {};
  for (const sex of ['Male', 'Female']) {
    const heading = html.toLowerCase().indexOf(`${sex} ${distance} Running Times`.toLowerCase());
    if (heading < 0) throw new Error(`Missing ${sex} heading for ${slug}`);
    const tbodyStart = html.indexOf('<tbody>', heading);
    const tbodyEnd = html.indexOf('</tbody>', tbodyStart);
    if (tbodyStart < 0 || tbodyEnd < 0) throw new Error(`Missing ${sex} table for ${slug}`);
    const table = html.slice(tbodyStart, tbodyEnd);
    const rows = [...table.matchAll(/<tr>\s*((?:<td>[^<]+<\/td>\s*){7})<\/tr>/g)];
    const parsed = rows.map(([, cells]) => [...cells.matchAll(/<td>([^<]+)<\/td>/g)].map(match => match[1].trim()));
    if (parsed.length < 15) throw new Error(`Incomplete ${sex} table for ${slug}`);
    snapshot.ages[distance][sex] = Object.fromEntries(parsed
      .filter(([age]) => Number(age) >= 20 && Number(age) <= 90)
      .map(([age, ...times]) => [age, times.slice(0, 5)]));
  }
}

const output = path.resolve('src/frontend/data/raceBenchmarks.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved offline race benchmark snapshot to ${output}`);
