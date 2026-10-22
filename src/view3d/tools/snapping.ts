/**
 * Plan-point snapping for the 3D drawing tools: wall-end magnet, wall location lines (T junctions),
 * 15° angle snapping relative to the previous point, and grid snapping.
 */
import { add, angleDeg, closestOnSegment, dirFromDeg, distance, dot, lineIntersection, scale, snap, sub } from '../../core/math2d';
import type { Project, Vec2 } from '../../core/types';
import { JOIN_TOLERANCE, wallsOnLevel } from '../../core/walls';

export interface SnapSettings {
  /** Grid step, mm (project.settings.gridSize). */
  grid: number;
  snapGrid: boolean;
  snapAngle: boolean;
  /** Angle increment, degrees. */
  angleStep?: number;
  /** Endpoint magnet radius, mm. */
  magnet?: number;
  /** Step used when grid snapping is off, mm. */
  fine?: number;
  endpoints?: Vec2[];
  /** Location lines (e.g. walls) an endpoint may T into. */
  lines?: { a: Vec2; b: Vec2 }[];
  /** Previous point of the polyline being drawn (enables angle snapping). */
  from?: Vec2;
}

export type SnapKind = 'free' | 'grid' | 'endpoint' | 'line' | 'angle';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** Snapped direction from `from`, degrees, when angle snapping applied. */
  angle?: number;
}

export const DEFAULT_MAGNET = 300;
export const DEFAULT_ANGLE_STEP = 15;
export const FINE_STEP = 10;

export function snapToGrid(p: Vec2, step: number): Vec2 {
  return { x: snap(p.x, step), y: snap(p.y, step) };
}

/** Closest endpoint within `radius`, if any. */
export function nearestEndpoint(p: Vec2, endpoints: Vec2[], radius: number): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestD = radius;
  for (const e of endpoints) {
    const d = distance(p, e);
    if (d <= bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/**
 * Snap `raw` to an angle multiple of `step` degrees around `from`, with the length rounded to
 * `lengthStep`. Axis-aligned directions keep grid alignment by projecting the grid point.
 */
export function snapAngleFrom(from: Vec2, raw: Vec2, step: number, lengthStep: number, grid?: number): { point: Vec2; angle: number } {
  const angle = normalizeDeg(Math.round(angleDeg(sub(raw, from)) / step) * step);
  const dir = dirFromDeg(angle);
  let len = dot(sub(raw, from), dir);
  if (grid && grid > 0 && Math.abs(angle % 90) < 1e-9) {
    const g = snapToGrid(raw, grid);
    len = dot(sub(g, from), dir);
  } else {
    len = snap(len, lengthStep);
  }
  const point = add(from, scale(dir, len));
  return { point: { x: round3(point.x), y: round3(point.y) }, angle };
}

/** Full snapping pipeline: endpoint → line → angle → grid. */
export function snapPlanPoint(raw: Vec2, s: SnapSettings): SnapResult {
  const magnet = s.magnet ?? DEFAULT_MAGNET;
  const fine = s.fine ?? FINE_STEP;
  const step = s.snapGrid ? s.grid : fine;
  const ep = nearestEndpoint(raw, s.endpoints ?? [], magnet);
  if (ep) return { point: { x: ep.x, y: ep.y }, kind: 'endpoint' };

  const lineMagnet = magnet / 2;
  const useAngle = !!s.from && s.snapAngle && distance(s.from, raw) > 1;
  if (useAngle) {
    const from = s.from!;
    const a = snapAngleFrom(from, raw, s.angleStep ?? DEFAULT_ANGLE_STEP, step, s.snapGrid ? s.grid : undefined);
    // An angle-snapped ray that ends near a line meets it exactly (clean T junction).
    for (const l of s.lines ?? []) {
      const c = closestOnSegment(a.point, l.a, l.b);
      if (c.distance > lineMagnet || c.t <= 0 || c.t >= 1) continue;
      const hit = lineIntersection(from, dirFromDeg(a.angle), l.a, sub(l.b, l.a));
      if (hit && hit.t > 0 && hit.u >= 0 && hit.u <= 1 && distance(hit.point, a.point) <= lineMagnet) {
        return { point: hit.point, kind: 'line', angle: a.angle };
      }
    }
    return { point: a.point, kind: 'angle', angle: a.angle };
  }

  for (const l of s.lines ?? []) {
    const c = closestOnSegment(raw, l.a, l.b);
    if (c.distance <= lineMagnet && c.t > 0 && c.t < 1) {
      // Slide along the line to the nearest grid-aligned position when possible.
      if (s.snapGrid) {
        const g = snapToGrid(raw, s.grid);
        const cg = closestOnSegment(g, l.a, l.b);
        if (cg.t > 0 && cg.t < 1 && cg.distance <= lineMagnet) return { point: cg.point, kind: 'line' };
      }
      return { point: c.point, kind: 'line' };
    }
  }
  return { point: snapToGrid(raw, step), kind: s.snapGrid ? 'grid' : 'free' };
}

/** Wall endpoints and location lines on a level, for the snapping pipeline. */
export function wallSnapTargets(project: Pick<Project, 'elements'>, levelId: string | undefined): { endpoints: Vec2[]; lines: { a: Vec2; b: Vec2 }[] } {
  const endpoints: Vec2[] = [];
  const lines: { a: Vec2; b: Vec2 }[] = [];
  if (!levelId) return { endpoints, lines };
  for (const w of wallsOnLevel(project, levelId)) {
    if (w.hidden) continue;
    for (const p of [w.start, w.end]) if (!endpoints.some((e) => distance(e, p) <= JOIN_TOLERANCE)) endpoints.push(p);
    lines.push({ a: w.start, b: w.end });
  }
  return { endpoints, lines };
}

export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return Object.is(d, -0) ? 0 : d;
}

/** Snap an angle (deg) to the nearest multiple of `step`, normalised to [0, 360). */
export function snapDeg(deg: number, step: number): number {
  const s = Math.round(deg / step) * step;
  return ((s % 360) + 360) % 360;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
