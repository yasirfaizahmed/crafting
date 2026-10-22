/**
 * Section hatching (ISO 128-50 / ANSI Y14.2 conventions) shared by every 2D output.
 *
 * Patterns are defined like AutoCAD .pat files: families of parallel lines, each with an angle, a
 * base point, a line-to-line delta (along, perpendicular) and an optional dash pattern (positive =
 * dash, negative = gap, 0 = dot). All family numbers are in units of the hatch `spacing`, and every
 * family is anchored at the model origin so adjacent fills line up seamlessly.
 *
 * `hatchLines` clips the families to an outline with holes using even-odd scanline clipping. DXF
 * output writes the same families into HATCH pattern definition data.
 */
import type { HatchPattern } from '../core/materials';
import { add, rotate, scale } from '../core/math2d';
import type { Vec2 } from '../core/types';
import type { Segment } from './geom';

export interface HatchFamily {
  /** Line angle, degrees CCW. */
  angle: number;
  /** Base point (pattern units). */
  origin: [number, number];
  /** Offset between successive lines in the line's frame: [along, perpendicular] (pattern units). */
  delta: [number, number];
  /** Dash pattern (pattern units): + dash, − gap, 0 dot. Empty = continuous. */
  dashes: number[];
}

export interface HatchDefinition {
  /** DXF pattern name. */
  dxfName: string;
  /** DXF pattern type: 1 = predefined (acad.pat name), 2 = custom. */
  dxfType: 1 | 2;
  families: HatchFamily[];
  /** Default spacing in PAPER mm (multiply by the drawing scale for model space). */
  paperSpacing: number;
}

const fam = (angle: number, origin: [number, number], delta: [number, number], dashes: number[] = []): HatchFamily => ({
  angle,
  origin,
  delta,
  dashes,
});

/** Three families drawing equilateral "aggregate" triangles on a hexagonal lattice. */
function triangleFamilies(rot: number, side: number, lattice: number, at: [number, number]): HatchFamily[] {
  const out: HatchFamily[] = [];
  const h = (lattice * Math.sqrt(3)) / 2;
  let p = { x: at[0], y: at[1] };
  for (let i = 0; i < 3; i++) {
    const ang = rot + i * 120;
    // The lattice vector 60° to the left of the family direction serves as the line-to-line delta.
    out.push(fam(ang, [p.x, p.y], [lattice / 2, h], [side, -(lattice - side)]));
    p = add(p, scale({ x: Math.cos((ang * Math.PI) / 180), y: Math.sin((ang * Math.PI) / 180) }, side));
  }
  return out;
}

/** Rows of zig-zag (batt insulation) running along 0°: legs of run `p`, rise `h`, rows 2h apart. */
function zigzagFamilies(p: number, h: number): HatchFamily[] {
  const L = Math.hypot(p, h);
  const a = (Math.atan2(h, p) * 180) / Math.PI;
  // Lattice A = (2p, 0), B = (0, 2h); express B in each family's frame.
  const local = (deg: number, v: Vec2): [number, number] => {
    const r = rotate(v, -deg);
    return [r.x, r.y];
  };
  return [
    fam(a, [0, 0], local(a, { x: 0, y: 2 * h }), [L, -L]),
    fam(-a, [p, h], local(-a, { x: 0, y: 2 * h }), [L, -L]),
  ];
}

export const HATCHES: Record<Exclude<HatchPattern, 'none' | 'solid'>, HatchDefinition> = {
  // ANSI31 — general / brick masonry.
  brick: { dxfName: 'ANSI31', dxfType: 1, paperSpacing: 1.2, families: [fam(45, [0, 0], [0, 1])] },
  // ANSI32 — steel.
  steel: { dxfName: 'ANSI32', dxfType: 1, paperSpacing: 0.5, families: [fam(45, [0, 0], [0, 3]), fam(45, [Math.SQRT2, 0], [0, 3])] },
  // ANSI33 — stone (alternating solid and dashed diagonals).
  stone: { dxfName: 'ANSI33', dxfType: 1, paperSpacing: 0.9, families: [fam(45, [0, 0], [0, 2]), fam(45, [Math.SQRT2, 0], [0, 2], [1, -0.5])] },
  // ANSI36 — glass / marble / slate.
  glass: { dxfName: 'ANSI36', dxfType: 1, paperSpacing: 1, families: [fam(45, [0, 0], [1.75, 1], [2.5, -0.5, 0, -0.5])] },
  // AR-CONC style — random aggregate triangles and specks.
  concrete: {
    dxfName: 'AR-CONC',
    dxfType: 1,
    paperSpacing: 0.55,
    families: [
      ...triangleFamilies(50, 0.9, 6, [0, 0]),
      ...triangleFamilies(15, 0.65, 7, [3.1, 2.2]),
      fam(50, [1.5, 3.8], [3, (6 * Math.sqrt(3)) / 2], [0, -6]),
      fam(15, [5.2, 0.7], [3.5, (7 * Math.sqrt(3)) / 2], [0, -7]),
      fam(75, [2.4, 5.6], [2.5, (5 * Math.sqrt(3)) / 2], [0, -5]),
    ],
  },
  // Batt insulation zig-zag.
  insulation: { dxfName: 'CRAFT_INSUL', dxfType: 2, paperSpacing: 0.6, families: zigzagFamilies(1, 1.6) },
  // Timber grain (runs along the member when rotated with it).
  wood: {
    dxfName: 'CRAFT_WOOD',
    dxfType: 2,
    paperSpacing: 0.6,
    families: [fam(0, [0, 0], [3.1, 1.3], [6, -0.8, 2.5, -1.2]), fam(0, [2, 0.65], [4.3, 2.6], [3, -2.2, 1.6, -3])],
  },
  // EARTH — earth / ground (subterranean).
  earth: {
    dxfName: 'EARTH',
    dxfType: 1,
    paperSpacing: 0.5,
    families: [
      fam(0, [0, 0], [4, 4], [4, -4]),
      fam(0, [0, 1.5], [4, 4], [4, -4]),
      fam(0, [0, 3], [4, 4], [4, -4]),
      fam(90, [0.5, 3.5], [4, 4], [4, -4]),
      fam(90, [2, 3.5], [4, 4], [4, -4]),
      fam(90, [3.5, 3.5], [4, 4], [4, -4]),
    ],
  },
};

/** Hard cap on generated hatch segments per fill (protects against absurd spacing/area ratios). */
export const MAX_HATCH_SEGMENTS = 60_000;

/** Families of a pattern scaled to `spacing` and rotated by `angle`, in model coordinates. */
export function hatchFamilies(pattern: HatchPattern, spacing: number, angle = 0): { angle: number; origin: Vec2; offset: Vec2; dashes: number[] }[] {
  if (pattern === 'none' || pattern === 'solid') return [];
  const def = HATCHES[pattern];
  return def.families.map((f) => {
    const a = f.angle + angle;
    const origin = rotate({ x: f.origin[0] * spacing, y: f.origin[1] * spacing }, angle);
    const offset = rotate({ x: f.delta[0] * spacing, y: f.delta[1] * spacing }, a);
    return { angle: a, origin, offset, dashes: f.dashes.map((d) => d * spacing) };
  });
}

/**
 * Hatch line segments of `pattern` clipped to the region outline − holes (even-odd), with base
 * line spacing `spacing` (same units as the outline) and the pattern rotated by `angle` degrees.
 * Dots are returned as zero-length segments.
 */
export function hatchLines(outline: Vec2[], holes: Vec2[][], pattern: HatchPattern, spacing: number, angle = 0): Segment[] {
  if (pattern === 'none' || pattern === 'solid' || outline.length < 3 || !(spacing > 0)) return [];
  const rings = [outline, ...holes.filter((h) => h.length >= 3)];
  const out: Segment[] = [];
  for (const f of hatchFamilies(pattern, spacing, angle)) {
    const rad = (f.angle * Math.PI) / 180;
    const u = { x: Math.cos(rad), y: Math.sin(rad) };
    const v = { x: -u.y, y: u.x };
    const dPerp = f.offset.x * v.x + f.offset.y * v.y;
    if (Math.abs(dPerp) < 1e-9) continue;
    const dAlong = f.offset.x * u.x + f.offset.y * u.y;
    let pmin = Infinity;
    let pmax = -Infinity;
    for (const r of rings)
      for (const p of r) {
        const c = p.x * v.x + p.y * v.y;
        pmin = Math.min(pmin, c);
        pmax = Math.max(pmax, c);
      }
    const o = f.origin.x * v.x + f.origin.y * v.y;
    const oAlong = f.origin.x * u.x + f.origin.y * u.y;
    let k0 = Math.ceil((pmin - o) / dPerp);
    let k1 = Math.floor((pmax - o) / dPerp);
    if (k0 > k1) [k0, k1] = [Math.ceil((pmax - o) / dPerp), Math.floor((pmin - o) / dPerp)];
    if (k1 - k0 > MAX_HATCH_SEGMENTS) return out;
    const period = f.dashes.reduce((s, d) => s + Math.abs(d), 0);
    for (let k = k0; k <= k1; k++) {
      const c = o + k * dPerp;
      // Along-coordinate of the dash pattern start on this line.
      const phase = oAlong + k * dAlong;
      const ts: number[] = [];
      for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
          const p = r[i];
          const q = r[(i + 1) % n];
          const pc = p.x * v.x + p.y * v.y;
          const qc = q.x * v.x + q.y * v.y;
          if (pc > c === qc > c) continue;
          const t = (c - pc) / (qc - pc);
          const x = p.x + (q.x - p.x) * t;
          const y = p.y + (q.y - p.y) * t;
          ts.push(x * u.x + y * u.y);
        }
      }
      if (ts.length < 2) continue;
      ts.sort((a, b) => a - b);
      const base = { x: v.x * c, y: v.y * c };
      const at = (t: number): Vec2 => ({ x: base.x + u.x * t, y: base.y + u.y * t });
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const ta = ts[i];
        const tb = ts[i + 1];
        if (tb - ta < 1e-9) continue;
        if (period <= 1e-9) {
          out.push([at(ta), at(tb)]);
        } else {
          let n = Math.floor((ta - phase) / period);
          for (let cyc = phase + n * period; cyc < tb; cyc = phase + ++n * period) {
            let pos = cyc;
            for (const d of f.dashes) {
              const len = Math.abs(d);
              if (d > 0) {
                const s0 = Math.max(pos, ta);
                const s1 = Math.min(pos + len, tb);
                if (s1 > s0) out.push([at(s0), at(s1)]);
              } else if (d === 0 && pos >= ta && pos <= tb) {
                const p = at(pos);
                out.push([p, p]);
              }
              pos += len;
            }
            if (out.length > MAX_HATCH_SEGMENTS) return out;
          }
        }
      }
    }
  }
  return out;
}

/** Default paper spacing (mm) of a pattern. */
export function defaultHatchSpacing(pattern: HatchPattern): number {
  return pattern === 'none' || pattern === 'solid' ? 1 : HATCHES[pattern].paperSpacing;
}
