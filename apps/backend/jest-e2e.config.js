/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
  testTimeout: 120000,
  moduleNameMapper: {
    '^@mizan/shared$': '<rootDir>/../../libs/shared/src/index.ts',
  },
};
