import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMenuItems } from '../lib/onboarding.mjs';

function freshState() {
  return { status: 'fresh', profileCount: 0, missingCredentials: [], hasDefault: false, loggedIn: false, corrupt: false };
}

function findItem(items, key) {
  return items.find(i => i.key === key);
}

describe('buildMenuItems', () => {
  it('marks tracker-connection, credentials, and console-login as incomplete when fresh', () => {
    const { items } = buildMenuItems({ state: freshState(), profiles: {}, aliasStatus: { status: 'active' } });
    assert.equal(findItem(items, 'tracker-connection').marker, '○');
    assert.equal(findItem(items, 'credentials').marker, '○');
    assert.equal(findItem(items, 'console-login').marker, '○');
  });

  it('marks tracker-connection and credentials complete when all profiles have credentials', () => {
    const state = { status: 'ready', profileCount: 2, missingCredentials: [], hasDefault: true, loggedIn: false, corrupt: false };
    const profiles = {
      acme: { baseUrl: 'https://acme.atlassian.net', ticketPrefixes: ['PROJ'] },
      globex: { baseUrl: 'https://globex.atlassian.net', ticketPrefixes: ['OPS'] },
    };
    const { items } = buildMenuItems({ state, profiles, aliasStatus: { status: 'active' } });
    assert.equal(findItem(items, 'tracker-connection').marker, '✔');
    assert.equal(findItem(items, 'credentials').marker, '✔');
    assert.ok(findItem(items, 'tracker-connection').sublabel.includes('2'));
  });

  it('marks credentials incomplete and names the missing profiles', () => {
    const state = { status: 'pending', profileCount: 2, missingCredentials: ['globex'], hasDefault: true, loggedIn: false, corrupt: false };
    const profiles = {
      acme: { baseUrl: 'https://acme.atlassian.net' },
      globex: { baseUrl: 'https://globex.atlassian.net' },
    };
    const { items } = buildMenuItems({ state, profiles, aliasStatus: { status: 'active' } });
    assert.equal(findItem(items, 'credentials').marker, '○');
    assert.ok(findItem(items, 'credentials').sublabel.includes('1'));
  });

  it('marks ticket-prefixes complete only when at least one profile has prefixes set, and lists them', () => {
    const state = { status: 'ready', profileCount: 2, missingCredentials: [], hasDefault: true, loggedIn: false, corrupt: false };
    const profiles = {
      acme: { baseUrl: 'https://acme.atlassian.net', ticketPrefixes: ['PROJ'] },
      globex: { baseUrl: 'https://globex.atlassian.net', ticketPrefixes: ['OPS'] },
    };
    const { items } = buildMenuItems({ state, profiles, aliasStatus: { status: 'active' } });
    const prefixes = findItem(items, 'ticket-prefixes');
    assert.equal(prefixes.marker, '✔');
    assert.ok(prefixes.sublabel.includes('PROJ'));
    assert.ok(prefixes.sublabel.includes('OPS'));
  });

  it('marks ticket-prefixes incomplete when no profile has any set', () => {
    const state = { status: 'ready', profileCount: 1, missingCredentials: [], hasDefault: true, loggedIn: false, corrupt: false };
    const profiles = { acme: { baseUrl: 'https://acme.atlassian.net' } };
    const { items } = buildMenuItems({ state, profiles, aliasStatus: { status: 'active' } });
    assert.equal(findItem(items, 'ticket-prefixes').marker, '○');
  });

  it('marks console-login complete when loggedIn, and flags it optional', () => {
    const state = { status: 'ready', profileCount: 1, missingCredentials: [], hasDefault: true, loggedIn: true, corrupt: false };
    const profiles = { acme: { baseUrl: 'https://acme.atlassian.net', ticketPrefixes: ['PROJ'] } };
    const { items } = buildMenuItems({ state, profiles, aliasStatus: { status: 'active' } });
    assert.equal(findItem(items, 'console-login').marker, '✔');
    assert.equal(findItem(items, 'console-login').optional, true);
  });

  it('test-connections is always shown but never counted toward completion', () => {
    const state = { status: 'ready', profileCount: 1, missingCredentials: [], hasDefault: true, loggedIn: true, corrupt: false };
    const profiles = { acme: { baseUrl: 'https://acme.atlassian.net', ticketPrefixes: ['PROJ'] } };
    const { items, completedCount, totalCount } = buildMenuItems({ state, profiles, aliasStatus: { status: 'active' } });
    assert.ok(findItem(items, 'test-connections'));
    assert.equal(totalCount, 4);
    assert.equal(completedCount, 4); // tracker-connection, credentials, ticket-prefixes, console-login all complete
  });

  it('always includes an exit item with no marker', () => {
    const { items } = buildMenuItems({ state: freshState(), profiles: {}, aliasStatus: { status: 'active' } });
    const exitItem = findItem(items, 'exit');
    assert.ok(exitItem);
    assert.equal(exitItem.marker, undefined);
  });

  it('surfaces a shadowed alias warning distinct from the menu items', () => {
    const result = buildMenuItems({ state: freshState(), profiles: {}, aliasStatus: { status: 'shadowed', foreignPath: '/usr/local/bin/tl' } });
    assert.equal(result.aliasWarning, '/usr/local/bin/tl');
  });

  it('has no alias warning when alias status is active or missing', () => {
    const active = buildMenuItems({ state: freshState(), profiles: {}, aliasStatus: { status: 'active' } });
    const missing = buildMenuItems({ state: freshState(), profiles: {}, aliasStatus: { status: 'missing' } });
    assert.equal(active.aliasWarning, null);
    assert.equal(missing.aliasWarning, null);
  });
});
