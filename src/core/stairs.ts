/**
 * Stair layout in plan: treads, landings and walk line for straight / L / U / spiral stairs.
 * Shared by geometry (3D), drawing (plan symbols), plan editor, IFC export and 3D walk collision.
 *
 * Conventions: `position` is the centre of the bottom edge of the first tread; `rotation` is the
 * direction of travel going up. Treads = risers − 1 (the last riser lands on the floor above).
 */
import { add, dirFromDeg, perp, scale } from './math2d';
import type { Stair, Vec2 } from './types';

export interface StairStep {
  polygon: Vec2[];
  /** Top of the tread relative to the level elevation, mm. */
  top: number;
}

export interface StairLayout {
  rise: number;
  riserCount: number;
  riserHeight: number;
  treads: StairStep[];
  landings: StairStep[];
  /** Centre path from bottom to top (for the UP arrow). */
  walkline: Vec2[];
  /** Polygons covering the whole stair footprint (flights + landings). */
  footprint: Vec2[][];
}

export const SPIRAL_DEGREES_PER_TREAD = 27;
export const U_STAIR_GAP = 100;

export function stairRise(stair: Stair, levelHeight: number): number {
  return stair.rise ?? levelHeight;
}

export function computeStairLayout(stair: Stair, levelHeight: number): StairLayout {
  const rise = Math.max(1, stairRise(stair, levelHeight));
  const riserCount = Math.max(2, Math.ceil(rise / Math.max(50, stair.maxRiser)));
  const rh = rise / riserCount;
  const T = riserCount - 1;
  const f = dirFromDeg(stair.rotation);
  const s = perp(f);
  const w = stair.width;
  const g = stair.tread;
  const P = (fwd: number, lat: number): Vec2 => add(stair.position, add(scale(f, fwd), scale(s, lat)));
  const rect = (f0: number, f1: number, l0: number, l1: number): Vec2[] => [P(f0, l0), P(f1, l0), P(f1, l1), P(f0, l1)];
  const ccw = (poly: Vec2[]): Vec2[] => (area(poly) < 0 ? [...poly].reverse() : poly);

  const treads: StairStep[] = [];
  const landings: StairStep[] = [];
  const footprint: Vec2[][] = [];
  let walkline: Vec2[] = [];

  if (stair.shape === 'spiral') {
    const outer = w;
    const inner = Math.min(outer * 0.6, stair.innerRadius ?? 100);
    const center = stair.position;
    const sign = stair.turn === 'right' ? -1 : 1;
    const step = SPIRAL_DEGREES_PER_TREAD;
    const arcPts = (r: number, a0: number, a1: number, n: number): Vec2[] =>
      Array.from({ length: n + 1 }, (_, i) => add(center, scale(dirFromDeg(a0 + ((a1 - a0) * i) / n), r)));
    for (let i = 0; i < T; i++) {
      const a0 = stair.rotation + sign * i * step;
      const a1 = stair.rotation + sign * (i + 1) * step;
      const poly = [...arcPts(inner, a0, a1, 1), ...arcPts(outer, a1, a0, 4)];
      treads.push({ polygon: ccw(poly), top: (i + 1) * rh });
    }
    const rw = (inner + outer) / 2;
    walkline = arcPts(rw, stair.rotation, stair.rotation + sign * T * step, Math.max(2, T * 2));
    footprint.push(ccw(arcPts(outer, 0, 360, 48).slice(0, 48)));
    return { rise, riserCount, riserHeight: rh, treads, landings, walkline, footprint };
  }

  if (stair.shape === 'straight' || T < 3) {
    for (let i = 0; i < T; i++) treads.push({ polygon: ccw(rect(i * g, (i + 1) * g, -w / 2, w / 2)), top: (i + 1) * rh });
    footprint.push(ccw(rect(0, Math.max(g, T * g), -w / 2, w / 2)));
    walkline = [P(0, 0), P(T * g, 0)];
    return { rise, riserCount, riserHeight: rh, treads, landings, walkline, footprint };
  }

  // Two flights with a landing that counts as one tread level.
  const t1 = Math.ceil((T - 1) / 2);
  const t2 = T - 1 - t1;
  const landTop = (t1 + 1) * rh;
  const side = stair.turn === 'left' ? 1 : -1;
  for (let i = 0; i < t1; i++) treads.push({ polygon: ccw(rect(i * g, (i + 1) * g, -w / 2, w / 2)), top: (i + 1) * rh });
  const run1 = t1 * g;
  footprint.push(ccw(rect(0, Math.max(run1, 1), -w / 2, w / 2)));

  if (stair.shape === 'l-shape') {
    const landing = ccw(rect(run1, run1 + w, -w / 2, w / 2));
    landings.push({ polygon: landing, top: landTop });
    footprint.push(landing);
    // Flight 2 runs sideways (towards `side`), spanning forward run1..run1+w.
    const lat0 = (side * w) / 2;
    for (let i = 0; i < t2; i++) {
      const a = lat0 + side * i * g;
      const b = lat0 + side * (i + 1) * g;
      treads.push({ polygon: ccw(rect(run1, run1 + w, Math.min(a, b), Math.max(a, b))), top: landTop + (i + 1) * rh });
    }
    const end = lat0 + side * t2 * g;
    footprint.push(ccw(rect(run1, run1 + w, Math.min(lat0, end), Math.max(lat0, end))));
    walkline = [P(0, 0), P(run1 + w / 2, 0), P(run1 + w / 2, end)];
  } else {
    // U-shape: flight 2 returns alongside flight 1.
    const off = side * (w + U_STAIR_GAP);
    const l0 = Math.min(-w / 2, off - w / 2);
    const l1 = Math.max(w / 2, off + w / 2);
    const landing = ccw(rect(run1, run1 + w, l0, l1));
    landings.push({ polygon: landing, top: landTop });
    footprint.push(landing);
    for (let i = 0; i < t2; i++) {
      const a = run1 - i * g;
      const b = run1 - (i + 1) * g;
      treads.push({ polygon: ccw(rect(b, a, off - w / 2, off + w / 2)), top: landTop + (i + 1) * rh });
    }
    footprint.push(ccw(rect(run1 - t2 * g, Math.max(run1, run1 - t2 * g + 1), off - w / 2, off + w / 2)));
    walkline = [P(0, 0), P(run1 + w / 2, 0), P(run1 + w / 2, off), P(run1 - t2 * g, off)];
  }
  return { rise, riserCount, riserHeight: rh, treads, landings, walkline, footprint };
}

function area(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
