/**
 * Interactive y/N confirmation gate for destructive, unrecoverable actions
 * (deleting a Recall note, removing a stored cloud-provider key, etc).
 * Enter with no input aborts — an accidental keystroke never destroys data.
 * Non-interactive callers must pass forceYes explicitly (--yes/-y at the CLI).
 */
export async function confirmDestructive(action, opts = {}) {
  const { stdin = process.stdin, stream = process.stderr, forceYes = false } = opts;

  if (forceYes) return true;

  if (!stdin.isTTY || !stdin.setRawMode) {
    stream.write('  ✖ Non-interactive mode: pass --yes to confirm without a prompt.\n');
    return false;
  }

  stream.write(`  ${action} — this cannot be restored. Continue?  y/N  `);
  return new Promise(resolve => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once('data', buf => {
      stdin.setRawMode(false);
      stdin.pause();
      const confirmed = buf.toString().toLowerCase() === 'y';
      stream.write(confirmed ? 'y\n' : 'N\n');
      resolve(confirmed);
    });
  });
}
