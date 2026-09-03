/**
 * Two test projects with different needs:
 *   - `scoring` is pure TypeScript with no React Native imports, so it runs
 *     under ts-jest directly. That keeps the rules suite fast enough to run on
 *     every edit, which matters when it is the main correctness gate.
 *   - React component tests, if added, would need jest-expo's preset instead.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // The store is worth testing and reaches persistence on every write, so
    // storage is swapped for a Map rather than the suite being kept away from
    // it.
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/store/__mocks__/asyncStorage.ts',
    '^expo-secure-store$': '<rootDir>/src/store/__mocks__/nativeStub.ts',
    '^react-native-url-polyfill/auto$': '<rootDir>/src/store/__mocks__/nativeStub.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          jsx: 'react',
          esModuleInterop: true,
          // This inline tsconfig replaces the project's rather than extending
          // it, so the test-runner globals must be re-declared here.
          types: ['jest', 'node'],
        },
      },
    ],
  },
  // The parity fixtures are JSON imported directly by the vision tests.
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: ['src/scoring/**/*.ts', '!src/scoring/**/__tests__/**'],
};
