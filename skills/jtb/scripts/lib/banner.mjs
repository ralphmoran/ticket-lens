/**
 * Session banner for TicketLens CLI.
 * Renders a colored header box with embedded spinner, and a footer for errors.
 * Writes to stderr so stdout stays clean for piped output.
 */

import { createStyler } from './ansi.mjs';
import { getVersion } from './config.mjs';

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const visibleLength = (str) => str.replace(ANSI_RE, '').length;

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;


function buildBox(lines, { s, borderColor = 'cyan' }) {
  const maxVisible = lines.reduce((max, l) => Math.max(max, visibleLength(l)), 0);
  const innerWidth = maxVisible + 2;

  const padLine = (line) => {
    const pad = innerWidth - visibleLength(line) - 1;
    return ' ' + line + ' '.repeat(Math.max(0, pad));
  };

  const bc = s[borderColor] || s.cyan;
  const top = bc('╭' + '─'.repeat(innerWidth) + '╮');
  const bot = bc('╰' + '─'.repeat(innerWidth) + '╯');
  const body = lines.map(l => bc('│') + padLine(l) + bc('│')).join('\n');

  return { top, body, bot, innerWidth, bc };
}

export function createSession(conn, { stream = process.stderr } = {}) {
  const isTTY = stream.isTTY;
  const s = createStyler({ isTTY });
  const version = getVersion();

  const hostname = conn.baseUrl ? new URL(conn.baseUrl).hostname : 'unknown';
  const profileLabel = conn.profileName || 'default';
  const userLabel = conn.email || (conn.pat ? 'token auth' : 'unknown');

  const jiraLabel = conn.profileName
    ? conn.profileName.charAt(0).toUpperCase() + conn.profileName.slice(1) + ' Jira'
    : hostname;

  // Pre-build the info lines to calculate box width including status line.
  const infoLines = [
    `${s.bold(s.brand('◆ TicketLens'))} ${s.dim(`v${version}`)}`,
    `  ${s.dim('Profile:')}  ${profileLabel}`,
    `  ${s.dim('Server:')}   ${hostname}`,
    `  ${s.dim('User:')}     ${userLabel}`,
  ];
  // Reserve width for the longest possible status message (failure is longer than success).
  const allLines = [...infoLines, '', `● Connection to ${jiraLabel} failed.`];
  const maxVisible = allLines.reduce((max, l) => Math.max(max, visibleLength(l)), 0);
  const innerWidth = maxVisible + 2;

  const bc = s.brand; // border color
  let timer = null;
  let boxOpen = false;

  const padInner = (line) => {
    const pad = innerWidth - visibleLength(line) - 1;
    return ' ' + line + ' '.repeat(Math.max(0, pad));
  };

  const writeLine = (content) => {
    stream.write(bc('│') + padInner(content) + bc('│'));
  };

  return {
    /** Render a full pre-connection banner (non-TTY fallback). */
    _plainBanner() {
      stream.write(`[TicketLens v${version}]  profile: ${profileLabel}  server: ${hostname}\n`);
    },

    /** Start the header: renders full closed box with spinner on status line. */
    spin(message) {
      if (!isTTY) {
        this._plainBanner();
        return this;
      }

      const bot = bc('╰' + '─'.repeat(innerWidth) + '╯');

      // Top border + info lines + separator
      const top = bc('╭' + '─'.repeat(innerWidth) + '╮');
      stream.write(top + '\n');
      for (const line of infoLines) {
        writeLine(line);
        stream.write('\n');
      }
      // Blank separator line
      writeLine('');
      stream.write('\n');
      boxOpen = true;

      // Render initial spinner line + bottom border (box appears closed)
      let frame = 0;
      const writeSpinnerAndBorder = () => {
        const content = `${s.brand(SPINNER_FRAMES[frame])} ${message}`;
        writeLine(content);
        stream.write('\n');
        stream.write(bot);
      };

      stream.write('\x1b[?25l'); // hide cursor
      writeSpinnerAndBorder();

      timer = setInterval(() => {
        frame = (frame + 1) % SPINNER_FRAMES.length;
        // Clear bottom border line, move up, clear spinner line, redraw both
        stream.write('\r\x1b[2K\x1b[A\r\x1b[2K');
        writeSpinnerAndBorder();
      }, SPINNER_INTERVAL);

      return this;
    },

    /** Stop spinner, show green status, redraw final box. */
    connected() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (!isTTY) return this;

      const bot = bc('╰' + '─'.repeat(innerWidth) + '╯');
      const status = `${s.green('●')} Connected to ${jiraLabel}.`;
      // Clear bottom border line, move up, clear spinner line, redraw both
      stream.write('\r\x1b[2K\x1b[A\r\x1b[2K');
      writeLine(status);
      stream.write('\n');
      stream.write(bot + '\n');
      stream.write('\x1b[?25h'); // restore cursor
      boxOpen = false;
      return this;
    },

    /** Stop spinner, show red status, redraw final box. */
    failed() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (!isTTY) return this;

      const bot = bc('╰' + '─'.repeat(innerWidth) + '╯');
      const status = `${s.red('●')} Connection to ${jiraLabel} failed.`;
      // Clear bottom border line, move up, clear spinner line, redraw both
      stream.write('\r\x1b[2K\x1b[A\r\x1b[2K');
      writeLine(status);
      stream.write('\n');
      stream.write(bot + '\n');
      stream.write('\x1b[?25h'); // restore cursor
      boxOpen = false;
      return this;
    },

    /** Render a colored footer box for errors or info messages. */
    footer(message, type = 'error', hint = null) {
      if (!isTTY) {
        stream.write(`${message}\n`);
        if (hint) stream.write(`  ${hint}\n`);
        return this;
      }

      const icon = type === 'error' ? s.red('✖') : s.brand('ℹ');
      const colorFn = type === 'error' ? s.red : s.dim;
      const contentLine = `${icon} ${message}`;
      const lines = [contentLine];
      if (hint) lines.push(`  ${s.dim(hint)}`);

      const maxContent = lines.reduce((max, l) => Math.max(max, visibleLength(l)), 0);
      const footerWidth = Math.max(maxContent + 2, innerWidth);

      const padFooter = (line) => {
        const pad = footerWidth - visibleLength(line) - 1;
        return ' ' + line + ' '.repeat(Math.max(0, pad));
      };

      const top = colorFn('╭' + '─'.repeat(footerWidth) + '╮');
      const body = lines.map(l => colorFn('│') + padFooter(l) + colorFn('│')).join('\n');
      const bot = colorFn('╰' + '─'.repeat(footerWidth) + '╯');

      stream.write(`${top}\n${body}\n${bot}\n`);
      return this;
    },

    /** Expose for external use (e.g. scan spinner outside box). */
    get styler() { return s; },
    get label() { return jiraLabel; },
  };
}

// Keep backward compat for tests — renderBanner delegates to createSession.
export function renderBanner(conn, opts = {}) {
  const session = createSession(conn, opts);
  session._plainBanner();
}
