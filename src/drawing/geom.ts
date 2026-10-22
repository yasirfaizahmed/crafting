/**
 * 2D geometry helpers for drawing generation: segment/polygon clipping, half-plane clipping,
 * polygon offsetting, outline union of abutting polygons and segment chaining.
 */
import { add, cross, distance, dot, lerp, normalize, perp, pointInPolygon, scale, signedArea, sub } from '../core/math2d';
import type { Vec2 } from '../core/types';

export type Segment = [Vec2, Vec2];

/** Even-odd inside test over a set of rings (outline + holes, or any ring soup). */
export function insideEvenOdd(p: Vec2, rings: Vec2[][]): boolean {
  let inside = false;
  for (const r of rings) if (r.length >= 3 && pointInPolygon(p, r)) inside = !inside;
  return inside;
}

/** Parameter intervals [t0, t1] ⊂ [0, 1] of segment a→b that lie inside `rings` (even-odd). */
export function clipSegmentToRings(a: Vec2, b: Vec2, rings: Vec2[][]): [number, number][] {
  const d = sub(b, a);
  const ts = [0, 1];
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const p = ring[i];
      const e = sub(ring[(i + 1) % n], p);
      const den = cross(d, e);
      if (Math.abs(den) < 1e-12) continue;
      const w = sub(p, a);
      const t = cross(w, e) / den;
      const u = cross(w, d) / den;
      if (u >= -1e-9 && u <= 1 + 1e-9 && t > 0 && t < 1) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i];
    const t1 = ts[i + 1];
    if (t1 - t0 < 1e-9) continue;
    if (!insideEvenOdd(lerp(a, b, (t0 + t1) / 2), rings)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] - t0) < 1e-9) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

/** Sub-segments of a→b inside (or, with `outside`, outside) the rings. */
export function clipSegment(a: Vec2, b: Vec2, rings: Vec2[][], outside = false): Segment[] {
  const inside = clipSegmentToRings(a, b, rings);
  const ivs: [number, number][] = [];
  if (!outside) ivs.push(...inside);
  else {
    let t = 0;
    for (const [t0, t1] of inside) {
      if (t0 > t + 1e-9) ivs.push([t, t0]);
      t = t1;
    }
    if (t < 1 - 1e-9) ivs.push([t, 1]);
  }
  return ivs.map(([t0, t1]) => [lerp(a, b, t0), lerp(a, b, t1)]);
}

/** Sutherland–Hodgman clip of a polygon to the half-plane dot(p − origin, normal) ≥ 0. */
export function clipPolygonHalfPlane(poly: Vec2[], origin: Vec2, normal: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const side = (p: Vec2) => dot(sub(p, origin), normal);
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) out.push(lerp(p, q, sp / (sp - sq)));
  }
  return dedupe(out);
}

/** Polygon restricted to the strip lo ≤ dot(p − origin, dir) ≤ hi (either bound may be infinite). */
export function clipPolygonStrip(poly: Vec2[], origin: Vec2, dir: Vec2, lo: number, hi: number): Vec2[] {
  let out = poly;
  if (Number.isFinite(lo)) out = clipPolygonHalfPlane(out, add(origin, scale(dir, lo)), dir);
  if (Number.isFinite(hi) && out.length) out = clipPolygonHalfPlane(out, add(origin, scale(dir, hi)), scale(dir, -1));
  return out;
}

function dedupe(poly: Vec2[], eps = 1e-6): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) if (!out.length || distance(out[out.length - 1], p) > eps) out.push(p);
  if (out.length > 1 && distance(out[0], out[out.length - 1]) <= eps) out.pop();
  return out;
}

/** Offset a simple polygon outward by `d` (negative = inward), mitring corners. */
export function offsetPolygon(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  if (n < 3 || d === 0) return poly.slice();
  const ccw = signedArea(poly) > 0;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const dir = normalize(sub(q, p));
    // Outward normal: right of the edge for CCW polygons, left for CW ones.
    const nrm = ccw ? { x: dir.y, y: -dir.x } : perp(dir);
    return { p: add(p, scale(nrm, d)), dir };
  });
  return lines.map((cur, i) => {
    const prev = lines[(i + n - 1) % n];
    const den = cross(prev.dir, cur.dir);
    if (Math.abs(den) < 1e-9) return cur.p;
    const t = cross(sub(cur.p, prev.p), cur.dir) / den;
    return add(prev.p, scale(prev.dir, t));
  });
}

export interface UnionPolygon {
  polygon: Vec2[];
  /** Polygons with different keys keep a thin "seam" line where they touch (material change). */
  key?: string;
}

/**
 * Boundary of the union of abutting/overlapping polygons, as segments: every polygon edge is split
 * where other polygons touch it, and pieces whose outside neighbourhood lies inside another polygon
 * are dropped (internal joints). Internal pieces between polygons of different keys are returned as
 * `seams`.
 */
export function unionOutline(polys: UnionPolygon[], probe = 0.5): { outline: Segment[]; seams: Segment[] } {
  const outline: Segment[] = [];
  const seams: Segment[] = [];
  const boxes = polys.map((p) => bbox(p.polygon));
  polys.forEach((P, i) => {
    const poly = P.polygon;
    const n = poly.length;
    if (n < 3) return;
    const ccw = signedArea(poly) > 0;
    for (let k = 0; k < n; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % n];
      const d = sub(b, a);
      const len = Math.hypot(d.x, d.y);
      if (len < 1e-6) continue;
      const u = scale(d, 1 / len);
      const out = ccw ? { x: u.y, y: -u.x } : perp(u);
      const ts = [0, 1];
      const others: number[] = [];
      for (let j = 0; j < polys.length; j++) {
        if (j === i || !overlaps(boxes[j], segBox(a, b), probe * 2)) continue;
        others.push(j);
        const Q = polys[j].polygon;
        for (let m = 0; m < Q.length; m++) {
          const c = Q[m];
          const e = sub(Q[(m + 1) % Q.length], c);
          const den = cross(d, e);
          const w = sub(c, a);
          if (Math.abs(den) > 1e-9) {
            const t = cross(w, e) / den;
            const s = cross(w, d) / den;
            if (s >= -1e-9 && s <= 1 + 1e-9 && t > 0 && t < 1) ts.push(t);
          }
          // Vertices lying on the edge (collinear overlaps, T junctions).
          const lat = Math.abs(cross(u, w));
          if (lat < 0.05) {
            const t = dot(w, u) / len;
            if (t > 0 && t < 1) ts.push(t);
          }
        }
      }
      ts.sort((x, y) => x - y);
      for (let q = 0; q + 1 < ts.length; q++) {
        const t0 = ts[q];
        const t1 = ts[q + 1];
        if ((t1 - t0) * len < 0.01) continue;
        const mid = add(lerp(a, b, (t0 + t1) / 2), scale(out, probe));
        const hit = others.find((j) => pointInPolygon(mid, polys[j].polygon));
        const seg: Segment = [lerp(a, b, t0), lerp(a, b, t1)];
        if (hit === undefined) outline.push(seg);
        else if (i < hit && polys[hit].key !== P.key) seams.push(seg);
      }
    }
  });
  return { outline, seams };
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bbox(poly: Vec2[]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of poly) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

const segBox = (a: Vec2, b: Vec2): Box => ({ minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) });

const overlaps = (a: Box, b: Box, pad: number): boolean =>
  a.minX <= b.maxX + pad && b.minX <= a.maxX + pad && a.minY <= b.maxY + pad && b.minY <= a.maxY + pad;

export interface Chain {
  points: Vec2[];
  closed: boolean;
}

/**
 * Join segments sharing endpoints (within `tol`) into polylines, merging collinear runs.
 * Branching points end a chain; the remaining segments start new chains.
 */
export function chainSegments(segs: Segment[], tol = 0.05): Chain[] {
  const key = (p: Vec2) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const adj = new Map<string, number[]>();
  const live = segs.filter((s) => distance(s[0], s[1]) > tol);
  live.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const l = adj.get(k);
      if (l) l.push(i);
      else adj.set(k, [i]);
    }
  });
  const used = new Uint8Array(live.length);
  const next = (p: Vec2): number | undefined => {
    const l = adj.get(key(p));
    if (!l || l.length !== 2) return undefined;
    return l.find((i) => !used[i]);
  };
  const chains: Chain[] = [];
  // Start from endpoints of open chains (degree ≠ 2) first, then loops.
  const order = live.map((_, i) => i).sort((x, y) => degreeScore(adj, key, live[y]) - degreeScore(adj, key, live[x]));
  for (const start of order) {
    if (used[start]) continue;
    used[start] = 1;
    const s = live[start];
    let pts: Vec2[] = [s[0], s[1]];
    // Extend forward then backward.
    for (const dirn of [1, -1] as const) {
      for (;;) {
        const end = dirn === 1 ? pts[pts.length - 1] : pts[0];
        const i = next(end);
        if (i === undefined) break;
        used[i] = 1;
        const seg = live[i];
        const other = key(seg[0]) === key(end) ? seg[1] : seg[0];
        if (dirn === 1) pts.push(other);
        else pts.unshift(other);
      }
    }
    let closed = false;
    if (pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1])) {
      closed = true;
      pts = pts.slice(0, -1);
    }
    chains.push({ points: simplifyChain(pts, closed), closed });
  }
  return chains;
}

function degreeScore(adj: Map<string, number[]>, key: (p: Vec2) => string, s: Segment): number {
  // Higher score = should start first (an endpoint with degree ≠ 2).
  return (adj.get(key(s[0]))?.length === 2 ? 0 : 1) + (adj.get(key(s[1]))?.length === 2 ? 0 : 1);
}

/** Drop vertices that lie on the straight line between their neighbours. */
export function simplifyChain(pts: Vec2[], closed: boolean, eps = 0.01): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(pts[i]);
      continue;
    }
    const a = pts[(i + n - 1) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const ab = sub(b, a);
    const bc = sub(c, b);
    const l = Math.hypot(ab.x, ab.y) * Math.hypot(bc.x, bc.y);
    if (l > 0 && Math.abs(cross(ab, bc)) / Math.sqrt(l) < eps && dot(ab, bc) > 0) continue;
    out.push(b);
  }
  return out;
}

/** Points of a circular arc (degrees CCW, start → end CCW) as a polyline. */
export function arcPoints(c: Vec2, r: number, startDeg: number, endDeg: number, maxStepDeg = 5): Vec2[] {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  while (sweep > 360) sweep -= 360;
  const n = Math.max(2, Math.ceil(sweep / maxStepDeg));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((startDeg + (sweep * i) / n) * Math.PI) / 180;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

/** Closed circle/ellipse polygon. */
export function ellipsePoints(c: Vec2, rx: number, ry: number, segments = 48): Vec2[] {
  return Array.from({ length: segments }, (_, i) => {
    const a = (i / segments) * Math.PI * 2;
    return { x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) };
  });
}
