import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/backend/server.js';
import { getDatabase, closeDatabase } from '../../src/backend/db/client.js';

describe('packaged local session boundary', () => {
  const token = 'a'.repeat(64);
  const app = createServer({ sessionToken: token });

  beforeAll(() => getDatabase(':memory:'));
  afterAll(() => closeDatabase());

  it('keeps health available but requires a session for API data and mutations', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/database/status')).status).toBe(401);
    expect((await request(app).post('/api/database/settings').send({ backupDirectory: 'C:\\backup' })).status).toBe(401);
    expect((await request(app).post('/api/system/shutdown')).status).toBe(401);
    expect((await request(app).get('/api/database/status').set('Cookie', `aerolab_session=${'é'.repeat(64)}`)).status).toBe(401);
  });

  it('exchanges a one-time launch URL for an HttpOnly cookie', async () => {
    const agent = request.agent(app);
    const bootstrap = await agent.get(`/bootstrap/${token}`);
    expect(bootstrap.status).toBe(302);
    expect(bootstrap.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(bootstrap.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect((await agent.get('/api/database/status')).status).toBe(200);
    expect((await agent.post('/api/database/settings').send({ backupDirectory: 'C:\\backup' })).status).toBe(200);
    expect((await agent.get(`/bootstrap/${token}`)).status).toBe(404);
  });

  it('rejects DNS rebinding hosts and unrelated localhost origins', async () => {
    expect((await request(app).get('/api/health').set('Host', 'attacker.example:3001')).status).toBe(403);
    expect((await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:4000')).status).toBe(403);
  });

  it('does not grant the Vite origin access in production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect((await request(app).get('/api/health').set('Origin', 'http://localhost:5173')).status).toBe(403);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
