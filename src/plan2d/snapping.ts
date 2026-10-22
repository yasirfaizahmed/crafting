/**
 * Plan snapping engine (pure, no DOM).
 *
 * Priority (first match wins):
 *   1. object points within tolerance: endpoint > intersection / centre > midpoint
 *   2. perpendicular foot from the previous point onto a wall
 *   3. with an angle constraint (15° steps from the previous point): the ray meets a tracking line
 *      or a wall, else the length is rounded to the grid along the ray
 *   4. without: two tracking lines cross (H/V alignment with existing endpoints), nearest point on
 *      a wall (crossed with a tracking line when possible), one tracking line, grid, raw.
 */
import { add, closestOnSegment, cross, distance, dot, EPS, length, lineIntersection, midpoint, normalize, scale, sub } from '../core/math2d';
import { computeStairLayout } from '../core/stairs';
import type { Element, Level, Vec2 } from '../core/types';
import type { WallFootprint } from '../core/walls';

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'intersection'
  | 'center'
  | 'perpendicular'
  | 'nearest'
  | 'extension'
  | 'alignment'
  | 'angle'
  | 'grid'
  | 'none';

export interface SnapCandidate {
  p: Vec2;
  kind: 'endpoint' | 'midpoint' | 'center';
  id?: string;
}

export interface SnapSegment {
  a: Vec2;
  b: Vec2;
  id?: string;
}

export interface SnapScene {
  points: SnapCandidate[];
  segments: SnapSegment[];
  intersections: Vec2[];
}

export interface SnapGuide {
  from: Vec2;
  to: Vec2;
  kind: 'alignment' | 'extension' | 'angle' | 'perpendicular';
}

export interface SnapOptions {
  grid: boolean;
  objects: boolean;
  angle: boolean;
  gridSize: number;
  /** Capture radius in model mm (typically 10 px converted). */
  tolerance: number;
  /** Previous point of the operation (enables angle, perpendicular and length snapping). */
  from?: Vec2;
  /** Angle increment in degrees (default 15). */
  angleStep?: number;
  /** Extra points used for H/V alignment tracking (e.g. earlier points of the current chain). */
  track?: Vec2[];
}

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  guides: SnapGuide[];
  /** Id of the element snapped to, when any. */
  targetId?: string;
  /** Snapped direction from `from`, degrees. */
  angle?: number;
}

const RANK: Record<string, number> = { endpoint: 0, intersection: 1, center: 1, midpoint: 2 };

export function snapToGrid(p: Vec2, step: number): Vec2 {
  if (!(step > 0)) return { ...p };
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

export interface SnapSceneOptions {
  /** Element ids to leave out (the ones being edited). */
  exclude?: Set<string>;
  /** Also offer wall faces and face corners (for furniture, dimensions, measuring). */
  faces?: boolean;
  footprints?: Map<string, WallFootprint>;
  level?: Pick<Level, 'height'>;
}

/** Collect snap targets from the elements of one level. */
export function buildSnapScene(elements: Element[], opts: SnapSceneOptions = {}): SnapScene {
  const points: SnapCandidate[] = [];
  const segments: SnapSegment[] = [];
  const wallSegs: SnapSegment[] = [];
  const ex = opts.exclude;
  const poly = (pts: Vec2[], id: string, closed: boolean) => {
    pts.forEach((p) => points.push({ p, kind: 'endpoint', id }));
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (distance(a, b) < EPS) continue;
      segments.push({ a, b, id });
      points.push({ p: midpoint(a, b), kind: 'midpoint', id });
    }
  };
  for (const el of elements) {
    if (ex?.has(el.id) || el.hidden) continue;
    switch (el.type) {
      case 'wall': {
        if (distance(el.start, el.end) < EPS) break;
        points.push({ p: el.start, kind: 'endpoint', id: el.id }, { p: el.end, kind: 'endpoint', id: el.id });
        points.push({ p: midpoint(el.start, el.end), kind: 'midpoint', id: el.id });
        const seg = { a: el.start, b: el.end, id: el.id };
        segments.push(seg);
        wallSegs.push(seg);
        const fp = opts.faces ? opts.footprints?.get(el.id) : undefined;
        if (fp) {
          for (const p of [fp.startLeft, fp.startRight, fp.endLeft, fp.endRight]) points.push({ p, kind: 'endpoint', id: el.id });
          segments.push({ a: fp.startLeft, b: fp.endLeft, id: el.id }, { a: fp.startRight, b: fp.endRight, id: el.id });
        }
        break;
      }
      case 'beam':
        poly([el.start, el.end], el.id, false);
        break;
      case 'railing':
        poly(el.path, el.id, false);
        break;
      case 'slab':
      case 'room':
      case 'roof':
        poly(el.outline, el.id, true);
        break;
      case 'column':
        points.push({ p: el.position, kind: 'center', id: el.id });
        break;
      case 'stair': {
        points.push({ p: el.position, kind: 'endpoint', id: el.id });
        const l = computeStairLayout(el, opts.level?.height ?? 3000);
        const end = l.walkline[l.walkline.length - 1];
        if (end) points.push({ p: end, kind: 'endpoint', id: el.id });
        break;
      }
      case 'dimension':
        points.push({ p: el.a, kind: 'endpoint', id: el.id }, { p: el.b, kind: 'endpoint', id: el.id });
        break;
      case 'furniture':
        if (opts.faces) points.push({ p: el.position, kind: 'center', id: el.id });
        break;
      default:
        break;
    }
  }
  // Proper crossings between wall location lines (T and X junctions in the middle of walls).
  const intersections: Vec2[] = [];
  for (let i = 0; i < wallSegs.length; i++) {
    for (let j = i + 1; j < wallSegs.length; j++) {
      const s = wallSegs[i];
      const t = wallSegs[j];
      const hit = lineIntersection(s.a, sub(s.b, s.a), t.a, sub(t.b, t.a));
      if (!hit || hit.t < -1e-9 || hit.t > 1 + 1e-9 || hit.u < -1e-9 || hit.u > 1 + 1e-9) continue;
      const atEnds = [s.a, s.b, t.a, t.b].some((q) => distance(q, hit.point) < 1);
      if (!atEnds || (hit.t > 1e-6 && hit.t < 1 - 1e-6) || (hit.u > 1e-6 && hit.u < 1 - 1e-6)) intersections.push(hit.point);
    }
  }
  return { points, segments, intersections };
}

interface TrackLine {
  origin: Vec2;
  dir: Vec2;
  kind: 'alignment' | 'extension';
}

/** Snap a raw model point. */
export function snapPoint(raw: Vec2, scene: SnapScene, o: SnapOptions): SnapResult {
  const tol = Math.max(o.tolerance, EPS);
  const from = o.from;

  // 1. Object points.
  if (o.objects) {
    let best: { p: Vec2; kind: SnapKind; id?: string; score: number } | null = null;
    for (const c of scene.points) {
      const d = distance(raw, c.p);
      if (d > tol) continue;
      const score = d + RANK[c.kind] * tol * 0.35;
      if (!best || score < best.score) best = { p: c.p, kind: c.kind, id: c.id, score };
    }
    for (const p of scene.intersections) {
      const d = distance(raw, p);
      if (d > tol) continue;
      const score = d + RANK.intersection * tol * 0.35;
      if (!best || score < best.score) best = { p, kind: 'intersection', score };
    }
    if (best) return { point: { ...best.p }, kind: best.kind, guides: [], targetId: best.id, angle: from ? angleOf(sub(best.p, from)) : undefined };

    // 2. Perpendicular foot from the previous point.
    if (from) {
      let perp: { p: Vec2; d: number; id?: string } | null = null;
      for (const s of scene.segments) {
        const ab = sub(s.b, s.a);
        const l2 = dot(ab, ab);
        if (l2 < EPS) continue;
        const t = dot(sub(from, s.a), ab) / l2;
        if (t < 0 || t > 1) continue;
        const foot = add(s.a, scale(ab, t));
        if (distance(foot, from) < tol) continue;
        const d = distance(raw, foot);
        if (d <= tol && (!perp || d < perp.d)) perp = { p: foot, d, id: s.id };
      }
      if (perp) return { point: perp.p, kind: 'perpendicular', guides: [{ from, to: perp.p, kind: 'perpendicular' }], targetId: perp.id, angle: angleOf(sub(perp.p, from)) };
    }
  }

  // Tracking lines.
  const lines: TrackLine[] = [];
  if (o.objects) {
    const pts: Vec2[] = [];
    for (const c of scene.points) if (c.kind !== 'midpoint') pts.push(c.p);
    for (const p of o.track ?? []) pts.push(p);
    if (from) pts.push(from);
    let v: { p: Vec2; d: number } | null = null;
    let h: { p: Vec2; d: number } | null = null;
    for (const p of pts) {
      const dx = Math.abs(raw.x - p.x);
      const dy = Math.abs(raw.y - p.y);
      // Ignore the point itself (that is a point snap) and points on top of the cursor in both axes.
      if (dx <= tol && dy > tol && (!v || dx < v.d || (dx === v.d && dy < Math.abs(raw.y - v.p.y)))) v = { p, d: dx };
      if (dy <= tol && dx > tol && (!h || dy < h.d || (dy === h.d && dx < Math.abs(raw.x - h.p.x)))) h = { p, d: dy };
    }
    if (v) lines.push({ origin: v.p, dir: { x: 0, y: 1 }, kind: 'alignment' });
    if (h) lines.push({ origin: h.p, dir: { x: 1, y: 0 }, kind: 'alignment' });
    // Extension of an oblique wall/segment beyond its ends.
    let ext: { line: TrackLine; d: number } | null = null;
    for (const s of scene.segments) {
      const len = distance(s.a, s.b);
      if (len < EPS) continue;
      const dir = normalize(sub(s.b, s.a));
      if (Math.abs(dir.x) < 1e-6 || Math.abs(dir.y) < 1e-6) continue; // axis-aligned: covered by H/V tracking
      const t = dot(sub(raw, s.a), dir);
      if (t >= -tol && t <= len + tol) continue;
      const d = Math.abs(cross(dir, sub(raw, s.a)));
      if (d > tol) continue;
      const origin = t < 0 ? s.a : s.b;
      if (!ext || d < ext.d) ext = { line: { origin, dir, kind: 'extension' }, d };
    }
    if (ext) lines.push(ext.line);
  }

  const guideFor = (l: TrackLine, p: Vec2): SnapGuide => ({ from: l.origin, to: p, kind: l.kind });

  // 3. Angle-constrained placement from the previous point.
  if (from && o.angle) {
    const v = sub(raw, from);
    if (length(v) > EPS) {
      const step = o.angleStep ?? 15;
      const ang = Math.round(angleOf(v) / step) * step;
      const dir = { x: Math.cos((ang * Math.PI) / 180), y: Math.sin((ang * Math.PI) / 180) };
      const cleanDir = { x: Math.abs(dir.x) < 1e-12 ? 0 : dir.x, y: Math.abs(dir.y) < 1e-12 ? 0 : dir.y };
      const along = dot(v, cleanDir);
      const rayGuide = (p: Vec2): SnapGuide => ({ from, to: p, kind: 'angle' });
      // Ray meets a tracking line near the cursor.
      let best: { p: Vec2; d: number; line: TrackLine } | null = null;
      for (const l of lines) {
        const hit = lineIntersection(from, cleanDir, l.origin, l.dir);
        if (!hit || hit.t <= EPS) continue;
        const d = distance(hit.point, raw);
        if (d <= tol * 2 && (!best || d < best.d)) best = { p: hit.point, d, line: l };
      }
      if (best) return { point: best.p, kind: 'alignment', guides: [rayGuide(best.p), guideFor(best.line, best.p)], angle: ang };
      // Ray meets a wall near the cursor.
      if (o.objects) {
        let wall: { p: Vec2; d: number; id?: string } | null = null;
        for (const s of scene.segments) {
          const hit = lineIntersection(from, cleanDir, s.a, sub(s.b, s.a));
          if (!hit || hit.t <= EPS || hit.u < 0 || hit.u > 1) continue;
          const d = distance(hit.point, raw);
          if (d <= tol && (!wall || d < wall.d)) wall = { p: hit.point, d, id: s.id };
        }
        if (wall) return { point: wall.p, kind: 'intersection', guides: [rayGuide(wall.p)], targetId: wall.id, angle: ang };
      }
      const len = o.grid && o.gridSize > 0 ? Math.round(along / o.gridSize) * o.gridSize : along;
      const p = add(from, scale(cleanDir, len));
      return { point: roundPoint(p), kind: 'angle', guides: [rayGuide(add(from, scale(cleanDir, Math.max(len, along))))], angle: ang };
    }
  }

  // 4. Free placement.
  const axisV = lines.find((l) => l.kind === 'alignment' && l.dir.x === 0);
  const axisH = lines.find((l) => l.kind === 'alignment' && l.dir.y === 0);
  if (axisV && axisH) {
    const p = { x: axisV.origin.x, y: axisH.origin.y };
    return { point: p, kind: 'alignment', guides: [guideFor(axisV, p), guideFor(axisH, p)], angle: from ? angleOf(sub(p, from)) : undefined };
  }
  if (o.objects) {
    let near: { p: Vec2; d: number; s: SnapSegment } | null = null;
    for (const s of scene.segments) {
      const c = closestOnSegment(raw, s.a, s.b);
      if (c.distance <= tol && (!near || c.distance < near.d)) near = { p: c.point, d: c.distance, s };
    }
    if (near) {
      const n = near;
      for (const l of lines) {
        const hit = lineIntersection(n.s.a, sub(n.s.b, n.s.a), l.origin, l.dir);
        if (hit && hit.t >= 0 && hit.t <= 1 && distance(hit.point, raw) <= tol * 1.5) {
          return { point: hit.point, kind: 'alignment', guides: [guideFor(l, hit.point)], targetId: n.s.id, angle: from ? angleOf(sub(hit.point, from)) : undefined };
        }
      }
      return { point: n.p, kind: 'nearest', guides: [], targetId: n.s.id, angle: from ? angleOf(sub(n.p, from)) : undefined };
    }
  }
  if (lines.length) {
    const l = lines[0];
    let t = dot(sub(raw, l.origin), l.dir);
    if (o.grid && o.gridSize > 0) {
      if (l.kind === 'alignment') {
        // Keep the free coordinate on the grid.
        const coord = l.dir.x === 0 ? raw.y : raw.x;
        const snapped = Math.round(coord / o.gridSize) * o.gridSize;
        t = snapped - (l.dir.x === 0 ? l.origin.y : l.origin.x);
      } else t = Math.round(t / o.gridSize) * o.gridSize;
    }
    const p = add(l.origin, scale(l.dir, t));
    return { point: roundPoint(p), kind: l.kind, guides: [guideFor(l, p)], angle: from ? angleOf(sub(p, from)) : undefined };
  }
  if (o.grid && o.gridSize > 0) {
    const p = snapToGrid(raw, o.gridSize);
    return { point: p, kind: 'grid', guides: [], angle: from ? angleOf(sub(p, from)) : undefined };
  }
  return { point: { ...raw }, kind: 'none', guides: [], angle: from ? angleOf(sub(raw, from)) : undefined };
}

function angleOf(v: Vec2): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

/** Remove floating-point dust (1e-9 mm) so typed/snapped values stay exact. */
function roundPoint(p: Vec2): Vec2 {
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  return { x: r(p.x), y: r(p.y) };
}
