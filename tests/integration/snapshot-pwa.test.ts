import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotPwaPlugin } from '../../scripts/snapshot-pwa.js';

const publicDirectory = path.resolve('snapshot-public');

describe('snapshot PWA install metadata', () => {
  it('adds the web manifest and mobile theme metadata to the snapshot page', () => {
    const plugin = snapshotPwaPlugin();
    const html = plugin.transformIndexHtml('<html><head></head><body></body></html>');

    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/icon-192.png" />');
    expect(html).toContain('<meta name="theme-color" content="#0b1020" />');
  });

  it('ships the required manifest properties and correctly sized PNG icons', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(publicDirectory, 'manifest.webmanifest'), 'utf8'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('./');
    expect(manifest.display).toBe('standalone');

    for (const size of [192, 512]) {
      const icon = manifest.icons.find((entry: { sizes: string }) => entry.sizes === `${size}x${size}`);
      expect(icon).toBeDefined();
      const buffer = fs.readFileSync(path.join(publicDirectory, icon.src.replace(/^\//, '')));
      expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(buffer.readUInt32BE(16)).toBe(size);
      expect(buffer.readUInt32BE(20)).toBe(size);
    }
  });
});
