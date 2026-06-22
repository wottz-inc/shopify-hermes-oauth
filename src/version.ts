import { createRequire } from 'node:module';

interface PackageJson {
  readonly version?: unknown;
}

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as PackageJson;

if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
  throw new Error('package.json version must be a non-empty string');
}

export const packageVersion = packageJson.version;
