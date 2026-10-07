/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node10',
          jsx: 'react-jsx',
          ignoreDeprecations: '6.0',
        },
      },
    ],
  },
  collectCoverageFrom: ['src/core/**/*.ts', 'src/services/**/*.ts'],
  clearMocks: true,
};
