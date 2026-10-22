/**
 * Small solid-modelling DSL used by every element family.
 *
 * A `Model` works in a LOCAL right-handed frame in millimetres with z up (plan x/y + elevation),
 * mapped to plan space by a root affine matrix (rotation, translation, optional mirror) and finally
 * to world metres (Y up). Primitives are closed, outward-wound solids; geometry is bucketed into
 * one GeometryPart per (material, role) in insertion order.
 */
import { MM_TO_M } from '../core/coords';
import type { Vec2 } from '../core/types';
import { MeshBuilder, type V3 } from './mesh';
import { triangulate, type Tri } from './poly2d';
import type { GeometryPart, PartRole } from './types';

export type P3 = [number, number, number];
/** Row-major 3×4 affine matrix. */
export type Mat = readonly number[];
export type Pt2 = Vec2 | readonly [number, number];

const px = (p: Pt2): number => ('x' in p ? p.x : p[0]);
const py = (p: Pt2): number => ('x' in p ? p.y : p[1]);
const toVec = (p: Pt2): Vec2 => ({ x: px(p), y: py(p) });

export const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function multiply(a: Mat, b: Mat): Mat {
  const o: number[] = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let s = c === 3 ? a[r * 4 + 3] : 0;
      for (let k = 0; k < 3; k++) s += a[r * 4 + k] * b[k * 4 + c];
      o[r * 4 + c] = s;
    }
  }
  return o;
}

/** Compose left to right: chain(A, B, C) = A·B·C (C applied first). */
export const chain = (...ms: Mat[]): Mat => ms.reduce((acc, m) => multiply(acc, m), IDENTITY);

export const translate = (x: number, y: number, z = 0): Mat => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];

export function rotateZ(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

export function rotateX(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

export function rotateY(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}

export const scale3 = (sx: number, sy: number, sz: number): Mat => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0];

export function transformPoint(m: Mat, p: P3): P3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

export function determinant(m: Mat): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/** Root frame for an element placed in plan: translate to (x, y, z), rotate about z, optional mirror of local x. */
export function placement(x: number, y: number, z: number, rotationDeg: number, mirror = false): Mat {
  const m = chain(translate(x, y, z), rotateZ(rotationDeg));
  return mirror ? multiply(m, scale3(-1, 1, 1)) : m;
}

const sub3 = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a: P3): P3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

interface Bucket {
  materialId: string;
  role: PartRole;
  name?: string;
  mb: MeshBuilder;
}

export class Model {
  private buckets = new Map<string, Bucket>();
  private stack: Mat[] = [];
  private cur: Mat;
  private flip: boolean;
  private mat: string;
  private role: PartRole;
  private name?: string;

  constructor(root: Mat = IDENTITY, materialId = 'plaster-white', role: PartRole = 'body') {
    this.cur = root;
    this.flip = determinant(root) < 0;
    this.mat = materialId;
    this.role = role;
  }

  /** Set the material/role used by subsequent primitives. */
  use(materialId: string, role: PartRole = 'body', name?: string): this {
    this.mat = materialId;
    this.role = role;
    this.name = name;
    return this;
  }

  get material(): string {
    return this.mat;
  }

  /** Current local → plan matrix. */
  get matrix(): Mat {
    return this.cur;
  }

  push(t: Mat): void {
    this.stack.push(this.cur);
    this.cur = multiply(this.cur, t);
    this.flip = determinant(this.cur) < 0;
  }

  pop(): void {
    const m = this.stack.pop();
    if (m) this.cur = m;
    this.flip = determinant(this.cur) < 0;
  }

  /** Run `fn` with an extra local transform. */
  group(t: Mat, fn: () => void): void {
    this.push(t);
    try {
      fn();
    } finally {
      this.pop();
    }
  }

  /** Transform a local point to plan space (mm, z = elevation). */
  toPlan(p: P3): P3 {
    return transformPoint(this.cur, p);
  }

  /** Transform a local point to world metres. */
  toWorld(p: P3): V3 {
    const q = transformPoint(this.cur, p);
    return [q[0] * MM_TO_M, q[2] * MM_TO_M, -q[1] * MM_TO_M];
  }

  private bucket(): MeshBuilder {
    const key = `${this.role}|${this.mat}|${this.name ?? ''}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = { materialId: this.mat, role: this.role, name: this.name, mb: new MeshBuilder() };
      this.buckets.set(key, b);
    }
    return b.mb;
  }

  get isEmpty(): boolean {
    for (const b of this.buckets.values()) if (!b.mb.isEmpty) return false;
    return true;
  }

  parts(): GeometryPart[] {
    const out: GeometryPart[] = [];
    for (const b of this.buckets.values()) {
      if (b.mb.isEmpty) continue;
      out.push({ mesh: b.mb.build(), materialId: b.materialId, role: b.role, ...(b.name ? { name: b.name } : {}) });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Raw faces
  // ---------------------------------------------------------------------------

  /** Planar convex polygon, CCW seen from outside (local coords). */
  poly(pts: P3[]): void {
    if (pts.length < 3) return;
    const wp = pts.map((p) => this.toWorld(p));
    if (this.flip) wp.reverse();
    this.bucket().addPolygon(wp);
  }

  /** Planar face from shared vertices + triangles wound CCW seen from outside (local coords). */
  face(pts: P3[], tris: Tri[]): void {
    if (pts.length < 3 || !tris.length) return;
    const wp = pts.map((p) => this.toWorld(p));
    this.bucket().addIndexedFace(wp, this.flip ? tris.map(([a, b, c]) => [a, c, b]) : tris);
  }

  /**
   * Planar 2D region (outer + holes) placed in 3D by `map`; triangles are oriented so the face
   * normal agrees with `normal` (local coords).
   */
  region(outer: Vec2[], holes: Vec2[][], map: (p: Vec2) => P3, normal: P3): void {
    const { points, tris } = triangulate(outer, holes);
    if (!tris.length) return;
    const pts = points.map(map);
    const oriented = tris.map((t): Tri => {
      const n = cross3(sub3(pts[t[1]], pts[t[0]]), sub3(pts[t[2]], pts[t[0]]));
      return n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2] >= 0 ? t : [t[0], t[2], t[1]];
    });
    this.face(pts, oriented);
  }

  // ---------------------------------------------------------------------------
  // Solids
  // ---------------------------------------------------------------------------

  /** Axis-aligned box between two corners. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const ax = Math.min(x0, x1);
    const bx = Math.max(x0, x1);
    const ay = Math.min(y0, y1);
    const by = Math.max(y0, y1);
    const az = Math.min(z0, z1);
    const bz = Math.max(z0, z1);
    if (bx - ax < 1e-6 || by - ay < 1e-6 || bz - az < 1e-6) return;
    this.poly([
      [ax, ay, az],
      [ax, by, az],
      [bx, by, az],
      [bx, ay, az],
    ]);
    this.poly([
      [ax, ay, bz],
      [bx, ay, bz],
      [bx, by, bz],
      [ax, by, bz],
    ]);
    this.poly([
      [ax, ay, az],
      [bx, ay, az],
      [bx, ay, bz],
      [ax, ay, bz],
    ]);
    this.poly([
      [bx, by, az],
      [ax, by, az],
      [ax, by, bz],
      [bx, by, bz],
    ]);
    this.poly([
      [ax, by, az],
      [ax, ay, az],
      [ax, ay, bz],
      [ax, by, bz],
    ]);
    this.poly([
      [bx, ay, az],
      [bx, by, az],
      [bx, by, bz],
      [bx, ay, bz],
    ]);
  }

  /** Box centred on (cx, cy) in plan with size w × d, from z0 up by h. */
  boxC(cx: number, cy: number, z0: number, wdt: number, dep: number, hgt: number): void {
    this.box(cx - wdt / 2, cy - dep / 2, z0, cx + wdt / 2, cy + dep / 2, z0 + hgt);
  }

  /** Vertical extrusion of a simple plan polygon (any orientation, concave OK) with optional holes. */
  prism(ring: Pt2[], z0: number, z1: number, holes: Pt2[][] = []): void {
    if (ring.length < 3 || z1 - z0 < 1e-6) return;
    const outer = ccw(ring.map(toVec));
    const hs = holes.filter((h) => h.length >= 3).map((h) => cw(h.map(toVec)));
    const { points, tris } = triangulate(outer, hs);
    if (!tris.length) return;
    this.face(
      points.map((p): P3 => [p.x, p.y, z1]),
      tris,
    );
    this.face(
      points.map((p): P3 => [p.x, p.y, z0]),
      tris.map(([a, b, c]): Tri => [a, c, b]),
    );
    for (const r of [outer, ...hs]) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        this.poly([
          [a.x, a.y, z0],
          [b.x, b.y, z0],
          [b.x, b.y, z1],
          [a.x, a.y, z1],
        ]);
      }
    }
  }

  /** Extrude a profile drawn in the (x, z) plane along y from y0 to y1. */
  prismY(profile: Pt2[], y0: number, y1: number, holes: Pt2[][] = []): void {
    this.push([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0]); // local (a, b, c) → (a, -c, b): profile (x,z), extrude along -c
    try {
      this.prism(profile, -y1, -y0, holes);
    } finally {
      this.pop();
    }
  }

  /** Extrude a profile drawn in the (y, z) plane along x from x0 to x1. */
  prismX(profile: Pt2[], x0: number, x1: number, holes: Pt2[][] = []): void {
    this.push([0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0]); // local (a, b, c) → (c, a, b)
    try {
      this.prism(profile, x0, x1, holes);
    } finally {
      this.pop();
    }
  }

  /**
   * Vertical cylinder / frustum / cone centred on (cx, cy) from z0 to z1.
   * `rTop` defaults to `r` (0 = cone apex); `ry` makes it elliptical.
   */
  cylinder(cx: number, cy: number, z0: number, z1: number, r: number, segs = 16, rTop = r, ry = r, phase = 0): void {
    if (z1 - z0 < 1e-6 || r <= 0) return;
    const k = rTop / r;
    const ring = (s: number): P3[] =>
      Array.from({ length: segs }, (_, i) => {
        const a = phase + (i / segs) * Math.PI * 2;
        return [cx + Math.cos(a) * r * s, cy + Math.sin(a) * ry * s, 0];
      });
    const bot = ring(1).map((p): P3 => [p[0], p[1], z0]);
    if (k <= 1e-6) {
      const apex: P3 = [cx, cy, z1];
      this.poly([...bot].reverse());
      for (let i = 0; i < segs; i++) this.poly([bot[i], bot[(i + 1) % segs], apex]);
      return;
    }
    const top = ring(k).map((p): P3 => [p[0], p[1], z1]);
    this.poly([...bot].reverse());
    this.poly(top);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.poly([bot[i], bot[j], top[j], top[i]]);
    }
  }

  /** Cylinder whose axis runs along local x (e.g. wheels, rolls). */
  cylinderX(x0: number, x1: number, cy: number, cz: number, r: number, segs = 16, rz = r): void {
    this.group([0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0], () => this.cylinder(-cz, cy, x0, x1, rz, segs, rz, r));
  }

  /** Cylinder whose axis runs along local y (e.g. knobs, round doors on a front face). */
  cylinderY(y0: number, y1: number, cx: number, cz: number, r: number, segs = 16, rz = r): void {
    this.group([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0], () => this.cylinder(cx, -cz, y0, y1, r, segs, r, rz));
  }

  /** Cylinder (or frustum) between two arbitrary points. */
  tube(a: P3, b: P3, r: number, segs = 8, rEnd = r, phase = 0, ry?: number): void {
    const d = sub3(b, a);
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6 || r <= 0) return;
    const z = norm3(d);
    const ref: P3 = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const x = norm3(cross3(z, ref));
    const y = cross3(z, x);
    this.group([x[0], y[0], z[0], a[0], x[1], y[1], z[1], a[1], x[2], y[2], z[2], a[2]], () =>
      this.cylinder(0, 0, 0, len, r, segs, rEnd, ry ?? r, phase),
    );
  }

  /** Rectangular bar of section wdt × hgt between two points (section axes follow `tube`). */
  bar(a: P3, b: P3, wdt: number, hgt = wdt): void {
    this.tube(a, b, wdt / Math.SQRT2, 4, wdt / Math.SQRT2, Math.PI / 4, hgt / Math.SQRT2);
  }

  /** Ellipsoid (UV sphere) centred at (cx, cy, cz). */
  sphere(cx: number, cy: number, cz: number, rx: number, ry = rx, rz = rx, segs = 12, rings = 8): void {
    if (rx <= 0 || ry <= 0 || rz <= 0) return;
    const pt = (i: number, j: number): P3 => {
      const phi = -Math.PI / 2 + (Math.PI * i) / rings;
      const th = (Math.PI * 2 * j) / segs;
      return [cx + rx * Math.cos(phi) * Math.cos(th), cy + ry * Math.cos(phi) * Math.sin(th), cz + rz * Math.sin(phi)];
    };
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = pt(i, j);
        const b = pt(i, j + 1);
        const c = pt(i + 1, j + 1);
        const d = pt(i + 1, j);
        if (i === 0) this.poly([a, c, d]);
        else if (i === rings - 1) this.poly([a, b, d]);
        else this.poly([a, b, c, d]);
      }
    }
  }

  /** Hollow tray/basin: solid floor from z0 to zFloor, walls between `outer` and `inner` up to z1. */
  tray(outer: Pt2[], inner: Pt2[], z0: number, zFloor: number, z1: number): void {
    this.prism(outer, z0, zFloor);
    this.prism(outer, zFloor, z1, [inner]);
  }
}

function ccw(r: Vec2[]): Vec2[] {
  return area(r) < 0 ? [...r].reverse() : r;
}

function cw(r: Vec2[]): Vec2[] {
  return area(r) > 0 ? [...r].reverse() : r;
}

function area(r: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
