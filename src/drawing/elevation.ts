/**
 * Elevations, sections and axonometric views from the 3D geometry (src/geometry, exported API only).
 *
 * Triangles are projected orthographically, back faces culled, coplanar triangles of each part
 * merged into polygons (edge cancellation), and the polygons painter-sorted far → near and emitted
 * as filled + stroked FillEntities, which gives a correct visible-line result in every renderer.
 * Sections clip everything in front of the cut plane and add material poché (cut outlines of each
 * part, hatched by material). Drawing coordinates: x = along the view (mm), y = elevation (mm).
 */
import { buildProjectGeometry, type ElementGeometry } from '../geometry';
import { getMaterial } from '../core/materials';
import { signedArea } from '../core/math2d';
import type { Element, Project, Vec2 } from '../core/types';
import { DrawingBuilder, drawingBounds } from './builder';
import { chainSegments, type Segment } from './geom';
import { ELEVATION_LAYERS, PEN, TEXT } from './layers';
import { drawViewTitle } from './plan/annotation';
import type { Drawing } from './types';
import { POCHE_GREY } from './plan/walls';

export type ElevationSide = 'north' | 'south' | 'east' | 'west';

export interface ViewOptions {
  /** Scale denominator, default 100. */
  scale?: number;
  /** View title + scale under the drawing (default true). */
  includeTitle?: boolean;
  /** Level datum lines with elevation tags (default true). */
  includeLevels?: boolean;
  /** Include furniture / entourage geometry (default false). */
  includeFurniture?: boolean;
}

export interface SectionCut {
  /** Cut line in plan (mm). The view looks towards the LEFT of a→b; a→b runs left → right on paper. */
  a: Vec2;
  b: Vec2;
  /** Far clip distance beyond the cut plane, mm (default unlimited). */
  depth?: number;
  /** Section name, e.g. "A" → "SECTION A-A". */
  name?: string;
}

type V3 = { x: number; y: number; z: number };

interface ViewFrame {
  right: V3;
  up: V3;
  forward: V3;
  /** Depth of the cut plane (sections), measured along `forward`. */
  cut?: number;
  far?: number;
}

const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross3 = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const lerp3 = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

/** View frame from a horizontal-or-not viewing direction (plan mm axes: x east, y north, z up). */
export function viewFrame(forward: V3, origin: V3 = { x: 0, y: 0, z: 0 }): ViewFrame {
  const f = norm3(forward);
  const z = { x: 0, y: 0, z: 1 };
  const up = norm3(sub3(z, { x: f.x * f.z, y: f.y * f.z, z: f.z * f.z }));
  const right = cross3(f, up);
  return { right, up, forward: f, cut: dot3(origin, f) };
}

const SIDE_FORWARD: Record<ElevationSide, V3> = {
  south: { x: 0, y: 1, z: 0 },
  north: { x: 0, y: -1, z: 0 },
  east: { x: -1, y: 0, z: 0 },
  west: { x: 1, y: 0, z: 0 },
};

/** Geometry vertex (world metres, Y up) → plan mm (x east, y north, z up). */
const toPlan = (p: Float32Array, i: number): V3 => ({ x: p[i * 3] * 1000, y: -p[i * 3 + 2] * 1000, z: p[i * 3 + 1] * 1000 });

interface Face {
  depth: number;
  rings: Vec2[][];
  /** Unclosed boundary edges (non-manifold input) drawn as lines. */
  open: Segment[];
  /** Triangles for the fallback fill when the boundary did not close. */
  tris: Vec2[][];
  fill: string;
  elementId: string;
  /** Plane (normal towards the viewer) and a vertex sample, for visibility ordering. */
  n: V3;
  d: number;
  pts: V3[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** Convex hull of the projected face. */
  hull: Vec2[];
}

function tint(hex: string, k: number): string {
  const v = parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (!Number.isFinite(v)) return '#ffffff';
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x + (255 - x) * k));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const keyOf = (p: V3) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;

/** Clip a polygon to depth ≥ cut (keeping the part beyond the section plane). */
function clipBeyond(poly: V3[], f: V3, cut: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = dot3(p, f) - cut;
    const dq = dot3(q, f) - cut;
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) out.push(edgeCut(p, q, f, cut));
  }
  return out;
}

/** Plane intersection of edge p-q computed in a canonical order so shared edges agree exactly. */
function edgeCut(p: V3, q: V3, f: V3, cut: number): V3 {
  const [a, b] = keyOf(p) < keyOf(q) ? [p, q] : [q, p];
  const da = dot3(a, f) - cut;
  const db = dot3(b, f) - cut;
  return lerp3(a, b, da / (da - db));
}

interface Projection {
  faces: Face[];
  cuts: { elementId: string; materialId: string; segs: Segment[] }[];
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

function project3(geoms: ElementGeometry[], project: Project, frame: ViewFrame, section: boolean): Projection {
  const P = (p: V3): Vec2 => ({ x: dot3(p, frame.right), y: dot3(p, frame.up) });
  const faces: Face[] = [];
  const cuts: Projection['cuts'] = [];
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  const cut = frame.cut ?? 0;
  for (const g of geoms) {
    const el = project.elements[g.elementId] as Element | undefined;
    g.parts.forEach((part) => {
      const { positions, normals, indices } = part.mesh;
      const mat = getMaterial(part.materialId);
      const groups = new Map<string, { tris: V3[][]; depth: number; area: number; n: V3; d: number }>();
      const cutSegs: Segment[] = [];
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const ia = indices[t];
        const ib = indices[t + 1];
        const ic = indices[t + 2];
        const a = toPlan(positions, ia);
        const b = toPlan(positions, ib);
        const c = toPlan(positions, ic);
        let n = cross3(sub3(b, a), sub3(c, a));
        const len = Math.hypot(n.x, n.y, n.z);
        if (len < 1e-6) continue;
        n = { x: n.x / len, y: n.y / len, z: n.z / len };
        if (normals.length === positions.length) {
          const avg = {
            x: normals[ia * 3] + normals[ib * 3] + normals[ic * 3],
            y: -(normals[ia * 3 + 2] + normals[ib * 3 + 2] + normals[ic * 3 + 2]),
            z: normals[ia * 3 + 1] + normals[ib * 3 + 1] + normals[ic * 3 + 1],
          };
          if (dot3(avg, n) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
        }
        let poly = [a, b, c];
        if (section) {
          const da = dot3(a, frame.forward) - cut;
          const db = dot3(b, frame.forward) - cut;
          const dc = dot3(c, frame.forward) - cut;
          // Cut segment of this triangle through the section plane.
          const pts: V3[] = [];
          for (const [p, q, dp, dq] of [
            [a, b, da, db],
            [b, c, db, dc],
            [c, a, dc, da],
          ] as const)
            if (dp >= 0 !== dq >= 0) pts.push(edgeCut(p, q, frame.forward, cut));
          if (pts.length === 2) cutSegs.push([P(pts[0]), P(pts[1])]);
          if (da < 0 && db < 0 && dc < 0) continue;
          if (da < 0 || db < 0 || dc < 0) poly = clipBeyond(poly, frame.forward, cut);
          if (poly.length < 3) continue;
        }
        if (frame.far !== undefined && poly.every((p) => dot3(p, frame.forward) - cut > frame.far!)) continue;
        // Back faces and faces seen edge-on are culled.
        if (dot3(n, frame.forward) > -1e-3) continue;
        const key = `${Math.round(n.x * 1000)},${Math.round(n.y * 1000)},${Math.round(n.z * 1000)},${Math.round(dot3(n, a))}`;
        let grp = groups.get(key);
        if (!grp) {
          grp = { tris: [], depth: 0, area: 0, n, d: dot3(n, a) };
          groups.set(key, grp);
        }
        const area2 = Math.abs(signedArea(poly.map(P))) + 1e-9;
        const cen = poly.reduce((s, p) => s + dot3(p, frame.forward), 0) / poly.length;
        grp.depth += cen * area2;
        grp.area += area2;
        grp.tris.push(poly);
      }
      if (section && cutSegs.length) cuts.push({ elementId: g.elementId, materialId: part.materialId, segs: cutSegs });
      const baseFill = mat.category === 'glass' ? '#dcebf2' : tint(mat.color, 0.84);
      for (const grp of groups.values()) {
        // Edge cancellation: interior edges appear twice.
        const count = new Map<string, { a: V3; b: V3; n: number }>();
        for (const poly of grp.tris)
          for (let i = 0; i < poly.length; i++) {
            const p = poly[i];
            const q = poly[(i + 1) % poly.length];
            const kp = keyOf(p);
            const kq = keyOf(q);
            if (kp === kq) continue;
            const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
            const e = count.get(k);
            if (e) e.n++;
            else count.set(k, { a: p, b: q, n: 1 });
          }
        const boundary: Segment[] = [];
        for (const e of count.values()) if (e.n === 1) boundary.push([P(e.a), P(e.b)]);
        const chains = chainSegments(boundary, 0.01);
        const closed = chains.filter((c) => c.closed && c.points.length >= 3);
        const tris2 = grp.tris.map((poly) => poly.map(P));
        for (const t of tris2)
          for (const p of t) {
            minU = Math.min(minU, p.x);
            maxU = Math.max(maxU, p.x);
            minV = Math.min(minV, p.y);
            maxV = Math.max(maxV, p.y);
          }
        const allClosed = closed.length === chains.length && closed.length > 0;
        const uniq = new Map<string, V3>();
        for (const poly of grp.tris) for (const p of poly) uniq.set(keyOf(p), p);
        const all3 = [...uniq.values()];
        const stride = Math.max(1, Math.ceil(all3.length / 48));
        const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const t of tris2)
          for (const p of t) {
            box.minX = Math.min(box.minX, p.x);
            box.minY = Math.min(box.minY, p.y);
            box.maxX = Math.max(box.maxX, p.x);
            box.maxY = Math.max(box.maxY, p.y);
          }
        faces.push({
          hull: convexHull(tris2.flat()),
          n: grp.n,
          d: grp.d,
          pts: all3.filter((_, i) => i % stride === 0),
          box,
          depth: grp.depth / grp.area,
          rings: allClosed ? closed.map((c) => c.points).sort((x, y) => Math.abs(signedArea(y)) - Math.abs(signedArea(x))) : [],
          open: allClosed ? [] : boundary,
          tris: allClosed ? [] : tris2,
          fill: baseFill,
          elementId: el?.id ?? g.elementId,
        });
      }
    });
  }
  return { faces, cuts, minU, maxU, minV, maxV };
}

function geometryFor(project: Project, includeFurniture: boolean): ElementGeometry[] {
  return buildProjectGeometry(
    project,
    (el) => !el.hidden && el.type !== 'room' && el.type !== 'dimension' && el.type !== 'label' && (includeFurniture || el.type !== 'furniture'),
  );
}

/**
 * Visibility order (far → near): depth sort refined by plane-side tests between faces whose
 * projections overlap (Newell's method), resolved with a priority topological sort.
 */
export function orderFaces<F extends { depth: number; n: V3; d: number; pts: V3[]; hull: Vec2[]; box: { minX: number; minY: number; maxX: number; maxY: number } }>(faces: F[]): F[] {
  const sorted = [...faces].sort((x, y) => y.depth - x.depth);
  const n = sorted.length;
  if (n < 2 || n > 4000) return sorted;
  const eps = 0.5;
  const behind = (a: F, b: F) => a.pts.every((p) => dot3(b.n, p) - b.d <= eps);
  const front = (a: F, b: F) => a.pts.every((p) => dot3(b.n, p) - b.d >= -eps);
  const succ: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const A = sorted[i];
    for (let j = i + 1; j < n; j++) {
      const B = sorted[j];
      if (A.box.minX >= B.box.maxX - 0.5 || B.box.minX >= A.box.maxX - 0.5 || A.box.minY >= B.box.maxY - 0.5 || B.box.minY >= A.box.maxY - 0.5) continue;
      if (!hullsOverlap(A.hull, B.hull)) continue;
      // A before B if A lies behind B's plane or B lies in front of A's plane, and vice versa.
      const ab = behind(A, B) || front(B, A);
      const ba = behind(B, A) || front(A, B);
      if (ab && !ba) {
        succ[i].push(j);
        indeg[j]++;
      } else if (ba && !ab) {
        succ[j].push(i);
        indeg[i]++;
      } else if (!ab && !ba) {
        // Interpenetrating or undecidable: fall back to depth (i is farther).
        succ[i].push(j);
        indeg[j]++;
      }
    }
  }
  // Strongly connected components (cycles come from interpenetrating faces) are emitted as a unit
  // in depth order; the component graph is then topologically sorted, farthest first.
  const comp = tarjan(succ);
  const nc = Math.max(0, ...comp) + 1;
  const members: number[][] = Array.from({ length: nc }, () => []);
  comp.forEach((c, i) => members[c].push(i));
  const cIn = new Int32Array(nc);
  const cSucc: Set<number>[] = Array.from({ length: nc }, () => new Set());
  succ.forEach((list, i) => {
    for (const j of list) {
      const a = comp[i];
      const b = comp[j];
      if (a !== b && !cSucc[a].has(b)) {
        cSucc[a].add(b);
        cIn[b]++;
      }
    }
  });
  const key = members.map((m) => Math.min(...m));
  const ready: number[] = [];
  for (let c = 0; c < nc; c++) if (cIn[c] === 0) ready.push(c);
  const out: F[] = [];
  while (ready.length) {
    let bi = 0;
    for (let k = 1; k < ready.length; k++) if (key[ready[k]] < key[ready[bi]]) bi = k;
    const c = ready.splice(bi, 1)[0];
    for (const i of members[c].sort((x, y) => x - y)) out.push(sorted[i]);
    for (const d of cSucc[c]) if (--cIn[d] === 0) ready.push(d);
  }
  return out;
}

/** Andrew's monotone chain convex hull (CCW). */
export function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cr = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Separating-axis test: do two convex polygons overlap by more than `tol`? */
export function hullsOverlap(a: Vec2[], b: Vec2[], tol = 0.5): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ax = { x: -(q.y - p.y), y: q.x - p.x };
      const l = Math.hypot(ax.x, ax.y);
      if (l < 1e-9) continue;
      let amin = Infinity;
      let amax = -Infinity;
      let bmin = Infinity;
      let bmax = -Infinity;
      for (const v of a) {
        const t = (v.x * ax.x + v.y * ax.y) / l;
        amin = Math.min(amin, t);
        amax = Math.max(amax, t);
      }
      for (const v of b) {
        const t = (v.x * ax.x + v.y * ax.y) / l;
        bmin = Math.min(bmin, t);
        bmax = Math.max(bmax, t);
      }
      if (amax <= bmin + tol || bmax <= amin + tol) return false;
    }
  }
  return true;
}

/** Tarjan's strongly connected components (iterative); returns the component index per node. */
function tarjan(succ: number[][]): number[] {
  const n = succ.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const comp = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  let idx = 0;
  let nc = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work: [number, number][] = [[s, 0]];
    while (work.length) {
      const top = work[work.length - 1];
      const [v, k] = top;
      if (k === 0) {
        index[v] = low[v] = idx++;
        stack.push(v);
        onStack[v] = 1;
      }
      if (k < succ[v].length) {
        top[1] = k + 1;
        const w = succ[v][k];
        if (index[w] === -1) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) {
        const p = work[work.length - 1][0];
        low[p] = Math.min(low[p], low[v]);
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = 0;
          comp[w] = nc;
        } while (w !== v);
        nc++;
      }
    }
  }
  return comp;
}

function emitFaces(b: DrawingBuilder, faces: Face[]): void {
  for (const f of orderFaces(faces)) {
    const id = { elementId: f.elementId };
    if (f.rings.length) {
      b.fill('A-ELEV', f.rings[0], f.fill, { ...id, holes: f.rings.slice(1), stroke: true, tag: 'face' });
    } else {
      for (const t of f.tris) b.fill('A-ELEV', t, f.fill, { ...id, tag: 'face-tri' });
      for (const c of chainSegments(f.open, 0.01)) b.polyline('A-ELEV', c.points, c.closed, { ...id, tag: 'face-edge' });
    }
  }
}

/** Level datums: thin chain line across the view, datum symbol and elevation tag on the right. */
function drawLevels(b: DrawingBuilder, project: Project, minU: number, maxU: number, scale: number, extraTop?: { v: number; label: string }): void {
  const x0 = minU - 6 * scale;
  const x1 = maxU + 8 * scale;
  const r = 1.6 * scale;
  const items = [...project.levels].sort((a, c) => a.elevation - c.elevation).map((l) => ({ v: l.elevation, label: l.name }));
  if (extraTop) items.push(extraTop);
  for (const { v, label } of items) {
    b.line('A-ANNO-SYMB', { x: x0, y: v }, { x: x1, y: v }, { linetype: 'center', lineweight: PEN.extraFine, tag: 'datum-line' });
    const c = { x: x1 + r, y: v };
    b.circle('A-ANNO-SYMB', c, r, { tag: 'datum', lineweight: PEN.fine });
    b.fill('A-ANNO-SYMB', [c, { x: c.x + r, y: c.y }, ...quarter(c, r, 0), { x: c.x, y: c.y + r }], '#000000', { tag: 'datum' });
    b.fill('A-ANNO-SYMB', [c, { x: c.x - r, y: c.y }, ...quarter(c, r, 180), { x: c.x, y: c.y - r }], '#000000', { tag: 'datum' });
    const sign = v > 0.5 ? '+' : v < -0.5 ? '−' : '±';
    b.text('A-ANNO-TEXT', { x: c.x + r + 1.5 * scale, y: v + 0.8 * scale }, `${sign}${(Math.abs(v) / 1000).toFixed(3)}`, TEXT.small, { align: 'left', valign: 'bottom', tag: 'datum-value' });
    b.text('A-ANNO-TEXT', { x: c.x + r + 1.5 * scale, y: v - 0.8 * scale }, label.toUpperCase(), TEXT.tiny, { align: 'left', valign: 'top', tag: 'datum-name' });
  }
}

function quarter(c: Vec2, r: number, start: number): Vec2[] {
  return [1, 2, 3, 4, 5].map((i) => {
    const a = ((start + (i * 90) / 6) * Math.PI) / 180;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

function groundLine(b: DrawingBuilder, project: Project, minU: number, maxU: number, scale: number): void {
  const g = Math.min(0, ...project.levels.map((l) => l.elevation));
  b.line('A-ELEV-OTLN', { x: minU - 4 * scale, y: g }, { x: maxU + 4 * scale, y: g }, { tag: 'ground-line' });
}

/** Earth hatch strip under the ground line; added first so cut foundations draw over it. */
function groundHatch(b: DrawingBuilder, project: Project, proj: Projection, scale: number): void {
  if (!Number.isFinite(proj.minU)) return;
  const g = Math.min(0, ...project.levels.map((l) => l.elevation));
  const x0 = proj.minU - 4 * scale;
  const x1 = proj.maxU + 4 * scale;
  const depth = Math.max(3 * scale, g - Math.min(proj.minV, g));
  b.fill('A-ELEV', [{ x: x0, y: g }, { x: x1, y: g }, { x: x1, y: g - depth }, { x: x0, y: g - depth }], '#ffffff', {
    hatch: 'earth',
    tag: 'ground-hatch',
    lineweight: PEN.extraFine,
  });
}

function finish(b: DrawingBuilder, project: Project, proj: Projection, scale: number, title: string, opts: ViewOptions): Drawing {
  if (Number.isFinite(proj.minU)) {
    groundLine(b, project, proj.minU, proj.maxU, scale);
    if (opts.includeLevels !== false) {
      const top = proj.maxV > Math.max(...project.levels.map((l) => l.elevation)) + 500 ? { v: proj.maxV, label: 'Top' } : undefined;
      drawLevels(b, project, proj.minU, proj.maxU, scale, top);
    }
  }
  if (opts.includeTitle !== false) {
    const all = drawingBounds(b.entities(ELEVATION_LAYERS), scale, b.units);
    if (all.minX <= all.maxX) drawViewTitle(b, scale, title, { x: all.minX, y: all.minY - 12 * scale }, false);
  }
  return b.build(title.charAt(0) + title.slice(1).toLowerCase(), ELEVATION_LAYERS);
}

/** Exterior elevation of the whole model seen from `side`. */
export function generateElevationDrawing(project: Project, side: ElevationSide, options: ViewOptions = {}): Drawing {
  const scale = options.scale && options.scale > 0 ? options.scale : 100;
  const b = new DrawingBuilder(scale, project.settings.units);
  const frame = viewFrame(SIDE_FORWARD[side]);
  const proj = project3(geometryFor(project, !!options.includeFurniture), project, frame, false);
  groundHatch(b, project, proj, scale);
  emitFaces(b, proj.faces);
  return finish(b, project, proj, scale, `${side.toUpperCase()} ELEVATION`, options);
}

/** Building section along a plan cut line, looking to the left of a→b. */
export function generateSectionDrawing(project: Project, cut: SectionCut, options: ViewOptions = {}): Drawing {
  const scale = options.scale && options.scale > 0 ? options.scale : 100;
  const b = new DrawingBuilder(scale, project.settings.units);
  const u = { x: cut.b.x - cut.a.x, y: cut.b.y - cut.a.y };
  const l = Math.hypot(u.x, u.y) || 1;
  const forward = { x: -u.y / l, y: u.x / l, z: 0 };
  const frame = viewFrame(forward, { x: cut.a.x, y: cut.a.y, z: 0 });
  frame.far = cut.depth;
  const proj = project3(geometryFor(project, !!options.includeFurniture), project, frame, true);
  groundHatch(b, project, proj, scale);
  emitFaces(b, proj.faces);
  for (const c of proj.cuts) {
    const mat = getMaterial(c.materialId);
    const chains = chainSegments(c.segs, 0.05);
    const loops = chains.filter((x) => x.closed && x.points.length >= 3).map((x) => x.points);
    if (loops.length) {
      loops.sort((x, y) => Math.abs(signedArea(y)) - Math.abs(signedArea(x)));
      const hatch = mat.hatch === 'none' ? undefined : mat.hatch;
      b.fill('A-SECT-PATT', loops[0], hatch ? '#ffffff' : POCHE_GREY, { holes: loops.slice(1), elementId: c.elementId, tag: 'poche', ...(hatch ? { hatch } : {}) });
    }
    for (const ch of chains) b.polyline('A-SECT-MCUT', ch.points, ch.closed, { elementId: c.elementId, tag: 'cut' });
  }
  const name = cut.name ?? 'A';
  return finish(b, project, proj, scale, `SECTION ${name}-${name}`, options);
}

/** Default cut for a longitudinal section: west → east through the middle of the model. */
export function defaultSectionCut(project: Project): SectionCut {
  const walls = Object.values(project.elements).filter((e) => e.type === 'wall') as Extract<Element, { type: 'wall' }>[];
  if (!walls.length) return { a: { x: -1000, y: 0 }, b: { x: 1000, y: 0 }, name: 'A' };
  const xs = walls.flatMap((w) => [w.start.x, w.end.x]);
  const ys = walls.flatMap((w) => [w.start.y, w.end.y]);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { a: { x: Math.min(...xs) - 2000, y }, b: { x: Math.max(...xs) + 2000, y }, name: 'A' };
}

/** Axonometric (isometric, viewed from the south-east) line view of the model, for cover sheets. */
export function generateAxonometricDrawing(project: Project, options: ViewOptions = {}): Drawing {
  const scale = options.scale && options.scale > 0 ? options.scale : 100;
  const b = new DrawingBuilder(scale, project.settings.units);
  const frame = viewFrame({ x: -1, y: 1, z: -1 });
  const proj = project3(geometryFor(project, !!options.includeFurniture), project, frame, false);
  emitFaces(b, proj.faces);
  return b.build('Axonometric View', ELEVATION_LAYERS);
}
