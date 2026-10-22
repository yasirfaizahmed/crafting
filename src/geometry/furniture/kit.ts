/**
 * Shared building blocks for parametric furniture. Models are built in the furniture's local frame:
 * x ∈ [−w/2, w/2] (width), y ∈ [−d/2, d/2] (depth, FRONT at −y), z ∈ [0, h], origin at the
 * footprint centre on the floor.
 */
import type { FurnitureDef } from '../../core/catalog';
import type { Model, P3 } from '../model';
import { roundedRect } from '../poly2d';

export interface FurnitureSpec {
  def: FurnitureDef;
  w: number;
  d: number;
  h: number;
  /** Element material override or the catalog material. */
  primary: string;
  /** Catalog secondary material (or a sensible default). */
  secondary: string;
}

export interface FurnitureResult {
  /** Light source position in local coordinates (fixtures). */
  light?: P3;
}

export type FurnitureBuilder = (m: Model, s: FurnitureSpec) => FurnitureResult | void;

export const METAL = 'aluminium';
export const DARK_METAL = 'metal-black';
export const WHITE = 'paint-white';
export const LINEN = 'paint-warm-white';
/** Front panel thickness and handle projection used by cabinets (fronts start at −d/2 + FRONT_ZONE). */
export const FRONT_T = 18;
export const HANDLE_D = 22;
export const FRONT_ZONE = FRONT_T + HANDLE_D;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Four square (or round) legs inset from the footprint corners. */
export function legs(m: Model, hw: number, hd: number, inset: number, z0: number, z1: number, size: number, round = false): void {
  const x = hw - inset - size / 2;
  const y = hd - inset - size / 2;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    if (round) m.cylinder(sx * x, sy * y, z0, z1, size / 2, 10);
    else m.boxC(sx * x, sy * y, z0, size, size, z1 - z0);
  }
}

/** Box with front and back top edges rounded (profile in y-z extruded along x). */
export function cushion(m: Model, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r = 40): void {
  const rr = Math.min(r, (y1 - y0) / 2 - 1, (z1 - z0) / 2 - 1);
  if (rr < 2) {
    m.box(x0, y0, z0, x1, y1, z1);
    return;
  }
  m.prismX(roundedRect(y0, z0, y1, z1, rr, 2), x0, x1);
}

/** Box with rounded vertical edges (plan profile extruded up). */
export function softBox(m: Model, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 40, seg = 3): void {
  m.prism(roundedRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), r, seg), Math.min(z0, z1), Math.max(z0, z1));
}

/** Horizontal or vertical bar handle with standoffs, projecting from the face at `yFace` towards −y. */
export function barHandle(m: Model, cx: number, cz: number, len: number, vertical: boolean, yFace: number, depth = HANDLE_D): void {
  const t = 12;
  const half = len / 2;
  const yb = yFace - depth;
  if (vertical) {
    m.box(cx - t / 2, yb, cz - half, cx + t / 2, yb + t, cz + half);
    for (const s of [-1, 1]) m.box(cx - 5, yb + t, cz + s * (half - 15) - 5, cx + 5, yFace, cz + s * (half - 15) + 5);
  } else {
    m.box(cx - half, yb, cz - t / 2, cx + half, yb + t, cz + t / 2);
    for (const s of [-1, 1]) m.box(cx + s * (half - 15) - 5, yb + t, cz - 5, cx + s * (half - 15) + 5, yFace, cz + 5);
  }
}

/** Round knob projecting from the face at `yFace` towards −y. */
export function knob(m: Model, cx: number, cz: number, yFace: number, r = 15, depth = HANDLE_D): void {
  m.cylinderY(yFace - 8, yFace, cx, cz, r * 0.45, 8);
  m.cylinderY(yFace - depth, yFace - 8, cx, cz, r, 10);
}

export type HandleKind = 'bar-v' | 'bar-h' | 'knob' | 'none';

export interface FrontsOptions {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Front face of the carcass (fronts sit in front of it, towards −y). */
  yFace: number;
  cols: number;
  rows: number;
  frontMat: string;
  handleMat: string;
  handle: HandleKind;
  gap?: number;
  /** For vertical bar handles: put them on the inner edges of door pairs. */
  pairs?: boolean;
  /** Vertical position of vertical bar handles (default 'top', for base units). */
  handleAt?: 'top' | 'middle' | 'bottom';
}

/** Grid of door / drawer fronts with handles on the −y face of a carcass. */
export function fronts(m: Model, o: FrontsOptions): void {
  const gap = o.gap ?? 4;
  const cw = (o.x1 - o.x0) / o.cols;
  const rh = (o.z1 - o.z0) / o.rows;
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      const x0 = o.x0 + c * cw + gap / 2;
      const x1 = o.x0 + (c + 1) * cw - gap / 2;
      const z0 = o.z0 + r * rh + gap / 2;
      const z1 = o.z0 + (r + 1) * rh - gap / 2;
      m.use(o.frontMat, 'panel');
      m.box(x0, o.yFace - FRONT_T, z0, x1, o.yFace, z1);
      m.use(o.handleMat, 'detail');
      const yf = o.yFace - FRONT_T;
      const fw = x1 - x0;
      const fh = z1 - z0;
      switch (o.handle) {
        case 'bar-v': {
          const right = o.cols === 1 || (o.pairs ? c % 2 === 0 : c < o.cols / 2);
          const hx = right ? x1 - 35 : x0 + 35;
          const len = Math.min(220, fh * 0.5);
          const zc = o.handleAt === 'bottom' ? z0 + 30 + len / 2 : o.handleAt === 'middle' ? (z0 + z1) / 2 : z1 - 30 - len / 2;
          barHandle(m, hx, zc, len, true, yf);
          break;
        }
        case 'bar-h':
          barHandle(m, (x0 + x1) / 2, z1 - Math.min(40, fh / 3), Math.min(fw * 0.5, 320), false, yf);
          break;
        case 'knob':
          knob(m, (x0 + x1) / 2, (z0 + z1) / 2, yf);
          break;
        default:
      }
    }
  }
}

/** Kick plinth recessed under a cabinet front. */
export function plinth(m: Model, x0: number, x1: number, y0: number, y1: number, h: number, mat = 'paint-charcoal'): void {
  m.use(mat, 'detail');
  m.box(x0, y0, 0, x1, y1, h);
}

/** Simple tap: riser, arched spout reaching towards −y, lever. Rises `rise` above z0. */
export function tap(m: Model, x: number, y: number, z0: number, rise: number, reach: number, mat = 'steel'): void {
  m.use(mat, 'detail');
  m.cylinder(x, y, z0, z0 + 15, 28, 12);
  m.cylinder(x, y, z0 + 15, z0 + rise - 20, 14, 10);
  m.tube([x, y, z0 + rise - 25], [x, y - reach, z0 + rise - 25], 11, 8);
  m.tube([x, y - reach, z0 + rise - 25], [x, y - reach, z0 + rise - 75], 10, 8);
  m.box(x - 6, y - 5, z0 + rise - 20, x + 6, y + 60, z0 + rise);
}
