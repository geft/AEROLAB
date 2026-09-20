import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/backend/server.js';
import { getDatabase } from '../../src/backend/db/client.js';

describe('API Error Handling & Dev Diagnostics Integration Tests', () => {
  let app: any;

  beforeAll(() => {
    process.env.DATABASE_PATH = ':memory:';
    getDatabase(':memory:');
    app = createServer();
  });

  it('GET /api/dev/diagnostics returns system info, db counts, and recent logs', async () => {
    const res = await request(app).get('/api/dev/diagnostics');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.system).toBeDefined();
    expect(res.body.system.nodeVersion).toBeTruthy();
    expect(res.body.db).toBeDefined();
    expect(res.body.db.activityCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  it('POST /api/dev/test-error returns simulated structured error with code and details', async () => {
    const res = await request(app)
      .post('/api/dev/test-error')
      .send({
        code: 'ERR_CUSTOM_TEST',
        message: 'Deliberate test error for verification'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Deliberate test error for verification');
    expect(res.body.code).toBe('ERR_CUSTOM_TEST');
    expect(res.body.details?.simulated).toBe(true);
    expect(res.body.details?.timestamp).toBeTruthy();
  });

  it('does not mount developer routes in a production build', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const productionApp = createServer();
      const diagnostics = await request(productionApp).get('/api/dev/diagnostics');
      expect(diagnostics.status).toBe(404);
      expect(diagnostics.body.code).toBe('ERR_ROUTE_NOT_FOUND');

      const sandbox = await request(productionApp).post('/api/dev/test-error').send({});
      expect(sandbox.status).toBe(404);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('mounts developer routes outside production so diagnostics stay testable', async () => {
    const res = await request(app).get('/api/dev/diagnostics');
    expect(res.status).toBe(200);
  });

  it('GET /api/nonexistent-route returns structured 404 error schema', async () => {
    const res = await request(app).get('/api/nonexistent-route-xyz');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('API route not found');
    expect(res.body.code).toBe('ERR_ROUTE_NOT_FOUND');
    expect(res.body.timestamp).toBeTruthy();
  });

  it('POST /api/ingest/upload with empty body returns 400 error schema', async () => {
    const res = await request(app)
      .post('/api/ingest/upload')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
