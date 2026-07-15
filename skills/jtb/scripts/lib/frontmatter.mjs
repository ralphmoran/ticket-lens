/**
 * Reads and writes the small metadata block at the top of a Recall note file.
 * Hand-rolled — this project does not allow adding a YAML library.
 * Only supports what Recall notes actually need: plain string fields and
 * flat string-array fields. Not a general YAML parser.
 */

const DELIMITER = '---';
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function needsQuoting(value) {
  return value === '' || /[:#",\n[\]]|^\s|\s$/.test(value);
}

function quoteScalar(value) {
  if (!needsQuoting(value)) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function unquoteScalar(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    return inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return trimmed;
}

function serializeArray(items) {
  return `[${items.map(quoteScalar).join(', ')}]`;
}

function parseArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (inner === '') return [];
  const items = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && inner[i - 1] !== '\\') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      items.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  items.push(current);
  return items.map(unquoteScalar);
}

/**
 * @param {object} data - flat object of string and string-array fields
 * @param {string} body - the note's markdown body
 * @returns {string} full note file text
 */
export function serializeFrontmatter(data, body) {
  const lines = [DELIMITER];
  for (const [key, value] of Object.entries(data)) {
    const rendered = Array.isArray(value) ? serializeArray(value) : quoteScalar(String(value));
    lines.push(`${key}: ${rendered}`);
  }
  lines.push(DELIMITER, '', body);
  return lines.join('\n');
}

/**
 * @param {string} text - full note file text
 * @returns {{ data: object, body: string }}
 */
export function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== DELIMITER) {
    return { data: {}, body: text };
  }

  const closingIndex = lines.indexOf(DELIMITER, 1);
  if (closingIndex === -1) {
    return { data: {}, body: text };
  }

  const data = {};
  for (const line of lines.slice(1, closingIndex)) {
    const sepIndex = line.indexOf(': ');
    if (sepIndex === -1) continue;
    const key = line.slice(0, sepIndex);
    if (DANGEROUS_KEYS.has(key)) continue; // a hand-edited note can't repurpose this into a prototype-pollution vector
    const rawValue = line.slice(sepIndex + 2);
    data[key] = rawValue.trim().startsWith('[') ? parseArray(rawValue) : unquoteScalar(rawValue);
  }

  const bodyLines = lines.slice(closingIndex + 1);
  if (bodyLines[0] === '') bodyLines.shift();
  return { data, body: bodyLines.join('\n') };
}
