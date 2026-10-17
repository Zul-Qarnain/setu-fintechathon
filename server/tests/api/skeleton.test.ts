import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ config: loadConfig({ DATABASE_URL: ':memory:' }) });
});
afterAll(async () => {
  await app.close();
});

describe('skeleton', () => {
  it('health', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      status: 'ok',
      offline_mode: true,
      llm_provider: 'scripted',
      fx_mode: 'fixture',
      synthetic_data: true,
      version: '0.1.0',
    });
    expect(r.headers['x-request-id']).toMatch(/^req_[0-9a-f]{12}$/);
  });

  it('echoes x-request-id', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'abc' },
    });
    expect(r.headers['x-request-id']).toBe('abc');
  });

  it('CORS preflight for the web origin', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('404 uses the error envelope', async () => {
    const r = await app.inject({ method: 'GET', url: '/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('http_404');
    expect(r.json().request_id).toBeTruthy();
  });
});
