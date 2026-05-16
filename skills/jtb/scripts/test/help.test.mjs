import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  printHelp, printTriageHelp,
  printLoginHelp, printLogoutHelp, printSyncHelp,
  printActivateHelp, printLicenseHelp, printDeleteHelp,
  printProfilesHelp, printScheduleHelp,
  printInitHelp, printSwitchHelp, printConfigHelp,
} from '../lib/help.mjs';

function captureHelp(fn) {
  let out = '';
  const stream = { write: (s) => { out += s; } };
  fn({ stream });
  return out;
}

describe('printHelp — main USAGE', () => {
  it('USAGE section documents the get alias before EXAMPLES', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const getIdx = out.indexOf('ticketlens get');
    const examplesIdx = out.indexOf('EXAMPLES');
    assert.ok(usageIdx !== -1, 'output must contain USAGE section');
    assert.ok(
      getIdx !== -1 && getIdx < examplesIdx,
      `"ticketlens get" must appear in USAGE (before EXAMPLES), but found at index ${getIdx} vs EXAMPLES at ${examplesIdx}`
    );
  });

  it('USAGE section documents ticketlens schedule command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const scheduleIdx = out.indexOf('ticketlens schedule');
    const fetchOptionsIdx = out.indexOf('FETCH OPTIONS');
    assert.ok(usageIdx !== -1, 'output must contain USAGE section');
    assert.ok(
      scheduleIdx !== -1 && scheduleIdx < fetchOptionsIdx,
      `"ticketlens schedule" must appear in USAGE (before FETCH OPTIONS), found at ${scheduleIdx} vs FETCH OPTIONS at ${fetchOptionsIdx}`
    );
  });
});

describe('printTriageHelp — Team tier flags', () => {
  it('documents --assignee flag with [Team] badge', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('--assignee'), 'triage --help must document --assignee flag');
    assert.ok(out.includes('[Team]'), 'triage --help must show [Team] badge for gated flags');
  });

  it('documents --sprint flag with [Team] badge', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('--sprint'), 'triage --help must document --sprint flag');
  });

  it('main --help documents --assignee in TRIAGE OPTIONS', () => {
    const out = captureHelp(printHelp);
    assert.ok(out.includes('--assignee'), 'main --help must include --assignee in triage options');
  });

  it('main --help documents --sprint in TRIAGE OPTIONS', () => {
    const out = captureHelp(printHelp);
    assert.ok(out.includes('--sprint'), 'main --help must include --sprint in triage options');
  });
});

describe('printLoginHelp', () => {
  it('mentions the command name and token', () => {
    const out = captureHelp(printLoginHelp);
    assert.ok(out.includes('login'), 'must mention login command');
    assert.ok(out.includes('token') || out.includes('Token'), 'must mention token');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printLoginHelp);
    assert.ok(out.includes('ticketlens login'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printLoginHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printLogoutHelp', () => {
  it('mentions the command name', () => {
    const out = captureHelp(printLogoutHelp);
    assert.ok(out.includes('logout'), 'must mention logout');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printLogoutHelp);
    assert.ok(out.includes('ticketlens logout'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printLogoutHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printSyncHelp', () => {
  it('mentions the command name', () => {
    const out = captureHelp(printSyncHelp);
    assert.ok(out.includes('sync'), 'must mention sync');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printSyncHelp);
    assert.ok(out.includes('ticketlens sync'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printSyncHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printActivateHelp', () => {
  it('mentions the command name and KEY argument', () => {
    const out = captureHelp(printActivateHelp);
    assert.ok(out.includes('activate'), 'must mention activate');
    assert.ok(out.includes('KEY') || out.includes('key') || out.includes('license'), 'must mention the key argument');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printActivateHelp);
    assert.ok(out.includes('ticketlens activate'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printActivateHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printLicenseHelp', () => {
  it('mentions the command name', () => {
    const out = captureHelp(printLicenseHelp);
    assert.ok(out.includes('license'), 'must mention license');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printLicenseHelp);
    assert.ok(out.includes('ticketlens license'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printLicenseHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printDeleteHelp', () => {
  it('mentions the command name and profile argument', () => {
    const out = captureHelp(printDeleteHelp);
    assert.ok(out.includes('delete'), 'must mention delete');
    assert.ok(out.includes('PROFILE') || out.includes('profile'), 'must mention the profile argument');
  });
  it('documents the --yes flag', () => {
    const out = captureHelp(printDeleteHelp);
    assert.ok(out.includes('--yes') || out.includes('-y'), 'must document --yes / -y flag');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printDeleteHelp);
    assert.ok(out.includes('ticketlens delete'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printDeleteHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printProfilesHelp', () => {
  it('mentions the command name and ls alias', () => {
    const out = captureHelp(printProfilesHelp);
    assert.ok(out.includes('profiles'), 'must mention profiles');
    assert.ok(out.includes('ls'), 'must mention ls alias');
  });
  it('documents the --plain flag', () => {
    const out = captureHelp(printProfilesHelp);
    assert.ok(out.includes('--plain'), 'must document --plain flag');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printProfilesHelp);
    assert.ok(out.includes('ticketlens profiles') || out.includes('ticketlens ls'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printProfilesHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printScheduleHelp', () => {
  it('mentions the command name and Pro gate', () => {
    const out = captureHelp(printScheduleHelp);
    assert.ok(out.includes('schedule'), 'must mention schedule');
    assert.ok(out.includes('Pro') || out.includes('[Pro]'), 'must indicate Pro tier requirement');
  });
  it('documents --stop and --status flags', () => {
    const out = captureHelp(printScheduleHelp);
    assert.ok(out.includes('--stop'), 'must document --stop flag');
    assert.ok(out.includes('--status'), 'must document --status flag');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printScheduleHelp);
    assert.ok(out.includes('ticketlens schedule'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printScheduleHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printInitHelp', () => {
  it('mentions the command name and wizard / interactive', () => {
    const out = captureHelp(printInitHelp);
    assert.ok(out.includes('init'), 'must mention init');
    assert.ok(out.includes('wizard') || out.includes('interactive') || out.includes('Configure'), 'must describe interactive setup');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printInitHelp);
    assert.ok(out.includes('ticketlens init'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printInitHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printSwitchHelp', () => {
  it('mentions the command name', () => {
    const out = captureHelp(printSwitchHelp);
    assert.ok(out.includes('switch'), 'must mention switch');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printSwitchHelp);
    assert.ok(out.includes('ticketlens switch'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printSwitchHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printConfigHelp', () => {
  it('mentions the command name and --profile flag', () => {
    const out = captureHelp(printConfigHelp);
    assert.ok(out.includes('config'), 'must mention config');
    assert.ok(out.includes('--profile'), 'must document --profile flag');
  });
  it('includes at least one example', () => {
    const out = captureHelp(printConfigHelp);
    assert.ok(out.includes('ticketlens config'), 'must show a usage example');
  });
  it('mentions --help flag', () => {
    const out = captureHelp(printConfigHelp);
    assert.ok(out.includes('--help'), 'must document --help');
  });
});

describe('printTriageHelp — interactive mode keys', () => {
  it('documents the p hotkey for profile switching', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(
      out.includes('p') && (out.toLowerCase().includes('profile') || out.toLowerCase().includes('switch')),
      'triage --help must document the p hotkey and mention profile or switch'
    );
  });

  it('documents up/down navigation', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('↑') || out.includes('↓') || out.includes('up') || out.includes('navigate'),
      'triage --help must document navigation keys');
  });

  it('documents Enter to open in browser', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.toLowerCase().includes('enter') || out.includes('browser'),
      'triage --help must document Enter key');
  });

  it('documents q/Esc to exit', () => {
    const out = captureHelp(printTriageHelp);
    assert.ok(out.includes('q') || out.includes('Esc'),
      'triage --help must document q/Esc to exit');
  });
});
