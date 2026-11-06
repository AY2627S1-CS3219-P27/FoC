import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { seedTestEnvironment } from './test-env.js';

/** Every registered route (Express 5 router), with its HTTP method. */
function registeredRoutes(app: INestApplication) {
  const instance = app.getHttpAdapter().getInstance() as {
    router?: { stack: unknown[] };
    _router?: { stack: unknown[] };
  };
  const stack = (instance.router ?? instance._router)?.stack ?? [];
  return stack.flatMap((layer) => {
    const route = (layer as { route?: { path: string; methods: object } })
      .route;
    // The logger middleware (nestjs-pino) registers a catch-all "{/*splat}"
    // layer; it is not a controller route and has no URL to call.
    return route && !route.path.includes('*')
      ? Object.keys(route.methods).map((method) => ({
          method,
          path: route.path,
        }))
      : [];
  });
}

describe('route audit (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    seedTestEnvironment();
    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DataSource)
      .useValue({
        entityMetadatas: [],
        options: { type: 'postgres' },
        getRepository: () => ({}),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // Guards are applied per controller, so a forgotten one would leave a route
  // open. Every question costs money, so this must fail loudly if that happens.
  it('leaves no route open without a token except /health', async () => {
    const routes = registeredRoutes(app);
    expect(routes.map(({ path }) => path)).toContain('/health');

    for (const { method, path } of routes) {
      if (path === '/health') {
        continue;
      }
      const url = path.replace(/:[^/]+/g, 'x');
      const call = request(app.getHttpServer()) as unknown as Record<
        string,
        (url: string) => request.Test
      >;
      await call[method](url).expect(401);
    }
  });
});
