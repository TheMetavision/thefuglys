/**
 * Readable brand colours for emails (WCAG 2 contrast).
 *
 * The brand colours come from site-config.mjs, and an environment variable can
 * override any of them, so an email can't assume that its accent reads well
 * on the background it sits on. readableOn() takes a colour and the
 * background behind it and returns the nearest shade of the SAME hue that
 * reaches the contrast asked for: lighter on a dark background, darker on a
 * light one (HSL lightness only; hue and saturation are kept). A colour that
 * already passes comes back unchanged.
 *
 *   readableOn('#FF2E45', '#1e3238')        // Fuglys red as text on the dark teal card
 *   readableOn('#FF00FF', '#ffffff')        // a button's background, so its white label reads
 *
 * WCAG: 4.5:1 for normal text, 3:1 for large text (24px+, or 18.66px+ bold).
 * Same in every IP brand repo (The Fuglys, Labrats, Cats On Crack, The Biker
 * Babies). No dependencies.
 */

export const AA = 4.5;
export const AA_LARGE = 3;

/** '#abc' | '#aabbcc' -> { r, g, b } (0-255), or null. */
export function parseHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

const toHex = ({ r, g, b }) => '#' + [r, g, b].map((x) => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance of a parsed colour. */
function luminance({ r, g, b }) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Contrast ratio (1-21) of two hex colours; 1 if either can't be read. */
export function contrastRatio(a, b) {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return 1;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: ch(h + 1 / 3) * 255, g: ch(h) * 255, b: ch(h - 1 / 3) * 255 };
}

/**
 * The shade of `hsl` nearest to its own lightness, moving towards `end` (0 or
 * 1), that reaches `min` against `bg`; null if even the end doesn't.
 */
function shadeTowards(hsl, bg, min, end) {
  const at = (l) => toHex(fromHsl({ ...hsl, l }));
  if (contrastRatio(at(end), bg) < min) return null;
  let near = hsl.l; // fails
  let far = end; // passes
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2;
    if (contrastRatio(at(mid), bg) >= min) far = mid; else near = mid;
  }
  // Rounding to whole RGB steps can land a hair short: nudge on until it passes.
  let l = far;
  const step = end > hsl.l ? 0.002 : -0.002;
  while (contrastRatio(at(l), bg) < min && (step > 0 ? l < 1 : l > 0)) l = Math.min(1, Math.max(0, l + step));
  return at(l);
}

/**
 * `color` itself if it reaches `min`:1 against `bg`, else the nearest shade of
 * the same hue that does: lighter when `bg` is dark, darker when it is light
 * (the other way if that direction can't get there). Black or white as a last
 * resort. A colour or background that isn't a hex value comes back as given.
 *
 * @param {string} color  hex
 * @param {string} bg     hex: the background the colour sits on (or, for a button, its label colour)
 * @param {number} [min]  4.5 for normal text (default), 3 for large text
 */
export function readableOn(color, bg, min = AA) {
  const c = parseHex(color);
  const b = parseHex(bg);
  if (!c || !b) return color;
  if (contrastRatio(color, bg) >= min) return color;
  const hsl = toHsl(c);
  // Dark background: black text would read worse than white.
  const darkBg = contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg);
  const first = darkBg ? 1 : 0;
  return shadeTowards(hsl, bg, min, first) || shadeTowards(hsl, bg, min, 1 - first)
    || (darkBg ? '#ffffff' : '#000000');
}
