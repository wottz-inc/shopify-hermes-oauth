import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

describe('CI dependency hygiene', () => {
  it('fails CI only for high-severity dependency advisories or worse', () => {
    expect(ciWorkflow).toContain('npm audit --audit-level=high');
  });

  it('documents npm outdated as an informational local check, not a blocking CI gate', () => {
    expect(readme).toContain('npm outdated');
    expect(readme).toContain('informational');
    expect(readme).toContain('not a blocking CI gate');
  });
});
