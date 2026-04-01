import fs from 'node:fs';
import path from 'node:path';

export const FREE_LIMIT = 3;

const USAGE_FILE = 'usage.json';

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function readUsageFile(configDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, USAGE_FILE), 'utf8'));
  } catch {
    return { compliance: {} };
  }
}

function writeUsageFile(configDir, data) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, USAGE_FILE), JSON.stringify(data, null, 2), 'utf8');
}

export function checkUsage(configDir) {
  const month = currentMonth();
  const data = readUsageFile(configDir);
  const count = data.compliance?.[month] ?? 0;
  return { count, month, canUse: count < FREE_LIMIT };
}

export function incrementUsage(configDir) {
  const month = currentMonth();
  const data = readUsageFile(configDir);
  if (!data.compliance) data.compliance = {};
  data.compliance[month] = (data.compliance[month] ?? 0) + 1;
  writeUsageFile(configDir, data);
}
