import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { MongoMemoryServer } from 'mongodb-memory-server';

export interface TestContext {
  app: NestFastifyApplication;
  mongod: MongoMemoryServer;
  stop: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const mongod = await MongoMemoryServer.create();

  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = mongod.getUri();
  process.env.CORE_DB_NAME = 'mizan_core_test';
  process.env.TENANT_DB_PREFIX = 'mizan_t_';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-with-at-least-32-chars!';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-with-at-least-32-char';
  process.env.PLATFORM_ADMIN_EMAIL = 'platform@test.local';
  process.env.PLATFORM_ADMIN_PASSWORD = 'platform-password-123';

  // Import AFTER env is set so config validation sees test values.
  const { AppModule } = await import('../src/app.module');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready', 'health/live'] });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    mongod,
    stop: async () => {
      await app.close();
      await mongod.stop();
    },
  };
}
