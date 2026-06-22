import { sanitizeReportOutput } from './sanitize.js';

export function csvCell(value: string): string {
  const sanitized = sanitizeReportOutput(value);
  const neutralized = shouldNeutralizeCsvCell(value) ? `'${sanitized}` : sanitized;

  return `"${neutralized.replace(/"/gu, '""')}"`;
}

function shouldNeutralizeCsvCell(value: string): boolean {
  return /^\s/u.test(value) || /^\s*[=+\-@]/u.test(value);
}
