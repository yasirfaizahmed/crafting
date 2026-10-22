/**
 * Text metrics used for layout (title blocks, tags, dimension text fitting). Widths follow the
 * Helvetica/Arial AFM advance widths, which every output (SVG sans-serif, PDF Helvetica, DXF
 * arial.ttf) renders closely enough for layout purposes. Heights are CAP heights (CAD convention).
 */

/** Cap height as a fraction of the em size (Helvetica 718/1000). */
export const CAP_HEIGHT_RATIO = 0.718;
/** Descender depth as a fraction of the em size. */
export const DESCENT_RATIO = 0.207;

// Advance widths (1/1000 em) for ASCII 32..126.
const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278,
  278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556,
  556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function advance(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return W[c - 32];
  if (ch === '²' || ch === '³' || ch === '°') return 400;
  if (ch === '—') return 1000;
  if (ch === '–') return 556;
  if (ch === '·' || ch === '•') return 350;
  return 600;
}

/** Approximate rendered width of `text` whose cap height is `capHeight` (same units out). */
export function textWidth(text: string, capHeight: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += advance(ch);
  return ((w / 1000) * capHeight * (bold ? 1.06 : 1)) / CAP_HEIGHT_RATIO;
}

/** Em size (font size) for a cap height. */
export const emForCapHeight = (capHeight: number): number => capHeight / CAP_HEIGHT_RATIO;

/**
 * Offset from the anchor to the baseline, measured along the text's "up" direction, for a
 * vertical alignment (positive = baseline lies below the anchor).
 */
export function baselineDrop(valign: 'top' | 'middle' | 'baseline' | 'bottom', capHeight: number): number {
  switch (valign) {
    case 'top':
      return capHeight;
    case 'middle':
      return capHeight / 2;
    case 'bottom':
      return -(capHeight / CAP_HEIGHT_RATIO) * DESCENT_RATIO;
    default:
      return 0;
  }
}
