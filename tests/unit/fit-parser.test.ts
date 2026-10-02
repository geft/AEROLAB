import { sealFit } from '../fixtures/fit-binary.mjs';
import { describe, it, expect } from 'vitest';
import { convertFitToCsv, isFitBuffer, detectFileFormat } from '../../src/backend/ingestion/fit-parser.js';

describe('FIT Parser Unit Tests', () => {
  it('throws error when buffer does not start with valid .FIT signature', () => {
    const invalidBuffer = Buffer.from('NOT A FIT FILE HEADER JUST PLAIN TEXT');
    expect(() => convertFitToCsv(invalidBuffer, 'test.fit')).toThrow(/Not a valid FIT file/);
  });

  it('detects FIT format via magic bytes and protocol signature regardless of extension', () => {
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1);
    header.writeUInt16LE(0x0824, 2);
    header.writeUInt32LE(0, 4);
    header.write('.FIT', 8, 'ascii');

    expect(isFitBuffer(header)).toBe(true);
    expect(detectFileFormat(header, 'mystery_file.dat')).toBe('fit');
    expect(detectFileFormat(header, 'unnamed_activity')).toBe('fit');

    const csvBuffer = Buffer.from('timestamp,heart_rate,cadence\n2026-09-13T10:00:00Z,140,170');
    expect(isFitBuffer(csvBuffer)).toBe(false);
    expect(detectFileFormat(csvBuffer, 'run.csv')).toBe('csv');
  });

  it('throws error on empty or truncated buffer', () => {
    const tinyBuffer = Buffer.alloc(8);
    expect(() => convertFitToCsv(tinyBuffer, 'empty.fit')).toThrow();
  });

  it('rejects a declared record range larger than the actual file', () => {
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt32LE(0xffffffff, 4);
    header.write('.FIT', 8, 'ascii');
    expect(() => convertFitToCsv(header, 'oversized.fit')).toThrow('Invalid FIT file length');
  });

  it('parses a synthetically constructed valid FIT binary activity', () => {
    // Construct a minimal FIT buffer
    // Garmin Epoch: 1989-12-31 00:00:00 UTC
    const garminSec = 1126080000; // e.g. Sep 2024 timestamp

    // Data payload:
    // 1. Definition Message for Global Msg 18 (Session):
    //    Header: 0x40 (Definition, local 0)
    //    Reserved: 0x00
    //    Architecture: 0x00 (Little Endian)
    //    Global Mesg Num: 18 (Session) [uint16: 18, 0]
    //    Num Fields: 7
    //      - Field 253 (timestamp): size 4, baseType 0x86 (uint32)
    //      - Field 2 (start_time): size 4, baseType 0x86 (uint32)
    //      - Field 5 (sport): size 1, baseType 0x00 (uint8) -> 1 = running
    //      - Field 9 (total_distance): size 4, baseType 0x86 (uint32, scale 100) -> 500000 = 5000m
    //      - Field 8 (total_timer_time): size 4, baseType 0x86 (uint32, scale 1000) -> 1500000 = 1500s
    //      - Field 89 (avg_vertical_oscillation): size 2, baseType 0x84 (uint16, scale 10) -> 820 (8.2cm)
    //      - Field 91 (avg_stance_time): size 2, baseType 0x84 (uint16, scale 10) -> 2450 (245ms)
    const defSession = [
      0x40, // record header
      0x00, // reserved
      0x00, // arch little-endian
      18, 0, // global mesg 18
      7, // 7 fields
      253, 4, 0x86, // timestamp
      2, 4, 0x86,   // start_time
      5, 1, 0x00,   // sport (1 = running)
      9, 4, 0x86,   // total_distance
      8, 4, 0x86,   // total_timer_time
      89, 2, 0x84,  // avg_vertical_oscillation
      91, 2, 0x84   // avg_stance_time
    ];

    // Data Message for Session:
    // Header: 0x00 (Data, local 0)
    const sessionData = Buffer.alloc(1 + 21);
    sessionData.writeUInt8(0x00, 0); // local 0
    sessionData.writeUInt32LE(garminSec, 1); // timestamp
    sessionData.writeUInt32LE(garminSec, 5); // start_time
    sessionData.writeUInt8(1, 9); // sport = 1 (running)
    sessionData.writeUInt32LE(500000, 10); // total_distance = 5000m (500000 / 100)
    sessionData.writeUInt32LE(1500000, 14); // total_timer_time = 1500s (1500000 / 1000)
    sessionData.writeUInt16LE(820, 18); // avg_vertical_oscillation = 82
    sessionData.writeUInt16LE(2450, 20); // avg_stance_time = 245

    // 2. Definition Message for Global Msg 20 (Record):
    //    Header: 0x41 (Definition, local 1)
    //    Reserved: 0x00
    //    Arch: 0x00
    //    Global Mesg Num: 20 (Record) [uint16: 20, 0]
    //    Num Fields: 4
    //      - Field 253 (timestamp): size 4, baseType 0x86
    //      - Field 3 (heart_rate): size 1, baseType 0x02 (uint8)
    //      - Field 4 (cadence): size 1, baseType 0x02 (uint8)
    //      - Field 5 (distance): size 4, baseType 0x86 (uint32, scale 100)
    const defRecord = [
      0x41, // record header
      0x00, // reserved
      0x00, // arch
      20, 0, // global mesg 20
      4, // 4 fields
      253, 4, 0x86, // timestamp
      3, 1, 0x02,   // heart_rate
      4, 1, 0x02,   // cadence
      5, 4, 0x86    // distance
    ];

    // Data Message 1 for Record (local 1):
    const rec1Data = Buffer.alloc(1 + 10);
    rec1Data.writeUInt8(0x01, 0); // local 1
    rec1Data.writeUInt32LE(garminSec, 1);
    rec1Data.writeUInt8(142, 5); // heart rate
    rec1Data.writeUInt8(88, 6);  // single-leg cadence 88 (spm 176)
    rec1Data.writeUInt32LE(10000, 7); // distance 100m

    // Data Message 2 for Record (local 1):
    const rec2Data = Buffer.alloc(1 + 10);
    rec2Data.writeUInt8(0x01, 0); // local 1
    rec2Data.writeUInt32LE(garminSec + 5, 1);
    rec2Data.writeUInt8(145, 5); // heart rate
    rec2Data.writeUInt8(90, 6);  // cadence 90
    rec2Data.writeUInt32LE(25000, 7); // distance 250m

    const dataPayload = Buffer.concat([
      Buffer.from(defSession),
      sessionData,
      Buffer.from(defRecord),
      rec1Data,
      rec2Data
    ]);

    // 14-byte Header:
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0); // headerSize
    header.writeUInt8(0x20, 1); // proto version 2.0
    header.writeUInt16LE(0x0824, 2); // profile version
    header.writeUInt32LE(dataPayload.length, 4); // dataSize
    header.write('.FIT', 8, 'ascii'); // signature
    header.writeUInt16LE(0, 12); // CRC

    const fitBuffer = sealFit(Buffer.concat([header, dataPayload]));

    const result = convertFitToCsv(fitBuffer, 'workout_run_2026.fit');

    expect(result.isRunning).toBe(true);
    expect(result.distanceM).toBe(5000);
    expect(result.durationS).toBe(1500);
    expect(result.recordCount).toBe(2);
    expect(result.csv).toBeTruthy();
    expect(result.csv).toContain('# Sport: running');
    expect(result.csv).toContain('# Total Distance (m): 5000');
    expect(result.csv).toContain('# Avg Vertical Oscillation (cm): 8.2');
    expect(result.csv).toContain('# Avg Ground Contact Time (ms): 245');
    expect(result.csv).toContain('timestamp,heart_rate,cadence');
    expect(result.csv).toContain(',142,176,');
    expect(result.csv).toContain(',145,180,');
  });

  it('correctly flags non-running sports (e.g. cycling sport=2) as isRunning=false', () => {
    const garminSec = 1126080000;
    const defSession = [
      0x40, 0x00, 0x00, 18, 0, 5,
      253, 4, 0x86,
      2, 4, 0x86,
      5, 1, 0x00, // sport
      9, 4, 0x86,
      8, 4, 0x86
    ];
    const sessionData = Buffer.alloc(1 + 17);
    sessionData.writeUInt8(0x00, 0);
    sessionData.writeUInt32LE(garminSec, 1);
    sessionData.writeUInt32LE(garminSec, 5);
    sessionData.writeUInt8(2, 9); // sport = 2 (cycling)
    sessionData.writeUInt32LE(1500000, 10);
    sessionData.writeUInt32LE(3600000, 14);

    const dataPayload = Buffer.concat([Buffer.from(defSession), sessionData]);
    const header = Buffer.alloc(14);
    header.writeUInt8(14, 0);
    header.writeUInt8(0x20, 1);
    header.writeUInt16LE(0x0824, 2);
    header.writeUInt32LE(dataPayload.length, 4);
    header.write('.FIT', 8, 'ascii');

    const fitBuffer = sealFit(Buffer.concat([header, dataPayload]));
    const result = convertFitToCsv(fitBuffer, 'cycling.fit');

    expect(result.isRunning).toBe(false);
    expect(result.sport).toBe(2);
    expect(result.csv).toBeNull();
  });
});
