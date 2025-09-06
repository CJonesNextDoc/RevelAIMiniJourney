import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', useESM: true }],
  },
  // Fix path imports ending with .js when using ESM in TS
  moduleNameMapper: {
    '^(\\.\\.?/.*)\\.js$': '$1',
  },
  coverageThreshold: {
    global: {
      branches: 72,
      statements: 90,
      lines: 95,
      functions: 85,
    },
  },
};

export default config;
