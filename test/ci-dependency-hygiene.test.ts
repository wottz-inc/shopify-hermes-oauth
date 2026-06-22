import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  devDependencies: Record<string, string>;
};
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
  packages: Record<string, { version?: string; devDependencies?: Record<string, string> }>;
};
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const aggressiveToolchainDevDependencies = {
  '@eslint/js': '10.0.1',
  '@types/node': '20.19.41',
  eslint: '10.4.0',
  typescript: '6.0.3',
  'typescript-eslint': '8.59.4',
  vitest: '4.1.7',
} as const;

describe('CI dependency hygiene', () => {
  it('fails CI only for high-severity dependency advisories or worse', () => {
    expect(ciWorkflow).toContain('npm audit --audit-level=high');
  });

  it('documents npm outdated as an informational local check, not a blocking CI gate', () => {
    expect(readme).toContain('npm outdated');
    expect(readme).toContain('informational');
    expect(readme).toContain('not a blocking CI gate');
  });

  it('pins aggressive toolchain devDependencies to the resolved lockfile versions', () => {
    const rootLockPackage = packageLock.packages[''];
    if (!rootLockPackage) {
      throw new Error('package-lock.json is missing the root package entry');
    }

    for (const [name, resolvedVersion] of Object.entries(aggressiveToolchainDevDependencies)) {
      const manifestVersion = packageJson.devDependencies[name];
      const lockedToolPackage = packageLock.packages[`node_modules/${name}`];

      expect(manifestVersion).toBe(resolvedVersion);
      expect(rootLockPackage.devDependencies?.[name]).toBe(resolvedVersion);
      expect(lockedToolPackage?.version).toBe(resolvedVersion);
      expect(manifestVersion).not.toMatch(/^[~^*]|[<>=|]/);
    }
  });

  it('documents intentional toolchain upgrades through package and lockfile changes plus CI gates', () => {
    expect(readme).toContain('Toolchain packages');
    expect(readme).toContain('intentionally pinned to exact versions');
    expect(readme).toContain('Upgrade them deliberately by changing both files together');
    expect(readme).toContain('npm ci');
    expect(readme).toContain('typecheck');
    expect(readme).toContain('lint');
    expect(readme).toContain('build');
  });
});
