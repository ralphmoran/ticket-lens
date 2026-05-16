import { createServer }     from 'node:http';
import { randomBytes }       from 'node:crypto';
import { spawn }             from 'node:child_process';
import { hostname as osHostname } from 'node:os';
import { getConsoleBase }    from './sync.mjs';

const PORT_MIN    = 49152;
const PORT_MAX    = 65535;
const TIMEOUT_MS  = 120_000;

export const generateState = () => randomBytes(16).toString('hex');

export const pickPort = () =>
  Math.floor(Math.random() * (PORT_MAX - PORT_MIN + 1)) + PORT_MIN;

export function openBrowser(url) {
  const cmd = process.platform === 'win32' ? 'cmd'
            : process.platform === 'darwin' ? 'open'
            : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Start a one-shot local HTTP server that waits for the CLI auth callback.
 * Resolves with the token string on success; rejects on state mismatch,
 * missing/invalid token, or timeout.
 */
export function startLocalServer(port, expectedState, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn(value);
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get('token') ?? '';
      const state = url.searchParams.get('state') ?? '';

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('State mismatch — authorization rejected.');
        settle(reject, new Error('State mismatch'));
        return;
      }

      if (!token.startsWith('tl_')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid token received.');
        settle(reject, new Error('Invalid token'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0d1117;color:#cdd9e5">'
        + '<h2 style="color:#3fb950">&#10003; Authorized</h2>'
        + '<p style="color:#8b949e">You can close this tab and return to the terminal.</p>'
        + '</body></html>',
      );

      settle(resolve, token);
    });

    server.on('error', (err) => settle(reject, err));

    const timer = setTimeout(
      () => settle(reject, new Error('Authorization timed out after 120 seconds')),
      timeoutMs,
    );

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Full browser login flow. Opens the authorize page in the default browser,
 * waits for the callback, and returns the plaintext CLI token.
 */
export async function browserLogin() {
  const state    = generateState();
  const port     = pickPort();
  const hostname = osHostname();

  const consoleBase = getConsoleBase();
  const url = `${consoleBase}/console/auth/cli`
    + `?port=${port}`
    + `&state=${encodeURIComponent(state)}`
    + `&hostname=${encodeURIComponent(hostname)}`;

  const tokenPromise = startLocalServer(port, state);
  openBrowser(url);

  return tokenPromise;
}
