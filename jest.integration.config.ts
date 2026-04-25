import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: [
    '<rootDir>/test/integration/**/*.spec.ts',
    '<rootDir>/test/e2e/**/*.spec.ts',
  ],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageDirectory: './coverage/integration',
  testEnvironment: 'node',
  testTimeout: 30000,
};

export default config;
