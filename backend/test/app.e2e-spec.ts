import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * E2E tests run against the real NestJS application with a live database.
 *
 * Prerequisites:
 *   - DATABASE_URL pointing to a test database (seeded separately)
 *   - JWT_SECRET, VAULT_KEY, VAULT_SALT set in environment
 *   - RECORDINGS_ENABLED=false for E2E (no disk writes needed)
 *
 * Run: npm run test:e2e
 */
describe('OpenBastion E2E', () => {
  let app: INestApplication<App>;
  let jwtCookie: string;
  let adminJwtCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Health ──────────────────────────────────────────────────────────────
  describe('GET /health', () => {
    it('returns liveness OK', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('returns readiness (db + vault)', async () => {
      const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
      expect(res.body.status).toBe('ok');
    });
  });

  // ─── Auth endpoints (public) ─────────────────────────────────────────────
  describe('POST /auth/login', () => {
    it('rejects missing body with 400', async () => {
      await request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
    });

    it('rejects invalid credentials with 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ identifier: 'nobody@test.com', password: 'wrong', authMethod: 'LOCAL' })
        .expect(401);
    });

    it('rate-limits after too many auth attempts', async () => {
      const excessive = Array.from({ length: 25 }, () =>
        request(app.getHttpServer())
          .post('/auth/login')
          .send({ identifier: 'test@test.com', password: 'bad', authMethod: 'LOCAL' }),
      );
      const results = await Promise.all(excessive);
      expect(results.some((r) => r.status === 429)).toBe(true);
    });
  });

  // ─── Protected endpoints (unauthenticated) ───────────────────────────────
  describe('Protected routes without auth', () => {
    const routes = [
      { method: 'get', path: '/users' },
      { method: 'get', path: '/machines' },
      { method: 'get', path: '/auth/me' },
      { method: 'get', path: '/recordings' },
    ];

    routes.forEach(({ method, path }) => {
      it(`${method.toUpperCase()} ${path} → 401`, async () => {
        await (request(app.getHttpServer()) as unknown as Record<string, (path: string) => request.Test>)[method](path).expect(401);
      });
    });
  });

  // ─── RBAC enforcement ────────────────────────────────────────────────────
  describe('RBAC: admin-only endpoints', () => {
    it('GET /auth/admin/providers → 401 without JWT', async () => {
      await request(app.getHttpServer()).get('/auth/admin/providers').expect(401);
    });
  });

  // ─── Refresh token flow ───────────────────────────────────────────────────
  describe('POST /auth/refresh', () => {
    it('returns 401 without refresh_token cookie', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });
  });

  // ─── Auth providers list ──────────────────────────────────────────────────
  describe('GET /auth/providers', () => {
    it('returns public provider list (empty or array)', async () => {
      const res = await request(app.getHttpServer()).get('/auth/providers').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ─── Metrics endpoint ─────────────────────────────────────────────────────
  describe('GET /metrics', () => {
    it('returns prometheus metrics text', async () => {
      const res = await request(app.getHttpServer()).get('/metrics');
      // May be 401 if METRICS_TOKEN is set, or 200 with text/plain if not
      expect([200, 401]).toContain(res.status);
      if (res.status === 200) {
        expect(res.headers['content-type']).toContain('text/plain');
      }
    });
  });
});
