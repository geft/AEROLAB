import type { BenchmarkRun } from './benchmark-runs.js';
import { fitFile, message } from './fit-binary.mjs';

/** Native binary counterpart of the existing deterministic workout benchmarks. */
export function benchmarkFit(benchmark: BenchmarkRun): Buffer {
  const epoch = Date.UTC(1989, 11, 31) / 1000;
  const start = Date.parse(benchmark.date.replace(' ', 'T') + 'Z') / 1000 - 8 * 3600 - epoch;
  let distance = 0;
  const chunks = benchmark.rows.map(row => {
    distance += row.spd;
    return message(20, [[253, 0x86, start + row.t], [3, 2, row.hr], [4, 2, Math.floor(row.cad / 2)],
      [73, 0x86, Math.round(row.spd * 1000)], [5, 0x86, Math.round(distance * 100)]]);
  });
  const duration = benchmark.rows.at(-1)!.t + 1;
  const averageHr = Math.round(benchmark.rows.reduce((sum, row) => sum + row.hr, 0) / benchmark.rows.length);
  chunks.push(message(18, [[2, 0x86, start], [5, 0, 1], [7, 0x86, duration * 1000], [8, 0x86, duration * 1000],
    [9, 0x86, Math.round(distance * 100)], [16, 2, averageHr], [17, 2, Math.max(...benchmark.rows.map(row => row.hr))]]));
  return fitFile(chunks);
}
