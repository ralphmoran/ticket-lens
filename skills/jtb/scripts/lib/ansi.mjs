const ESC = '\x1b[';
const codes = {
  bold: [1, 22], dim: [2, 22],
  blue: [34, 39], cyan: [36, 39],
  magenta: [35, 39], white: [37, 39],
  brightGreen: [92, 39], brightYellow: [93, 39], brightCyan: [96, 39],
};

// Brand design tokens mapped from landing page CSS variables
const TOKENS = {
  brand:  { rgb: [121, 192, 255], idx: 117 }, // #79c0ff — landing page .t-blue
  green:  { rgb: [63,  185, 80 ], idx: 71  }, // #3fb950
  yellow: { rgb: [227, 179, 65 ], idx: 178 }, // #e3b341
  red:    { rgb: [248, 81,  73 ], idx: 203 }, // #f85149
};

function detectStyled({ forceColor, noColor, term, isTTY } = {}) {
  if (forceColor) return true;
  if (noColor) return false;
  if (term === 'dumb') return false;
  return !!isTTY;
}

function detectTruecolor({ colorterm } = {}) {
  return colorterm === 'truecolor' || colorterm === '24bit';
}

export function createStyler(opts = {}) {
  const enabled = detectStyled(opts);
  const tc = enabled && detectTruecolor(opts);

  const wrap = (open, close) => (text) =>
    enabled ? `${ESC}${open}m${text}${ESC}${close}m` : String(text);

  const wrapToken = (token) => {
    const { rgb: [r, g, b], idx } = TOKENS[token];
    const open = tc ? `38;2;${r};${g};${b}` : `38;5;${idx}`;
    return (text) => enabled ? `${ESC}${open}m${text}${ESC}39m` : String(text);
  };

  const link = (url, text) =>
    enabled ? `\x1b]8;;${url}\x07${text}\x1b]8;;\x07` : String(text);

  return {
    bold:         wrap(codes.bold[0], codes.bold[1]),
    dim:          wrap(codes.dim[0], codes.dim[1]),
    red:          wrapToken('red'),
    green:        wrapToken('green'),
    yellow:       wrapToken('yellow'),
    blue:         wrap(codes.blue[0], codes.blue[1]),
    cyan:         wrap(codes.cyan[0], codes.cyan[1]),
    magenta:      wrap(codes.magenta[0], codes.magenta[1]),
    white:        wrap(codes.white[0], codes.white[1]),
    brightGreen:  wrap(codes.brightGreen[0], codes.brightGreen[1]),
    brightYellow: wrap(codes.brightYellow[0], codes.brightYellow[1]),
    brightCyan:   wrap(codes.brightCyan[0], codes.brightCyan[1]),
    brand:        wrapToken('brand'),
    link,
    enabled,
  };
}

function envStyler() {
  return createStyler({
    forceColor: !!process.env.FORCE_COLOR,
    noColor:    !!process.env.NO_COLOR,
    term:       process.env.TERM,
    colorterm:  process.env.COLORTERM,
    isTTY:      process.stdout.isTTY,
  });
}

const defaultStyler = envStyler();
export const bold         = defaultStyler.bold;
export const dim          = defaultStyler.dim;
export const red          = defaultStyler.red;
export const green        = defaultStyler.green;
export const yellow       = defaultStyler.yellow;
export const blue         = defaultStyler.blue;
export const cyan         = defaultStyler.cyan;
export const magenta      = defaultStyler.magenta;
export const white        = defaultStyler.white;
export const brightGreen  = defaultStyler.brightGreen;
export const brightYellow = defaultStyler.brightYellow;
export const brightCyan   = defaultStyler.brightCyan;
export const brand        = defaultStyler.brand;
export const isStyled     = () => defaultStyler.enabled;
