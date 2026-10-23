/**
 * CAD linework → wall location lines.
 *
 * Pipeline:
 *  1. weld endpoints closer than `weld` (snap sloppy corners);
 *  2. group by direction and merge collinear overlapping / touching segments;
 *  3. (optional) pair parallel lines `minThickness`–`maxThickness` apart that overlap into ONE wall on
 *     their centreline — the "two lines = wall" CAD convention — keeping a wall continuous where one
 *     face line runs on across a T junction;
 *  4. join wall ends: L corners meet at the centreline intersection, T ends extend to the host's
 *     centreline (the core footprint code then trims them to the host face);
 *  5. leftover single lines that are not part of a double-line wall's outline (end caps, corner
 *     returns) become walls of the default thickness.
 */
import { computeFootprintsForWalls } from '../../core/walls';
import { closestOnSegment, cross, distance, dot, pointInPolygon } from '../../core/math2d';
import type { Vec2, Wall } from '../../core/types';

export interface LineSeg {
  a: Vec2;
  b: Vec2;
  layer?: string;
}

export interface WallSpec {
  start: Vec2;
  end: Vec2;
  thickness: number;
  /** True if the wall came from a pair of face lines. */
  doubleLine: boolean;
  layer?: string;
}

export interface LinesToWallsOptions {
  wallThickness: number;
  detectDoubleLines: boolean;
  /** Ignore lines / walls shorter than this (mm). */
  minLength: number;
  /** Endpoint weld distance (mm). Default 20. */
  weld?: number;
  /** Double-line spacing range (mm). Defaults 50–600. */
  minThickness?: number;
  maxThickness?: number;
}

const ANGLE_TOL = (0.5 * Math.PI) / 180;
const OFFSET_TOL = 5;

interface Line {
  /** Unit direction of its group (θ in [0, π)). */
  d: Vec2;
  /** Signed offset along the left normal (−d.y, d.x). */
  o: number;
  t0: number;
  t1: number;
  layer?: string;
  /** Free (unpaired) parameter intervals. */
  free: [number, number][];
}

interface Group {
  d: Vec2;
  lines: Line[];
}

const at = (d: Vec2, t: number, o: number): Vec2 => ({ x: d.x * t - d.y * o, y: d.y * t + d.x * o });

/** Union-find weld of segment endpoints within `tol` (grid hashed). */
export function weldEndpoints(segs: LineSeg[], tol: number): LineSeg[] {
  const pts: Vec2[] = segs.flatMap((s) => [s.a, s.b]);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const cell = Math.max(tol, 1e-6);
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (distance(p, pts[j]) <= tol) parent[find(i)] = find(j);
        }
      }
    const key = `${cx},${cy}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  const sum = new Map<number, { x: number; y: number; n: number }>();
  pts.forEach((p, i) => {
    const r = find(i);
    const s = sum.get(r) ?? { x: 0, y: 0, n: 0 };
    s.x += p.x;
    s.y += p.y;
    s.n++;
    sum.set(r, s);
  });
  const welded = pts.map((_, i) => {
    const s = sum.get(find(i))!;
    return { x: s.x / s.n, y: s.y / s.n };
  });
  return segs.map((s, i) => ({ a: welded[i * 2], b: welded[i * 2 + 1], layer: s.layer }));
}

/** Group segments by direction (within 0.5°), each projected onto the group's mean direction. */
function directionGroups(segs: LineSeg[]): Group[] {
  const items = segs
    .map((s) => {
      let dx = s.b.x - s.a.x;
      let dy = s.b.y - s.a.y;
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      let th = Math.atan2(dy, dx);
      if (th < 0) th += Math.PI;
      if (th >= Math.PI - ANGLE_TOL) th -= Math.PI; // near-horizontal lines pointing west join the 0 group
      return { s, th, len };
    })
    .filter((x) => x.len > 1e-6)
    .sort((a, b) => a.th - b.th);
  const groups: { items: typeof items }[] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && it.th - g.items[g.items.length - 1].th <= ANGLE_TOL) g.items.push(it);
    else groups.push({ items: [it] });
  }
  return groups.map((g) => {
    const mean = g.items.reduce((s, it) => s + it.th * it.len, 0) / g.items.reduce((s, it) => s + it.len, 0);
    const d = { x: Math.cos(mean), y: Math.sin(mean) };
    const lines = g.items.map(({ s }) => {
      const ta = dot(d, s.a);
      const tb = dot(d, s.b);
      const o = (cross(d, s.a) + cross(d, s.b)) / 2;
      const t0 = Math.min(ta, tb);
      const t1 = Math.max(ta, tb);
      return { d, o, t0, t1, layer: s.layer, free: [[t0, t1]] as [number, number][] };
    });
    return { d, lines };
  });
}

/** Merge collinear segments of a group that overlap or touch (gap ≤ `gap`). */
function mergeCollinear(group: Group, gap: number): Line[] {
  const sorted = [...group.lines].sort((a, b) => a.o - b.o);
  const clusters: Line[][] = [];
  for (const l of sorted) {
    const c = clusters[clusters.length - 1];
    if (c && l.o - c[c.length - 1].o <= OFFSET_TOL) c.push(l);
    else clusters.push([l]);
  }
  const out: Line[] = [];
  for (const c of clusters) {
    c.sort((a, b) => a.t0 - b.t0);
    let cur: Line | null = null;
    let wsum = 0;
    let osum = 0;
    const flush = () => {
      if (!cur) return;
      cur.o = wsum > 0 ? osum / wsum : cur.o;
      cur.free = [[cur.t0, cur.t1]];
      out.push(cur);
    };
    for (const l of c) {
      const len = l.t1 - l.t0;
      if (cur && l.t0 <= cur.t1 + gap) {
        cur.t1 = Math.max(cur.t1, l.t1);
        wsum += len;
        osum += l.o * len;
      } else {
        flush();
        cur = { ...l };
        wsum = len;
        osum = l.o * len;
      }
    }
    flush();
  }
  return out;
}

/** Subtract [a, b] from a set of intervals. */
function subtract(intervals: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of intervals) {
    if (e <= a || s >= b) out.push([s, e]);
    else {
      if (s < a) out.push([s, a]);
      if (e > b) out.push([b, e]);
    }
  }
  return out;
}

/** Intersect [a, b] with free intervals. */
function freeWithin(intervals: [number, number][], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of intervals) {
    const lo = Math.max(s, a);
    const hi = Math.min(e, b);
    if (hi > lo) out.push([lo, hi]);
  }
  return out;
}

interface Piece {
  d: Vec2;
  o: number;
  thickness: number;
  t0: number;
  t1: number;
  layer?: string;
}

/** Pair parallel face lines into wall pieces (consumes the paired parts of the lines). */
function pairLines(lines: Line[], d: Vec2, opts: Required<LinesToWallsOptions>): Piece[] {
  const cands: { i: number; j: number; sep: number; ov: number }[] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const sep = Math.abs(lines[i].o - lines[j].o);
      if (sep < opts.minThickness - 0.5 || sep > opts.maxThickness + 0.5) continue;
      const ov = Math.min(lines[i].t1, lines[j].t1) - Math.max(lines[i].t0, lines[j].t0);
      if (ov >= Math.max(opts.minLength, 0.75 * sep)) cands.push({ i, j, sep, ov });
    }
  // Thinnest plausible wall first (two thin walls side by side beat one fat wall), then longest overlap.
  cands.sort((a, b) => a.sep - b.sep || b.ov - a.ov);
  const pieces: Piece[] = [];
  for (const c of cands) {
    const A = lines[c.i];
    const B = lines[c.j];
    const lo = Math.max(A.t0, B.t0);
    const hi = Math.min(A.t1, B.t1);
    for (const [fa, fb] of freeWithin(A.free, lo, hi)) {
      for (const [s, e] of freeWithin(B.free, fa, fb)) {
        if (e - s < Math.max(opts.minLength, 0.75 * c.sep)) continue;
        pieces.push({ d, o: (A.o + B.o) / 2, thickness: c.sep, t0: s, t1: e, layer: A.layer ?? B.layer });
        A.free = subtract(A.free, s, e);
        B.free = subtract(B.free, s, e);
      }
    }
  }
  // Merge collinear pieces of equal thickness when the gap between them is spanned by a face line
  // (the other face is interrupted by a T junction) or is within the weld distance.
  pieces.sort((a, b) => a.o - b.o || a.thickness - b.thickness || a.t0 - b.t0);
  const merged: Piece[] = [];
  for (const p of pieces) {
    const prev = [...merged].reverse().find((m) => Math.abs(m.o - p.o) <= OFFSET_TOL && Math.abs(m.thickness - p.thickness) <= 2);
    if (prev) {
      const gapA = prev.t1;
      const gapB = p.t0;
      const spanned =
        gapB - gapA <= opts.weld ||
        lines.some((l) => Math.abs(Math.abs(l.o - p.o) - p.thickness / 2) <= OFFSET_TOL && l.t0 <= gapA + opts.weld && l.t1 >= gapB - opts.weld);
      if (spanned) {
        prev.t1 = Math.max(prev.t1, p.t1);
        continue;
      }
    }
    merged.push({ ...p });
  }
  return merged;
}

function lineHit(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross({ x: p2.x - p1.x, y: p2.y - p1.y }, d2) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

const dirOf = (w: WallSpec): Vec2 => {
  const l = distance(w.start, w.end) || 1;
  return { x: (w.end.x - w.start.x) / l, y: (w.end.y - w.start.y) / l };
};

/**
 * Join free wall ends: L corners move both ends to the centreline intersection; T ends extend
 * (or trim) to the host's centreline. Parallel walls are never joined (keeps door gaps open).
 */
/** Uniform grid over item bounding boxes (padded) for neighbourhood queries. */
class GridIndex<T> {
  private cells = new Map<string, T[]>();

  constructor(
    items: T[],
    bounds: (t: T) => { minX: number; minY: number; maxX: number; maxY: number },
    pad: number,
    private readonly size: number,
  ) {
    for (const it of items) {
      const b = bounds(it);
      const x0 = Math.floor((b.minX - pad) / size);
      const x1 = Math.floor((b.maxX + pad) / size);
      const y0 = Math.floor((b.minY - pad) / size);
      const y1 = Math.floor((b.maxY + pad) / size);
      // Degenerate huge items (bad data) fall back to a global bucket.
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) {
        (this.cells.get('*') ?? this.cells.set('*', []).get('*')!).push(it);
        continue;
      }
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          const list = this.cells.get(k);
          if (list) list.push(it);
          else this.cells.set(k, [it]);
        }
    }
  }

  query(p: Vec2): T[] {
    const local = this.cells.get(`${Math.floor(p.x / this.size)},${Math.floor(p.y / this.size)}`) ?? [];
    const global = this.cells.get('*');
    return global ? [...local, ...global] : local;
  }
}

const segBounds = (w: { start: Vec2; end: Vec2 }) => ({
  minX: Math.min(w.start.x, w.end.x),
  minY: Math.min(w.start.y, w.end.y),
  maxX: Math.max(w.start.x, w.end.x),
  maxY: Math.max(w.start.y, w.end.y),
});

export function joinWallEnds(walls: WallSpec[], tol: number): void {
  const MIN_SIN = Math.sin((5 * Math.PI) / 180);
  const maxReach = Math.max(0, ...walls.map((w) => w.thickness)) + tol;
  // Ends move by at most one reach while joining, so pad the index by two.
  const index = new GridIndex(walls, segBounds, 2 * maxReach + tol, Math.max(1000, 4 * maxReach));
  const connected = (p: Vec2, self: WallSpec) =>
    index
      .query(p)
      .some((o) => o !== self && (distance(o.start, p) <= tol || distance(o.end, p) <= tol || closestOnSegment(p, o.start, o.end).distance <= tol));
  for (const A of walls) {
    for (const end of ['start', 'end'] as const) {
      const E = A[end];
      if (connected(E, A)) continue;
      const dA = dirOf(A);
      let best: { X: Vec2; B: WallSpec; dist: number } | null = null;
      for (const B of index.query(E)) {
        if (B === A) continue;
        const dB = dirOf(B);
        if (Math.abs(cross(dA, dB)) < MIN_SIN) continue;
        const X = lineHit(A.start, dA, B.start, dB);
        if (!X) continue;
        const reach = A.thickness / 2 + B.thickness / 2 + tol;
        const dist = distance(E, X);
        if (dist > reach) continue;
        const lenB = distance(B.start, B.end);
        const tB = dot({ x: X.x - B.start.x, y: X.y - B.start.y }, dB);
        if (tB < -reach || tB > lenB + reach) continue;
        // Never collapse or reverse A.
        const other = end === 'start' ? A.end : A.start;
        if (dot({ x: other.x - X.x, y: other.y - X.y }, end === 'start' ? dA : { x: -dA.x, y: -dA.y }) < tol) continue;
        if (!best || dist < best.dist) best = { X, B, dist };
      }
      if (!best) continue;
      A[end] = best.X;
      const B = best.B;
      const reachB = A.thickness / 2 + B.thickness / 2 + tol;
      for (const bEnd of ['start', 'end'] as const) {
        if (distance(B[bEnd], best.X) <= reachB && !connected(B[bEnd], B)) B[bEnd] = best.X;
      }
    }
  }
}

function asWall(w: WallSpec, i: number): Wall {
  return {
    id: `tmp${i}`,
    type: 'wall',
    levelId: 'tmp',
    start: w.start,
    end: w.end,
    thickness: w.thickness,
    baseOffset: 0,
    justification: 'center',
    structural: false,
  };
}

/** True if `p` is inside (or within `tol` of) any of the polygons. */
function nearPolygons(p: Vec2, index: GridIndex<Vec2[]>, tol: number): boolean {
  const polys = index.query(p);
  for (const poly of polys) {
    if (pointInPolygon(p, poly)) return true;
    for (let i = 0; i < poly.length; i++) if (closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]).distance <= tol) return true;
  }
  return false;
}

export function linesToWalls(input: LineSeg[], options: LinesToWallsOptions): WallSpec[] {
  const opts: Required<LinesToWallsOptions> = { weld: 20, minThickness: 50, maxThickness: 600, ...options };
  const segs = weldEndpoints(
    input.filter((s) => distance(s.a, s.b) > 1e-3),
    opts.weld,
  ).filter((s) => distance(s.a, s.b) > 1e-3);
  const groups = directionGroups(segs).map((g) => ({ d: g.d, lines: mergeCollinear(g, opts.weld) }));

  const doubles: WallSpec[] = [];
  if (opts.detectDoubleLines) {
    for (const g of groups) {
      for (const p of pairLines(g.lines, g.d, opts)) {
        doubles.push({ start: at(p.d, p.t0, p.o), end: at(p.d, p.t1, p.o), thickness: p.thickness, doubleLine: true, layer: p.layer });
      }
    }
    joinWallEnds(doubles, opts.weld);
  }

  // Leftover line parts that are not part of a double-line wall outline become single walls.
  const footprints = doubles.length ? [...computeFootprintsForWalls(doubles.map(asWall)).values()].map((f) => f.polygon) : [];
  const polyBounds = (poly: Vec2[]) => ({
    minX: Math.min(...poly.map((q) => q.x)),
    minY: Math.min(...poly.map((q) => q.y)),
    maxX: Math.max(...poly.map((q) => q.x)),
    maxY: Math.max(...poly.map((q) => q.y)),
  });
  const footprintIndex = new GridIndex(footprints, polyBounds, opts.weld, 2000);
  const singles: WallSpec[] = [];
  for (const g of groups)
    for (const l of g.lines)
      for (const [s, e] of l.free) {
        if (e - s < opts.minLength) continue;
        const a = at(l.d, s, l.o);
        const b = at(l.d, e, l.o);
        const mid = at(l.d, (s + e) / 2, l.o);
        if (footprints.length && [a, b, mid].every((p) => nearPolygons(p, footprintIndex, opts.weld))) continue;
        singles.push({ start: a, end: b, thickness: opts.wallThickness, doubleLine: false, layer: l.layer });
      }

  const walls = [...doubles, ...singles];
  if (singles.length && doubles.length) joinWallEnds(walls, opts.weld);
  // Re-weld: projecting merged lines onto their mean direction can move shared corners by a few mm.
  const welded = weldEndpoints(
    walls.map((w) => ({ a: w.start, b: w.end })),
    opts.weld,
  );
  welded.forEach((s, i) => {
    walls[i].start = s.a;
    walls[i].end = s.b;
  });
  return walls.filter((w) => distance(w.start, w.end) >= Math.max(opts.minLength, 1));
}
