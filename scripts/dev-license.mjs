#!/usr/bin/env node
/**
 * Dev helper — set the local TicketLens license tier for testing.
 *
 * Usage:
 *   node scripts/dev-license.mjs            # show current tier
 *   node scripts/dev-license.mjs free       # remove license (free tier)
 *   node scripts/dev-license.mjs pro        # write Pro license
 *   node scripts/dev-license.mjs team       # write Team license
 */

import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readLicense, writeLicense } from '../skills/jtb/scripts/lib/license.mjs';
import { DEFAULT_CONFIG_DIR } from '../skills/jtb/scripts/lib/config.mjs';

const TIERS = ['free', 'pro', 'team'];
const tier = process.argv[2]?.toLowerCase();

if (!tier) {
  const current = readLicense();
  if (!current) {
    console.log('Current tier: free (no license file)');
  } else {
    console.log(`Current tier: ${current.tier}`);
    console.log(`  key:         ${current.key}`);
    console.log(`  email:       ${current.email}`);
    console.log(`  validatedAt: ${current.validatedAt}`);
    console.log(`  expiresAt:   ${current.expiresAt ?? 'none'}`);
  }
  process.exit(0);
}

if (!TIERS.includes(tier)) {
  console.error(`Unknown tier: "${tier}". Valid values: ${TIERS.join(', ')}`);
  process.exit(1);
}

if (tier === 'free') {
  const licensePath = join(DEFAULT_CONFIG_DIR, 'license.json');
  try {
    unlinkSync(licensePath);
    console.log('License removed — now running as free tier.');
  } catch {
    console.log('Already free tier (no license file found).');
  }
  process.exit(0);
}

writeLicense({
  key: `dev-${tier}`,
  tier,
  email: `dev-${tier}@test.local`,
  provider: 'dev',
  instanceId: 'dev-local',
  validatedAt: new Date().toISOString(),
});

console.log(`License set to: ${tier}`);
console.log(`  key:   dev-${tier}`);
console.log(`  email: dev-${tier}@test.local`);
