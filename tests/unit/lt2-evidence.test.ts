import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/backend/db/client.js';
import { seedBenchmarkProfile } from '../fixtures/benchmark-runs.js';
import { evaluateThresholdUpdate } from '../../src/backend/physiology/threshold-tracker.js';
import { ActivityRecord } from '../../src/backend/ingestion/csv-parser.js';

describe('LT2 sustained early evidence', () => {
  let db: ReturnType<typeof openDatabase>;
  beforeEach(() => {
    db = openDatabase(':memory:'); seedBenchmarkProfile(db);
    db.prepare("INSERT INTO activities (id,start_time,name,run_type) VALUES ('test','2026-09-01','Workout','threshold_lt2')").run();
  });
  afterEach(() => db.close());
  const work = (index: number, start: number, duration: number, pace = 280) => {
    db.prepare("INSERT INTO activity_intervals (activity_id,interval_index,type,start_seconds,duration_seconds,distance_meters,avg_heart_rate,avg_pace_sec_km) VALUES ('test',?,'work',?,?,?,?,?)")
      .run(index,start,duration,duration * 1000 / pace,172,pace);
  };
  const evaluate = (records: ActivityRecord[] = []) => evaluateThresholdUpdate(db, 'test', '2026-09-01', 'threshold_lt2',
    { totalDurationSeconds: 10000 } as any, records,
    { avgMovingHeartRate: 172, avgMovingPaceSecKm: 280, efficiencyFactor: 1.2 } as any);
  const records = (start: number, duration: number, step = 1) => Array.from({length: Math.floor(duration/step)+1},(_,i)=>
    ({ elapsedSeconds: start+i*step, heartRate: 172, speedMps: 1000/280 } as ActivityRecord));

  it('rejects high-HR work beginning two hours into a long run', () => {
    work(1, 8000, 1800, 370);
    expect(evaluate().lt2PaceSecKm).toBeNull();
  });
  it('rejects accumulated short repetitions even when total work exceeds 20 minutes', () => {
    for(let i=0;i<8;i++) work(i+1,i*300,180,250);
    expect(evaluate().lt2PaceSecKm).toBeNull();
  });
  it('rejects a locally steady second repetition with substantial accumulated drift', () => {
    work(1,600,900);work(3,1600,900);
    db.prepare("UPDATE activity_intervals SET avg_heart_rate=190 WHERE interval_index=3").run();
    expect(evaluate().lt2PaceSecKm).toBeNull();
  });
  it.each([1, 5])('rejects pace fade within a single long rep sampled every %s seconds', (step) => {
    work(1,600,1500);
    const insert = db.prepare("INSERT INTO activity_records (activity_id,timestamp,elapsed_seconds,heart_rate,speed_mps) VALUES ('test','2026-09-01',?,?,?)");
    for(let t=600;t<=2100;t+=step) insert.run(t,172,t<1395?3.6:3.25);
    expect(evaluate().lt2PaceSecKm).toBeNull();
  });
  it('retains a sustained 2 x 10 minute threshold workout', () => {
    work(1,600,600);work(3,1360,600);
    expect(evaluate().lt2PaceSecKm).toBe(280);
  });
  it('does not let a previous elevated inferred HR exclude ordinary threshold sessions', () => {
    db.prepare("UPDATE athlete_profile SET lt2_hr = 190 WHERE id = 'primary'").run();
    work(1,600,600);work(3,1360,600);
    expect(evaluate().lt2PaceSecKm).toBe(280);
  });
  it('does not pool disconnected high-HR samples into continuous evidence', () => {
    expect(evaluate([...records(0,600),...records(900,600)]).lt2PaceSecKm).toBeNull();
  });
  it('uses elapsed duration rather than sample count for continuous work', () => {
    expect(evaluate(records(600,1200,5)).lt2PaceSecKm).toBe(280);
    expect(evaluate(records(600,300,0.25)).lt2PaceSecKm).toBeNull();
  });
  it('rejects drift in continuous work as well as structured repetitions', () => {
    const samples=records(600,1200);
    for(const sample of samples) if(sample.elapsedSeconds > 1200) sample.heartRate=190;
    expect(evaluate(samples).lt2PaceSecKm).toBeNull();
  });
  it('cannot bypass the elapsed-time limit through the continuous fallback', () => {
    expect(evaluate(records(8000,1500)).lt2PaceSecKm).toBeNull();
  });
  it('does not equate race intensity with sustainable threshold HR', () => {
    work(1,600,1500,250);
    const result = evaluateThresholdUpdate(db,'test','2026-09-01','race',
      { totalDurationSeconds: 2400 } as any, records(600,1500),
      { avgMovingHeartRate: 185, avgMovingPaceSecKm: 250 } as any);
    expect(result.lt2Hr).toBeNull();
    expect(result.lt2PaceSecKm).toBeNull();
  });
});
