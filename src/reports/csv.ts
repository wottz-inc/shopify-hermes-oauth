export function csvCell(value: string): string {
  const sanitized = sanitizeCsvOutput(value);
  const neutralized = shouldNeutralizeCsvCell(value) ? `'${sanitized}` : sanitized;

  return `"${neutralized.replace(/"/gu, '""')}"`;
}

function shouldNeutralizeCsvCell(value: string): boolean {
  return /^\s/u.test(value) || /^\s*[=+\-@]/u.test(value);
}

function sanitizeCsvOutput(value: string): string {
  let sanitized = '';

  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint === 0x0A) {
      sanitized += '\\n';
    } else if (codePoint === 0x0D) {
      sanitized += '\\r';
    } else if (codePoint === 0x09) {
      sanitized += '\\t';
    } else if ((codePoint >= 0x00 && codePoint <= 0x1F) || (codePoint >= 0x7F && codePoint <= 0x9F)) {
      sanitized += `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    } else {
      sanitized += character;
    }
  }

  return sanitized;
}
