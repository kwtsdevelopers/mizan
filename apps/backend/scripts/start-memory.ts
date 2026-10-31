/**
 * Development launcher: starts an in-memory MongoDB (no local MongoDB or Docker
 * required) and then boots the real Mizan backend against it.
 *
 * Usage: npm run start:memory -w @mizan/backend
 * NOT for production - data is lost when the process exits.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

async function run(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
  process.env.PORT = process.env.PORT ?? '3000';
  process.env.MONGODB_URI = uri;
  process.env.CORE_DB_NAME = process.env.CORE_DB_NAME ?? 'mizan_core';
  process.env.TENANT_DB_PREFIX = process.env.TENANT_DB_PREFIX ?? 'mizan_t_';
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-memory-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'dev-memory-refresh-secret-fedcba9876543210';
  process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:4200';
  process.env.PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL ?? 'platform@local.dev';
  process.env.PLATFORM_ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD ?? 'platform-dev-password-123';

  // eslint-disable-next-line no-console
  console.log(`[start-memory] in-memory MongoDB at ${uri}`);
  // eslint-disable-next-line no-console
  console.log(`[start-memory] platform admin: ${process.env.PLATFORM_ADMIN_EMAIL} / ${process.env.PLATFORM_ADMIN_PASSWORD}`);

  // Import after env is set so config validation sees the values.
  await import('../src/main');

  const shutdown = async () => {
    await mongod.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void run();
