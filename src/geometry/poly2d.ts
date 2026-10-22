/**
 * 2D polygon helpers for the geometry builders: triangulation with holes, half-plane clipping,
 * miter offsets, line chords and a robust rectilinear "rectangle minus rectangles" boolean used
 * to cut openings out of wall faces.
 */
import { ShapeUtils, Vector2 } from 'three';
import { lineIntersection, normalize, perp, signedArea, sub } from '../core/math2d';
import type { Vec2 } from '../core/types';

export type Tri = [number, number, number];

export interface PolygonWithHoles {
  /** Counter-clockwise outer boundary. */
  outer: Vec2[];
  /** Clockwise holes. */
  holes: Vec2[][];
}

/** Points closer than this (model mm) are merged before triangulating. */
const WELD_EPS = 1e-4;

const near = (a: Vec2, b: Vec2, eps: number) => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

/** Drop consecutive duplicate points (and a duplicated closing point). */
export function dedupe(poly: Vec2[], eps = 1e-6): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) if (!out.length || !near(out[out.length - 1], p, eps)) out.push(p);
  while (out.length > 1 && near(out[0], out[out.length - 1], eps)) out.pop();
  return out;
}

/**
 * Triangulate a simple polygon with holes. Triangles index into `points` (= outer then holes)
 * and are always wound counter-clockwise in 2D.
 */
export function triangulate(outer: Vec2[], holes: Vec2[][] = []): { points: Vec2[]; tris: Tri[] } {
  const o = dedupe(outer, WELD_EPS);
  if (o.length < 3 || Math.abs(signedArea(o)) < 1e-9) return { points: [], tris: [] };
  const hs = holes.map((h) => dedupe(h, WELD_EPS)).filter((h) => h.length >= 3 && Math.abs(signedArea(h)) > 1e-9);
  const points = [...o, ...hs.flat()];
  let faces: number[][];
  if (o.length === 3 && !hs.length) faces = [[0, 1, 2]];
  else if (o.length === 4 && !hs.length && isConvex(o)) faces = [
    [0, 1, 2],
    [0, 2, 3],
  ];
  else
    faces = ShapeUtils.triangulateShape(
      o.map((p) => new Vector2(p.x, p.y)),
      hs.map((h) => h.map((p) => new Vector2(p.x, p.y))),
    );
  const tris: Tri[] = [];
  for (const f of faces) {
    const a = points[f[0]];
    const b = points[f[1]];
    const c = points[f[2]];
    const cr = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    tris.push(cr >= 0 ? [f[0], f[1], f[2]] : [f[0], f[2], f[1]]);
  }
  return { points, tris: points.length > 4 ? splitTJunctions(points, tris) : tris };
}

/**
 * Earcut may emit triangle edges that run through other vertices of the polygon (collinear hole
 * edges, e.g. two windows sharing a sill height). Split such triangles at those vertices so the
 * triangulation is conforming and the mesh stays watertight against neighbouring faces.
 */
function splitTJunctions(points: Vec2[], tris: Tri[]): Tri[] {
  const out: Tri[] = [];
  const queue = tris.slice();
  // Each split strictly shrinks a triangle, so this bound is never reached on sane input; if it is,
  // keep the remaining triangles unsplit rather than dropping them.
  let budget = 64 * tris.length + 1024;
  while (queue.length) {
    const t = queue.pop()!;
    if (budget-- <= 0) {
      out.push(t);
      continue;
    }
    let split = false;
    for (let e = 0; e < 3 && !split; e++) {
      const ia = t[e];
      const ib = t[(e + 1) % 3];
      const ic = t[(e + 2) % 3];
      const a = points[ia];
      const b = points[ib];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      if (l2 < 4 * WELD_EPS * WELD_EPS) continue;
      const len = Math.sqrt(l2);
      for (let k = 0; k < points.length; k++) {
        if (k === ia || k === ib || k === ic) continue;
        const p = points[k];
        // Strictly between a and b (by more than the weld tolerance) and on the edge line.
        const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
        if (along <= WELD_EPS || along >= len - WELD_EPS) continue;
        const off = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
        if (off > Math.min(WELD_EPS, 1e-7 * len)) continue;
        // Same winding as (a, b, c): (a, p, c) and (p, b, c).
        queue.push([ia, k, ic], [k, ib, ic]);
        split = true;
        break;
      }
    }
    if (!split) out.push(t);
  }
  return out;
}

export function isConvex(poly: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-12) continue;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Keep the part of `poly` where a·x + b·y + c ≥ 0 (Sutherland–Hodgman). */
export function clipHalfPlane(poly: Vec2[], a: number, b: number, c: number): Vec2[] {
  const out: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const fp = a * p.x + b * p.y + c;
    const fq = a * q.x + b * q.y + c;
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return dedupe(out, 1e-9);
}

/** Clip a polygon to x ∈ [x0, x1]. */
export function clipSlabX(poly: Vec2[], x0: number, x1: number): Vec2[] {
  const a = clipHalfPlane(poly, 1, 0, -x0);
  return a.length >= 3 ? clipHalfPlane(a, -1, 0, x1) : [];
}

/** Clip a polygon against a convex CCW polygon. */
export function clipConvex(poly: Vec2[], convex: Vec2[]): Vec2[] {
  let out = poly;
  for (let i = 0, n = convex.length; i < n && out.length >= 3; i++) {
    const p = convex[i];
    const q = convex[(i + 1) % n];
    // Inside = left of p→q.
    const a = -(q.y - p.y);
    const b = q.x - p.x;
    out = clipHalfPlane(out, a, b, -(a * p.x + b * p.y));
  }
  return out.length >= 3 ? out : [];
}

/** Intervals of y where the vertical line x = c crosses the polygon interior (sorted, merged). */
export function chordAtX(poly: Vec2[], c: number): [number, number][] {
  const ys: number[] = [];
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    if ((p.x <= c && q.x > c) || (q.x <= c && p.x > c)) {
      const t = (c - p.x) / (q.x - p.x);
      ys.push(p.y + (q.y - p.y) * t);
    }
  }
  ys.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i + 1] - ys[i] > 1e-6) out.push([ys[i], ys[i + 1]]);
  return out;
}

/**
 * Miter offset of a CCW polygon: positive `d` grows it, negative shrinks it. Corners sharper than
 * the miter limit are clamped so spikes stay bounded.
 */
export function offsetPolygon(poly: Vec2[], d: number): Vec2[] {
  const p = dedupe(poly);
  const n = p.length;
  if (n < 3 || Math.abs(d) < 1e-9) return p;
  const ccw = signedArea(p) > 0 ? p : [...p].reverse();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ccw[(i + n - 1) % n];
    const b = ccw[i];
    const c = ccw[(i + 1) % n];
    // Outward normal of a CCW edge is to the right: -perp(dir).
    const n1 = perp(normalize(sub(b, a)));
    const n2 = perp(normalize(sub(c, b)));
    const pa = { x: a.x - n1.x * d, y: a.y - n1.y * d };
    const pb = { x: b.x - n2.x * d, y: b.y - n2.y * d };
    const hit = lineIntersection(pa, sub(b, a), pb, sub(c, b));
    const fallback = { x: b.x - ((n1.x + n2.x) / 2) * d, y: b.y - ((n1.y + n2.y) / 2) * d };
    if (!hit) out.push(fallback);
    else {
      const dx = hit.point.x - b.x;
      const dy = hit.point.y - b.y;
      out.push(Math.hypot(dx, dy) > 4 * Math.abs(d) ? fallback : hit.point);
    }
  }
  return out;
}

/** Points of an axis-aligned ellipse, CCW, `n` segments. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, n: number, phase = 0): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

/** CCW rectangle with rounded corners (`seg` segments per corner; 1 = chamfer). */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number, seg = 3): Vec2[] {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2 - 1e-6, (y1 - y0) / 2 - 1e-6));
  if (rr <= 1e-6 || seg < 1)
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  const corners: [number, number, number][] = [
    [x1 - rr, y0 + rr, -90],
    [x1 - rr, y1 - rr, 0],
    [x0 + rr, y1 - rr, 90],
    [x0 + rr, y0 + rr, 180],
  ];
  const out: Vec2[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = ((a0 + (90 * i) / seg) * Math.PI) / 180;
      out.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
  }
  return dedupe(out, WELD_EPS * 10);
}

// -----------------------------------------------------------------------------
// Rectilinear boolean: rectangle minus a union of axis-aligned rectangles.
// -----------------------------------------------------------------------------

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface RectRegion {
  /** Boundary loops with the solid on the LEFT (outer loops CCW, hole loops CW), collinear points merged. */
  loops: Vec2[][];
  polygons: PolygonWithHoles[];
}

const GRID_EPS = 1e-4;

function breakpoints(values: number[], lo: number, hi: number): number[] {
  const sorted = values.map((v) => Math.min(hi, Math.max(lo, v))).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > GRID_EPS) out.push(v);
  // Snap the ends exactly onto the bounds.
  out[0] = lo;
  if (hi - out[out.length - 1] <= GRID_EPS) out[out.length - 1] = hi;
  else out.push(hi);
  return out;
}

/**
 * Region = [bounds] minus ∪holes, returned as boundary loops and polygons-with-holes. Holes are
 * clipped to the bounds; holes touching the boundary become notches. Deterministic and exact on
 * the input coordinates (no epsilon offsets).
 */
export function rectRegion(bounds: Rect, holes: Rect[]): RectRegion {
  const { x0, x1, y0, y1 } = bounds;
  if (!(x1 - x0 > GRID_EPS && y1 - y0 > GRID_EPS)) return { loops: [], polygons: [] };
  const hs = holes
    .map((h) => ({ x0: Math.max(x0, h.x0), x1: Math.min(x1, h.x1), y0: Math.max(y0, h.y0), y1: Math.min(y1, h.y1) }))
    .filter((h) => h.x1 - h.x0 > GRID_EPS && h.y1 - h.y0 > GRID_EPS);
  if (!hs.length) {
    const outer = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    return { loops: [outer], polygons: [{ outer, holes: [] }] };
  }
  const xs = breakpoints([x0, x1, ...hs.flatMap((h) => [h.x0, h.x1])], x0, x1);
  const ys = breakpoints([y0, y1, ...hs.flatMap((h) => [h.y0, h.y1])], y0, y1);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const solid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const cy = (ys[j] + ys[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      solid[j * nx + i] = hs.some((h) => cx > h.x0 && cx < h.x1 && cy > h.y0 && cy < h.y1) ? 0 : 1;
    }
  }
  const isSolid = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && solid[j * nx + i] === 1;

  // Directed boundary edges between grid vertices (vertex id = j * (nx + 1) + i), solid on the left.
  const vid = (i: number, j: number) => j * (nx + 1) + i;
  const outgoing = new Map<number, number[]>();
  const edges: [number, number][] = [];
  const addEdge = (a: number, b: number) => {
    const k = edges.length;
    edges.push([a, b]);
    const list = outgoing.get(a);
    if (list) list.push(k);
    else outgoing.set(a, [k]);
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!isSolid(i, j)) continue;
      if (!isSolid(i, j - 1)) addEdge(vid(i, j), vid(i + 1, j));
      if (!isSolid(i + 1, j)) addEdge(vid(i + 1, j), vid(i + 1, j + 1));
      if (!isSolid(i, j + 1)) addEdge(vid(i + 1, j + 1), vid(i, j + 1));
      if (!isSolid(i - 1, j)) addEdge(vid(i, j + 1), vid(i, j));
    }
  }
  const vx = (v: number) => xs[v % (nx + 1)];
  const vy = (v: number) => ys[Math.floor(v / (nx + 1))];
  const dirOf = (k: number): [number, number] => {
    const [a, b] = edges[k];
    return [Math.sign(vx(b) - vx(a)), Math.sign(vy(b) - vy(a))];
  };
  const used = new Uint8Array(edges.length);
  const loops: Vec2[][] = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const verts: number[] = [];
    let k = s;
    let guard = 0;
    while (!used[k] && guard++ < edges.length + 1) {
      used[k] = 1;
      verts.push(edges[k][0]);
      const [dx, dy] = dirOf(k);
      // The loop's first edge stays a candidate so a loop closes before wandering into a neighbour
      // touching it at a pinch vertex.
      const cands = (outgoing.get(edges[k][1]) ?? []).filter((c) => !used[c] || c === s);
      if (!cands.length) break;
      // Prefer the sharpest left turn so loops that touch at a vertex stay separate.
      let best = cands[0];
      let bestScore = -Infinity;
      for (const c of cands) {
        const [ex, ey] = dirOf(c);
        const turn = dx * ey - dy * ex; // +1 left, 0 straight, -1 right
        const score = turn * 2 + (dx * ex + dy * ey);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      if (best === s) break;
      k = best;
    }
    const pts = mergeCollinear(verts.map((v) => ({ x: vx(v), y: vy(v) })));
    if (pts.length >= 3) loops.push(pts);
  }
  return { loops, polygons: groupLoops(loops) };
}

function mergeCollinear(pts: Vec2[]): Vec2[] {
  const p = dedupe(pts, 1e-9);
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length];
      const b = p[i];
      const c = p[(i + 1) % p.length];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const dt = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
      if (Math.abs(cr) < 1e-9 && dt > 0) {
        p.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return p;
}

/** Assign hole loops (CW) to the smallest outer loop (CCW) that contains them. */
export function groupLoops(loops: Vec2[][]): PolygonWithHoles[] {
  const outers = loops.filter((l) => signedArea(l) > 0).map((outer) => ({ outer, holes: [] as Vec2[][], area: signedArea(outer) }));
  for (const l of loops) {
    if (signedArea(l) >= 0) continue;
    // A point just to the left of the first edge lies in the solid around the hole.
    const a = l[0];
    const b = l[1];
    const d = normalize(sub(b, a));
    const n = perp(d);
    const probe = { x: (a.x + b.x) / 2 + n.x * 1e-3, y: (a.y + b.y) / 2 + n.y * 1e-3 };
    let best: (typeof outers)[number] | undefined;
    for (const o of outers) if (pointInPoly(probe, o.outer) && (!best || o.area < best.area)) best = o;
    best?.holes.push(l);
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}

function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
