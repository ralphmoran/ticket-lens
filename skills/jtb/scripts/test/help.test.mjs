import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  printHelp, printTriageHelp, printFetchHelp, printHistoryHelp,
  printLoginHelp, printLogoutHelp, printSyncHelp,
  printActivateHelp, printLicenseHelp, printDeleteHelp,
  printProfilesHelp, printScheduleHelp,
  printInitHelp, printSwitchHelp, printConfigHelp,
  printNoteHelp, printRecallHelp, printMcpHelp,
  printCommentHelp, printTransitionHelp, printAssignHelp, printDuplicatesHelp, printLinkHelp, printUpdateHelp, printCreateHelp,
  printCloudKeysHelp,
} from '../lib/help.mjs';

function captureHelp(fn) {
  let out = '';
  const stream = { write: (s) => { out += s; } };
  fn({ stream });
  return out;
}

describe('printHelp — banner', () => {
  it('TTY + wide terminal: shows the big block-art banner before USAGE', () => {
    let out = '';
    const stream = { write: (s) => { out += s; }, isTTY: true, columns: 120 };
    printHelp({ stream });
    const bannerIdx = out.indexOf('████████');
    const taglineIdx = out.indexOf('Stop tab-switching. Start building.');
    const usageIdx = out.indexOf('USAGE');
    assert.ok(bannerIdx !== -1, 'must include the block-art banner');
    assert.ok(taglineIdx > bannerIdx, 'tagline must appear after the banner');
    assert.ok(usageIdx > taglineIdx, 'USAGE must appear after the tagline');
  });

  it('non-TTY: still includes the tagline and version (plain fallback)', () => {
    const out = captureHelp(printHelp);
    assert.ok(out.includes('Stop tab-switching. Start building.'));
  });
});

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

  it('the mcp summary line reflects that it now serves the whole ticket-write family, not just Recall', () => {
    const out = captureHelp(printHelp);
    const mcpLine = out.split('\n').find(l => /\bmcp\b/.test(l) && l.includes('Start the MCP'));
    assert.ok(mcpLine, 'expected a top-level line describing the mcp command');
    assert.doesNotMatch(mcpLine, /for Recall/, 'stale — mcp now also serves ticket_comment/transition/assign/duplicates/link/update/create, not just Recall');
  });
});

describe('printFetchHelp', () => {
  it('documents every flag also listed in the general help\'s FETCH OPTIONS section, including --budget', () => {
    const out = captureHelp(printFetchHelp);
    assert.match(out, /--profile/);
    assert.match(out, /--depth/);
    assert.match(out, /--plain/);
    assert.match(out, /--styled/);
    assert.match(out, /--no-attachments/);
    assert.match(out, /--no-cache/);
    assert.match(out, /--check/);
    assert.match(out, /--compliance/);
    assert.match(out, /--summarize/);
    assert.match(out, /--handoff/);
    assert.match(out, /--cloud/);
    assert.match(out, /--provider/);
    assert.match(out, /--template/);
    assert.match(out, /--budget/);
  });
});

describe('printHistoryHelp', () => {
  it('documents the required ticket key and the Pro tier gate', () => {
    const out = captureHelp(printHistoryHelp);
    assert.match(out, /history/);
    assert.match(out, /TICKET-KEY/);
    assert.match(out, /\[Pro\]/);
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

describe('printHelp — AI provider discoverability', () => {
  it('FETCH OPTIONS documents --provider flag', () => {
    const out = captureHelp(printHelp);
    const fetchStart = out.indexOf('FETCH OPTIONS');
    const triageStart = out.indexOf('TRIAGE OPTIONS');
    assert.ok(fetchStart !== -1, 'main --help must have FETCH OPTIONS');
    const fetchBlock = out.slice(fetchStart, triageStart);
    assert.ok(
      fetchBlock.includes('--provider'),
      'FETCH OPTIONS must document --provider flag for AI provider selection'
    );
  });

  it('CONFIGURATION section references config set aiProvider', () => {
    const out = captureHelp(printHelp);
    const configStart = out.indexOf('CONFIGURATION');
    assert.ok(configStart !== -1, 'main --help must have CONFIGURATION section');
    const configBlock = out.slice(configStart);
    assert.ok(
      configBlock.includes('aiProvider'),
      'CONFIGURATION must reference config set aiProvider command'
    );
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

describe('printHelp — Recall commands', () => {
  it('USAGE section documents ticketlens note command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const noteIdx = out.indexOf('ticketlens note');
    assert.ok(noteIdx !== -1 && noteIdx > usageIdx, '"ticketlens note" must appear in USAGE');
  });

  it('USAGE section documents ticketlens recall command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const recallIdx = out.indexOf('ticketlens recall');
    assert.ok(recallIdx !== -1 && recallIdx > usageIdx, '"ticketlens recall" must appear in USAGE');
  });

  it('USAGE section documents ticketlens comment command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const idx = out.indexOf('ticketlens comment');
    assert.ok(idx !== -1 && idx > usageIdx, '"ticketlens comment" must appear in USAGE');
  });

  it('USAGE section documents ticketlens transition command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const idx = out.indexOf('ticketlens transition');
    assert.ok(idx !== -1 && idx > usageIdx, '"ticketlens transition" must appear in USAGE');
  });

  it('USAGE section documents ticketlens assign command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const idx = out.indexOf('ticketlens assign');
    assert.ok(idx !== -1 && idx > usageIdx, '"ticketlens assign" must appear in USAGE');
  });

  it('USAGE section documents ticketlens duplicates command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const idx = out.indexOf('ticketlens duplicates');
    assert.ok(idx !== -1 && idx > usageIdx, '"ticketlens duplicates" must appear in USAGE');
  });

  it('USAGE section documents ticketlens link command', () => {
    const out = captureHelp(printHelp);
    const usageIdx = out.indexOf('USAGE');
    const idx = out.indexOf('ticketlens link');
    assert.ok(idx !== -1 && idx > usageIdx, '"ticketlens link" must appear in USAGE');
  });
});

describe('printMcpHelp — ticket tools', () => {
  it('documents ticket_comment, ticket_transition, ticket_assign, ticket_duplicates, ticket_link, ticket_update, and ticket_create alongside recall_add/recall_search', () => {
    const out = captureHelp(printMcpHelp);
    assert.match(out, /recall_add/);
    assert.match(out, /recall_search/);
    assert.match(out, /ticket_comment/);
    assert.match(out, /ticket_transition/);
    assert.match(out, /ticket_assign/);
    assert.match(out, /ticket_duplicates/);
    assert.match(out, /ticket_link/);
    assert.match(out, /ticket_update/);
    assert.match(out, /ticket_create/);
  });

  it('flags ticket_transition as destructive when target+confirm are given', () => {
    const out = captureHelp(printMcpHelp);
    assert.match(out, /destructive/i);
  });

  it('flags ticket_duplicates as read-only', () => {
    const out = captureHelp(printMcpHelp);
    assert.match(out, /ticket_duplicates.*read-only/s);
  });

  it('warns that an already-connected client session can have a stale tool list after an upgrade (H-8)', () => {
    const out = captureHelp(printMcpHelp);
    assert.match(out, /restart|reconnect/i);
    assert.match(out, /stale/i);
  });
});

describe('printAssignHelp', () => {
  it('documents the required --to=me flag and the Pro tier gate', () => {
    const out = captureHelp(printAssignHelp);
    assert.match(out, /assign/);
    assert.match(out, /--to/);
    assert.match(out, /\[Pro\]/);
  });
});

describe('printDuplicatesHelp', () => {
  it('documents the --threshold flag and the Pro tier gate', () => {
    const out = captureHelp(printDuplicatesHelp);
    assert.match(out, /duplicates/);
    assert.match(out, /--threshold/);
    assert.match(out, /\[Pro\]/);
  });

  it('warns an empty result is not a guarantee none exist (M-11)', () => {
    const out = captureHelp(printDuplicatesHelp);
    assert.match(out, /miss|not a guarantee/i);
  });
});

describe('printLinkHelp', () => {
  it('documents the SOURCE/TARGET direction convention, --type/--confirm flags, and the Pro tier gate', () => {
    const out = captureHelp(printLinkHelp);
    assert.match(out, /link/);
    assert.match(out, /--type/);
    assert.match(out, /--confirm/);
    assert.match(out, /\[Pro\]/);
  });

  it('warns that GitHub\'s link action closes the source issue', () => {
    const out = captureHelp(printLinkHelp);
    assert.match(out, /GitHub/);
    assert.match(out, /clos/i);
  });
});

describe('printUpdateHelp', () => {
  it('documents the title/description/label/priority flags and the Pro tier gate', () => {
    const out = captureHelp(printUpdateHelp);
    assert.match(out, /update/);
    assert.match(out, /--title/);
    assert.match(out, /--description/);
    assert.match(out, /--add-labels/);
    assert.match(out, /--remove-labels/);
    assert.match(out, /--priority/);
    assert.match(out, /\[Pro\]/);
  });

  it('notes GitHub has no native priority field', () => {
    const out = captureHelp(printUpdateHelp);
    assert.match(out, /GitHub/);
    assert.match(out, /priority/i);
  });
});

describe('printCreateHelp', () => {
  it('documents the --project/--type/--summary/--description flags and the Pro tier gate', () => {
    const out = captureHelp(printCreateHelp);
    assert.match(out, /create/);
    assert.match(out, /--project/);
    assert.match(out, /--type/);
    assert.match(out, /--summary/);
    assert.match(out, /--description/);
    assert.match(out, /\[Pro\]/);
  });

  it('notes --project is required for Jira/Linear but not GitHub', () => {
    const out = captureHelp(printCreateHelp);
    assert.match(out, /GitHub/);
  });

  it('notes --type is Jira-only', () => {
    const out = captureHelp(printCreateHelp);
    assert.match(out, /Jira/);
  });

  it('documents --attach, including that GitHub is not supported', () => {
    const out = captureHelp(printCreateHelp);
    assert.match(out, /--attach/);
    assert.match(out, /GitHub/);
  });
});

describe('printCommentHelp', () => {
  it('documents the required --body flag and the Pro tier gate', () => {
    const out = captureHelp(printCommentHelp);
    assert.match(out, /comment/);
    assert.match(out, /--body/);
    assert.match(out, /\[Pro\]/);
  });

  it('documents --attach, including that GitHub is not supported', () => {
    const out = captureHelp(printCommentHelp);
    assert.match(out, /--attach/);
    assert.match(out, /GitHub/);
  });
});

describe('printTransitionHelp', () => {
  it('documents --target and --confirm and the Pro tier gate', () => {
    const out = captureHelp(printTransitionHelp);
    assert.match(out, /transition/);
    assert.match(out, /--target/);
    assert.match(out, /--confirm/);
    assert.match(out, /\[Pro\]/);
  });
});

describe('printNoteHelp', () => {
  it('documents the add subcommand and its flags', () => {
    const out = captureHelp(printNoteHelp);
    assert.match(out, /note add/);
    assert.match(out, /--title/);
    assert.match(out, /--ticket/);
    assert.match(out, /--tags/);
  });

  it('documents the Pro tier gate', () => {
    const out = captureHelp(printNoteHelp);
    assert.match(out, /Pro/);
  });

  it('documents the patch subcommand and its --id flag', () => {
    const out = captureHelp(printNoteHelp);
    assert.match(out, /note patch/);
    assert.match(out, /--id/);
  });

  it('documents that note delete prompts for confirmation and can be skipped with --yes', () => {
    const out = captureHelp(printNoteHelp);
    assert.match(out, /note delete/);
    assert.match(out, /confirm/i);
    assert.match(out, /--yes/);
  });
});

describe('printCloudKeysHelp', () => {
  it('documents that remove prompts for confirmation and can be skipped with --yes', () => {
    const out = captureHelp(printCloudKeysHelp);
    assert.match(out, /remove/);
    assert.match(out, /confirmation/i);
    assert.match(out, /--yes/);
    assert.match(out, /-y/);
  });
});

describe('printRecallHelp', () => {
  it('documents the query/ticket-key argument', () => {
    const out = captureHelp(printRecallHelp);
    assert.match(out, /recall/);
    assert.match(out, /query|TICKET-KEY/);
  });

  it('documents the Pro tier gate', () => {
    const out = captureHelp(printRecallHelp);
    assert.match(out, /Pro/);
  });

  it('documents --plain and --full', () => {
    const out = captureHelp(printRecallHelp);
    assert.match(out, /--plain/);
    assert.match(out, /--full/);
  });

  it('documents the sync subcommand for flushing the local retry queue', () => {
    const out = captureHelp(printRecallHelp);
    assert.match(out, /recall sync/);
  });
});
