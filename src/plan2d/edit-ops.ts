/**
 * Pure editing operations used by the plan tools. Each returns a patch (id → new element value)
 * that tools show as a live preview and commit inside one transaction.
 */
import { add, cross, distance, dot, EPS, lineIntersection, normalize, rotate, sub } from '../core/math2d';
import type { Element, Opening, Vec2, Wall } from '../core/types';
import { JOIN_TOLERANCE, projectOntoWall, pointAtOffset, wallDirection, wallLength } from '../core/walls';

export type Patch = Map<string, Element>;
type Elements = Record<string, Element>;

const movePt = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** Translate an element by `d`. Openings are returned unchanged (they follow their host wall). */
export function translated<T extends Element>(el: T, d: Vec2): T {
  const e = el as Element;
  switch (e.type) {
    case 'wall':
    case 'beam':
      return { ...e, start: movePt(e.start, d), end: movePt(e.end, d) } as T;
    case 'dimension':
      return { ...e, a: movePt(e.a, d), b: movePt(e.b, d) } as T;
    case 'slab':
      return { ...e, outline: e.outline.map((p) => movePt(p, d)), holes: e.holes?.map((h) => h.map((p) => movePt(p, d))) } as T;
    case 'room':
    case 'roof':
      return { ...e, outline: e.outline.map((p) => movePt(p, d)) } as T;
    case 'railing':
      return { ...e, path: e.path.map((p) => movePt(p, d)) } as T;
    case 'block':
      return { ...e, position: { ...e.position, x: e.position.x + d.x, y: e.position.y + d.y } } as T;
    case 'stair':
    case 'column':
    case 'furniture':
    case 'label':
      return { ...e, position: movePt(e.position, d) } as T;
    default:
      return el;
  }
}

/** Rotate an element by `deg` about `pivot` (default: its own reference point). */
export function rotated<T extends Element>(el: T, deg: number, pivot?: Vec2): T {
  const e = el as Element;
  const r = (p: Vec2) => (pivot ? rotate(p, deg, pivot) : p);
  const norm = (a: number) => {
    const v = ((a % 360) + 360) % 360;
    return Math.round(v * 1e6) / 1e6;
  };
  switch (e.type) {
    case 'stair':
    case 'column':
    case 'furniture':
    case 'label':
      return { ...e, position: r(e.position), rotation: norm(e.rotation + deg) } as T;
    case 'block': {
      const p = r({ x: e.position.x, y: e.position.y });
      return { ...e, position: { ...e.position, x: p.x, y: p.y }, rotation: norm(e.rotation + deg) } as T;
    }
    case 'wall':
    case 'beam': {
      const c = pivot ?? { x: (e.start.x + e.end.x) / 2, y: (e.start.y + e.end.y) / 2 };
      return { ...e, start: rotate(e.start, deg, c), end: rotate(e.end, deg, c) } as T;
    }
    case 'dimension': {
      const c = pivot ?? { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      return { ...e, a: rotate(e.a, deg, c), b: rotate(e.b, deg, c) } as T;
    }
    case 'room':
    case 'roof':
    case 'slab': {
      const c = pivot ?? centroidOf(e.outline);
      const out = { ...e, outline: e.outline.map((p) => rotate(p, deg, c)) } as Element;
      if (out.type === 'slab' && e.type === 'slab' && e.holes) out.holes = e.holes.map((h) => h.map((p) => rotate(p, deg, c)));
      if (out.type === 'roof') out.ridgeAngle = norm(out.ridgeAngle + deg);
      return out as T;
    }
    case 'railing': {
      const c = pivot ?? centroidOf(e.path);
      return { ...e, path: e.path.map((p) => rotate(p, deg, c)) } as T;
    }
    default:
      return el;
  }
}

function centroidOf(pts: Vec2[]): Vec2 {
  const s = pts.reduce((a, p) => add(a, p), { x: 0, y: 0 });
  return { x: s.x / Math.max(1, pts.length), y: s.y / Math.max(1, pts.length) };
}

function openingsOf(elements: Elements, wallId: string): Opening[] {
  return Object.values(elements).filter((e): e is Opening => (e.type === 'door' || e.type === 'window') && e.hostId === wallId);
}

/** Keep hosted openings at the same absolute position when a wall's location line changes. */
export function fixOpenings(elements: Elements, before: Wall, after: Wall, patch: Patch): void {
  const len = wallLength(after);
  for (const op of openingsOf(elements, before.id)) {
    const cur = (patch.get(op.id) as Opening | undefined) ?? op;
    const abs = pointAtOffset(before, cur.offset);
    let offset = projectOntoWall(after, abs).offset;
    if (len >= cur.width) offset = Math.min(Math.max(offset, cur.width / 2), len - cur.width / 2);
    offset = Math.round(offset * 1000) / 1000;
    if (Math.abs(offset - cur.offset) > 1e-6) patch.set(op.id, { ...cur, offset });
  }
}

/** True if `p` lies on the interior of the wall's location line (T junction). */
function onWallInterior(p: Vec2, w: Wall): boolean {
  const len = wallLength(w);
  if (len < EPS) return false;
  const pr = projectOntoWall(w, p);
  return pr.offset > JOIN_TOLERANCE && pr.offset < len - JOIN_TOLERANCE && Math.abs(pr.lateral) <= JOIN_TOLERANCE;
}

/** Re-attach `p` (an end of `w` that was T-joined to `hostBefore`) to `hostAfter`'s location line. */
function reattach(p: Vec2, w: Wall, hostAfter: Wall): Vec2 | null {
  const d = wallDirection(w);
  const hd = wallDirection(hostAfter);
  const hit = lineIntersection(p, d, hostAfter.start, hd);
  if (!hit) return null;
  const len = wallLength(hostAfter);
  if (hit.u < -JOIN_TOLERANCE || hit.u > len + JOIN_TOLERANCE) return null;
  return hit.point;
}

function setWallEnds(elements: Elements, patch: Patch, w: Wall, start: Vec2, end: Vec2): void {
  const base = (patch.get(w.id) as Wall | undefined) ?? w;
  if (distance(base.start, start) < 1e-9 && distance(base.end, end) < 1e-9) return;
  const next: Wall = { ...base, start, end };
  patch.set(w.id, next);
  fixOpenings(elements, w, next, patch);
}

/**
 * Move elements by `d`. Walls joined to moved walls are stretched so joins stay closed (shared
 * endpoints move along; T-joined ends slide to stay on the moved wall). Openings selected without
 * their host slide along it instead.
 */
export function moveElements(elements: Elements, ids: string[], d: Vec2): Patch {
  const patch: Patch = new Map();
  const sel = new Set(ids);
  const movedWalls: Wall[] = [];
  for (const id of ids) {
    const el = elements[id];
    if (!el || el.locked) continue;
    if (el.type === 'door' || el.type === 'window') {
      if (sel.has(el.hostId)) continue;
      const host = elements[el.hostId];
      if (host?.type !== 'wall') continue;
      const len = wallLength(host);
      const along = dot(d, wallDirection(host));
      const offset = Math.min(Math.max(el.offset + along, el.width / 2), Math.max(el.width / 2, len - el.width / 2));
      patch.set(id, { ...el, offset });
      continue;
    }
    patch.set(id, translated(el, d));
    if (el.type === 'wall') movedWalls.push(el);
  }
  if (!movedWalls.length) return patch;
  const level = movedWalls[0].levelId;
  for (const w of Object.values(elements)) {
    if (w.type !== 'wall' || sel.has(w.id) || w.locked || w.levelId !== level) continue;
    let start = w.start;
    let end = w.end;
    for (const which of ['start', 'end'] as const) {
      const p = w[which];
      let np: Vec2 | null = null;
      if (movedWalls.some((m) => distance(m.start, p) <= JOIN_TOLERANCE || distance(m.end, p) <= JOIN_TOLERANCE)) np = movePt(p, d);
      else {
        const host = movedWalls.find((m) => onWallInterior(p, m));
        if (host) np = reattach(p, w, translated(host, d));
      }
      if (np) {
        if (which === 'start') start = np;
        else end = np;
      }
    }
    if (start !== w.start || end !== w.end) setWallEnds(elements, patch, w, start, end);
  }
  return patch;
}

/**
 * Drag one end of a wall to `target`. Walls sharing that endpoint follow; walls T-joined to the
 * dragged wall slide to stay on it.
 */
export function dragWallEndpoint(elements: Elements, wallId: string, end: 'start' | 'end', target: Vec2): Patch {
  const patch: Patch = new Map();
  const w = elements[wallId];
  if (!w || w.type !== 'wall') return patch;
  const p = w[end];
  const next: Wall = { ...w, [end]: { ...target } };
  setWallEnds(elements, patch, w, next.start, next.end);
  for (const o of Object.values(elements)) {
    if (o.type !== 'wall' || o.id === w.id || o.levelId !== w.levelId || o.locked) continue;
    let start = o.start;
    let oend = o.end;
    if (distance(o.start, p) <= JOIN_TOLERANCE) start = { ...target };
    else if (onWallInterior(o.start, w)) start = reattach(o.start, o, next) ?? o.start;
    if (distance(o.end, p) <= JOIN_TOLERANCE) oend = { ...target };
    else if (onWallInterior(o.end, w)) oend = reattach(o.end, o, next) ?? o.end;
    if (start !== o.start || oend !== o.end) setWallEnds(elements, patch, o, start, oend);
  }
  return patch;
}

/** Pieces of segment a→b NOT already covered by collinear walls (so new walls never double up). */
export function subtractCovered(a: Vec2, b: Vec2, walls: Wall[], tol = JOIN_TOLERANCE + 1, minLength = 20): [Vec2, Vec2][] {
  const L = distance(a, b);
  if (L < EPS) return [];
  const dir = normalize(sub(b, a));
  const cov: [number, number][] = [];
  for (const w of walls) {
    if (Math.abs(cross(dir, sub(w.start, a))) > tol || Math.abs(cross(dir, sub(w.end, a))) > tol) continue;
    const t0 = dot(sub(w.start, a), dir);
    const t1 = dot(sub(w.end, a), dir);
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(L, Math.max(t0, t1));
    if (hi - lo > tol) cov.push([lo, hi]);
  }
  cov.sort((x, y) => x[0] - y[0]);
  const out: [Vec2, Vec2][] = [];
  let t = 0;
  const at = (s: number) => add(a, { x: dir.x * s, y: dir.y * s });
  for (const [lo, hi] of cov) {
    if (lo - t > minLength) out.push([t === 0 ? { ...a } : at(t), at(lo)]);
    t = Math.max(t, hi);
  }
  if (L - t > minLength) out.push([t === 0 ? { ...a } : at(t), { ...b }]);
  return out;
}

/** Axis-aligned rectangle corners from two opposite points, counter-clockwise. */
export function rectCorners(p: Vec2, q: Vec2): Vec2[] {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Wall segments along a polygon/polyline, skipping parts that existing walls already cover. */
export function wallSegmentsAlong(points: Vec2[], closed: boolean, existing: Wall[]): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = [];
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) out.push(...subtractCovered(points[i], points[(i + 1) % points.length], existing));
  return out;
}

/** Replace vertex `i` of a polygon-ish element (slab/room/roof outline or railing path). */
export function withVertex<T extends Element>(el: T, i: number, p: Vec2): T {
  const e = el as Element;
  if (e.type === 'railing') return { ...e, path: e.path.map((q, k) => (k === i ? { ...p } : q)) } as T;
  if (e.type === 'slab' || e.type === 'room' || e.type === 'roof') return { ...e, outline: e.outline.map((q, k) => (k === i ? { ...p } : q)) } as T;
  return el;
}

/** Insert a vertex after index `i`. */
export function withInsertedVertex<T extends Element>(el: T, i: number, p: Vec2): T {
  const e = el as Element;
  const ins = (arr: Vec2[]) => [...arr.slice(0, i + 1), { ...p }, ...arr.slice(i + 1)];
  if (e.type === 'railing') return { ...e, path: ins(e.path) } as T;
  if (e.type === 'slab' || e.type === 'room' || e.type === 'roof') return { ...e, outline: ins(e.outline) } as T;
  return el;
}
