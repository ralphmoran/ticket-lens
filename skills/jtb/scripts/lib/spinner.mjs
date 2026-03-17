/**
 * Zero-dependency terminal spinner for CLI progress feedback.
 * Writes to stderr so stdout stays clean for piped output.
 * Only animates when stderr is a TTY; silently no-ops otherwise.
 */

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL = 80; // ms per frame

export function createSpinner(message, { stream = process.stderr } = {}) {
  const isTTY = stream.isTTY;
  let timer = null;
  let frame = 0;

  return {
    start() {
      if (!isTTY || timer) return this;
      stream.write('\x1b[?25l'); // hide cursor
      timer = setInterval(() => {
        stream.write(`\r\x1b[K${FRAMES[frame]} ${message}`);
        frame = (frame + 1) % FRAMES.length;
      }, INTERVAL);
      return this;
    },

    update(newMessage) {
      message = newMessage;
      return this;
    },

    stop(finalMessage) {
      if (timer) {
        clearInterval(timer);
        timer = null;
        stream.write('\r\x1b[K'); // clear line
        stream.write('\x1b[?25h'); // show cursor
      }
      if (finalMessage && isTTY) {
        stream.write(finalMessage + '\n');
      }
      return this;
    },
  };
}
