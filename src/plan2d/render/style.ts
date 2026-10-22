/**
 * Plan colours and fonts. Lineweights are screen px (the plan is a working view, not paper).
 */
import type { GhostState, HoverTone, Tone } from '../editor-types';

export const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export interface Palette {
  wallFill: string;
  partitionFill: string;
  wallStroke: string;
  glassWall: string;
  line: string;
  thin: string;
  paper: string;
  glass: string;
  furniture: string;
  furnitureFill: string;
  slab: string;
  column: string;
  stair: string;
  text: string;
  muted: string;
  dim: string;
  roof: string;
  beam: string;
}

export const PAL: Palette = {
  wallFill: '#2b2f36',
  partitionFill: '#5d6470',
  wallStroke: '#14171c',
  glassWall: '#9cc9e6',
  line: '#1f2630',
  thin: '#5b6573',
  paper: '#ffffff',
  glass: '#2f86c9',
  furniture: '#4a5361',
  furnitureFill: 'rgba(255,255,255,0.86)',
  slab: '#98a2ae',
  column: '#30353d',
  stair: '#3d4652',
  text: '#1d2530',
  muted: '#5a6676',
  dim: '#2f3b4c',
  roof: '#8b5a3c',
  beam: '#4b5b70',
};

const GHOST_COLORS: Record<GhostState, string> = {
  valid: '#12a150',
  invalid: '#e5484d',
  neutral: '#2f7cf6',
};

/** A palette where everything is drawn in the ghost colour (previews). */
export function ghostPalette(state: GhostState): Palette {
  const c = GHOST_COLORS[state];
  const fill = hexA(c, 0.32);
  return {
    wallFill: fill,
    partitionFill: fill,
    wallStroke: c,
    glassWall: fill,
    line: c,
    thin: c,
    paper: hexA(c, 0.1),
    glass: c,
    furniture: c,
    furnitureFill: hexA(c, 0.12),
    slab: c,
    column: fill,
    stair: c,
    text: c,
    muted: c,
    dim: c,
    roof: c,
    beam: c,
  };
}

/** The level below: everything faint grey. */
export const BELOW_PAL: Palette = {
  ...PAL,
  wallFill: 'rgba(110,122,138,0.16)',
  partitionFill: 'rgba(110,122,138,0.12)',
  wallStroke: 'rgba(110,122,138,0.42)',
  line: 'rgba(110,122,138,0.4)',
  thin: 'rgba(110,122,138,0.3)',
};

export const UI = {
  background: '#f4f6f9',
  gridMinor: 'rgba(40,60,90,0.055)',
  gridMajor: 'rgba(40,60,90,0.12)',
  axisX: 'rgba(214,72,72,0.45)',
  axisY: 'rgba(56,160,90,0.45)',
  accent: '#2f7cf6',
  accentFill: 'rgba(47,124,246,0.10)',
  hover: '#4a9dff',
  snap: '#f08c00',
  guide: 'rgba(47,124,246,0.75)',
  handleFill: '#ffffff',
};

export const HOVER_COLORS: Record<HoverTone, string> = {
  normal: '#4a9dff',
  erase: '#e5484d',
  pick: '#8e5bd6',
  paint: '#12a150',
};

export const TONE_BG: Record<Tone, string> = {
  info: 'rgba(23,28,36,0.9)',
  accent: 'rgba(37,108,225,0.95)',
  error: 'rgba(214,52,58,0.95)',
  success: 'rgba(16,140,72,0.95)',
  warning: 'rgba(196,118,0,0.95)',
};

/** `#rrggbb` + alpha → rgba(). */
export function hexA(hex: string, a: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
