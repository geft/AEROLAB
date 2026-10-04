import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { findAvailableApiPort } from '../../scripts/dev-port.js';

describe('development API port selection', () => {
  it('skips a port held by another local engine and releases the probe', async () => {
    const occupied = net.createServer();
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const port = (occupied.address() as net.AddressInfo).port;
    try {
      const selected = await findAvailableApiPort(port);
      expect(selected).toBeGreaterThan(port);
      const backend = net.createServer();
      await new Promise<void>((resolve, reject) => {
        backend.once('error', reject);
        backend.listen(selected, '127.0.0.1', resolve);
      });
      await new Promise<void>(resolve => backend.close(() => resolve()));
    } finally {
      await new Promise<void>(resolve => occupied.close(() => resolve()));
    }
  });

  it.each([0, -1, 65536, 3001.5, NaN])('rejects invalid port %s', async port => {
    await expect(findAvailableApiPort(port)).rejects.toThrow('PORT must be an integer');
  });
});
