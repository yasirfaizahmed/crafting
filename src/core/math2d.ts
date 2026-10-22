import type { Vec2 } from './types';

export const EPS = 1e-6;

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const equals = (a: Vec2, b: Vec2, eps = 0.5): boolean => Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular (rotate +90°). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function rotate(p: Vec2, deg: number, origin: Vec2 = { x: 0, y: 0 }): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}

export const degToRad = (d: number): number => (d * Math.PI) / 180;
export const radToDeg = (r: number): number => (r * 180) / Math.PI;

/** Angle of vector in degrees CCW from +x, in (-180, 180]. */
export const angleDeg = (a: Vec2): number => radToDeg(Math.atan2(a.y, a.x));

export const dirFromDeg = (deg: number): Vec2 => ({ x: Math.cos(degToRad(deg)), y: Math.sin(degToRad(deg)) });

export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

export function snapPoint(p: Vec2, step: number): Vec2 {
  return { x: snap(p.x, step), y: snap(p.y, step) };
}

/** Signed area, positive for counter-clockwise polygons. */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const polygonArea = (poly: Vec2[]): number => Math.abs(signedArea(poly));

export function polygonPerimeter(poly: Vec2[]): number {
  let l = 0;
  for (let i = 0, n = poly.length; i < n; i++) l += distance(poly[i], poly[(i + 1) % n]);
  return l;
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

export function centroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return scale(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBounds(): Bounds2 {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBounds(b: Bounds2, p: Vec2): Bounds2 {
  b.minX = Math.min(b.minX, p.x);
  b.minY = Math.min(b.minY, p.y);
  b.maxX = Math.max(b.maxX, p.x);
  b.maxY = Math.max(b.maxY, p.y);
  return b;
}

export function boundsOf(points: Vec2[]): Bounds2 {
  const b = emptyBounds();
  for (const p of points) extendBounds(b, p);
  return b;
}

export const isEmptyBounds = (b: Bounds2): boolean => !(b.minX <= b.maxX && b.minY <= b.maxY);

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; distance: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = lerp(a, b, t);
  return { point, t, distance: distance(p, point) };
}

/** Intersection of infinite lines p1 + t*d1 and p2 + u*d2. Returns null for parallel lines. */
export function lineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): { point: Vec2; t: number; u: number } | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(p2, p1);
  const t = cross(w, d2) / den;
  const u = cross(w, d1) / den;
  return { point: add(p1, scale(d1, t)), t, u };
}

/** Proper or touching intersection of segments ab and cd. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): { point: Vec2; t: number; u: number } | null {
  const r = lineIntersection(a, sub(b, a), c, sub(d, c));
  if (!r) return null;
  const e = 1e-9;
  if (r.t < -e || r.t > 1 + e || r.u < -e || r.u > 1 + e) return null;
  return r;
}

/** Offset a polyline/polygon edge set is outside the scope here; see geometry module. */
export function rectPolygon(minX: number, minY: number, maxX: number, maxY: number): Vec2[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Oriented rectangle centred on c, size w×d, rotated by deg. CCW. */
export function orientedRect(c: Vec2, w: number, d: number, deg: number): Vec2[] {
  const hw = w / 2;
  const hd = d / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => add(rotate(p, deg), c));
}

/** Remove consecutive duplicates and collinear vertices. */
export function simplifyPolygon(poly: Vec2[], eps = 0.5): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) if (!out.length || !equals(out[out.length - 1], p, eps)) out.push(p);
  if (out.length > 1 && equals(out[0], out[out.length - 1], eps)) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const ab = sub(b, a);
      const bc = sub(c, b);
      if (Math.abs(cross(normalize(ab), normalize(bc))) < 1e-6 && dot(ab, bc) > 0) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}
