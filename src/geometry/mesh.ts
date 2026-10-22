import { ShapeUtils, Vector2 } from 'three';
import { MM_TO_M } from '../core/coords';
import { ensureCCW, rotate, signedArea } from '../core/math2d';
import type { Vec2 } from '../core/types';
import type { MeshData } from './types';

type V3 = [number, number, number];

const subV = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normV = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Plan point (mm) + elevation (mm) → world tuple (m). */
export function w(p: Vec2, elevMm: number): V3 {
  return [p.x * MM_TO_M, elevMm * MM_TO_M, -p.y * MM_TO_M];
}

/**
 * Accumulates flat-shaded triangles with world-scale UVs.
 * All add* methods take WORLD coordinates (metres) unless the name says Plan.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get isEmpty(): boolean {
    return this.idx.length === 0;
  }

  /** Add a planar convex polygon (CCW when seen from the front). UVs projected onto the face plane. */
  addPolygon(pts: V3[], uvs?: [number, number][]): void {
    if (pts.length < 3) return;
    let n: V3 = [0, 0, 0];
    for (let i = 1; i < pts.length - 1; i++) {
      const c = crossV(subV(pts[i], pts[0]), subV(pts[i + 1], pts[0]));
      n = [n[0] + c[0], n[1] + c[1], n[2] + c[2]];
    }
    if (Math.hypot(n[0], n[1], n[2]) < 1e-12) return;
    n = normV(n);
    const projected = uvs ?? projectUV(pts, n);
    const base = this.vertexCount;
    for (let i = 0; i < pts.length; i++) {
      this.pos.push(...pts[i]);
      this.nor.push(...n);
      this.uv.push(...projected[i]);
    }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  addTriangle(a: V3, b: V3, c: V3): void {
    this.addPolygon([a, b, c]);
  }

  /** Quad a,b,c,d CCW seen from the front. */
  addQuad(a: V3, b: V3, c: V3, d: V3): void {
    this.addPolygon([a, b, c, d]);
  }

  /**
   * Horizontal (possibly concave, with holes) polygon in PLAN mm at elevation `elevMm`.
   * `up` = true faces +Y (seen from above), false faces −Y.
   */
  addPlanFace(outline: Vec2[], holes: Vec2[][], elevMm: number, up: boolean): void {
    const outer = ensureCCW(outline);
    const hs = holes.map((h) => (signedArea(h) > 0 ? [...h].reverse() : h));
    const tris = ShapeUtils.triangulateShape(
      outer.map((p) => new Vector2(p.x, p.y)),
      hs.map((h) => h.map((p) => new Vector2(p.x, p.y))),
    );
    const all = [...outer, ...hs.flat()];
    const base = this.vertexCount;
    const ny = up ? 1 : -1;
    for (const p of all) {
      this.pos.push(...w(p, elevMm));
      this.nor.push(0, ny, 0);
      this.uv.push(p.x * MM_TO_M, p.y * MM_TO_M);
    }
    for (const t of tris) {
      // Plan CCW (x east, y north) seen from above is CCW in world when viewed from +Y.
      // Normalise each triangle's winding because the triangulator does not guarantee it.
      const [a, b, c] = [all[t[0]], all[t[1]], all[t[2]]];
      const ccw = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) > 0;
      const [i0, i1, i2] = ccw === up ? [t[0], t[1], t[2]] : [t[0], t[2], t[1]];
      this.idx.push(base + i0, base + i1, base + i2);
    }
  }

  /** Vertical side walls for a closed plan ring between two elevations (outward facing for CCW rings). */
  addPlanRingSides(ring: Vec2[], z0: number, z1: number, outward = true): void {
    const r = outward ? ensureCCW(ring) : [...ensureCCW(ring)].reverse();
    let u = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y) * MM_TO_M;
      // CCW in plan: outward normal is to the right of a→b. Order a0,b0,b1,a1 faces outward.
      this.addPolygon(
        [w(a, z0), w(b, z0), w(b, z1), w(a, z1)],
        [
          [u, z0 * MM_TO_M],
          [u + len, z0 * MM_TO_M],
          [u + len, z1 * MM_TO_M],
          [u, z1 * MM_TO_M],
        ],
      );
      u += len;
    }
  }

  /** Prism: plan outline (+holes) extruded from z0 to z1 (mm). */
  addExtrusion(outline: Vec2[], z0: number, z1: number, holes: Vec2[][] = []): void {
    if (outline.length < 3 || z1 - z0 <= 0) return;
    this.addPlanFace(outline, holes, z1, true);
    this.addPlanFace(outline, holes, z0, false);
    this.addPlanRingSides(outline, z0, z1, true);
    for (const h of holes) this.addPlanRingSides(h, z0, z1, false);
  }

  /** Box centred on plan point `c` (mm), size w×d (plan) × h (vertical), base at z0, rotated deg in plan. */
  addPlanBox(c: Vec2, width: number, depth: number, z0: number, height: number, deg = 0): void {
    const hw = width / 2;
    const hd = depth / 2;
    const ring = [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ].map((p) => {
      const r = rotate(p, deg);
      return { x: r.x + c.x, y: r.y + c.y };
    });
    this.addExtrusion(ring, z0, z0 + height);
  }

  /** Append another mesh (already in world space). */
  append(m: MeshData): void {
    const base = this.vertexCount;
    this.pos.push(...m.positions);
    this.nor.push(...m.normals);
    this.uv.push(...m.uvs);
    for (const i of m.indices) this.idx.push(base + i);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      uvs: new Float32Array(this.uv),
      indices: new Uint32Array(this.idx),
    };
  }
}

/** Planar projection UV for a face with normal n: world metres along two in-plane axes. */
function projectUV(pts: V3[], n: V3): [number, number][] {
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  if (ay >= ax && ay >= az) return pts.map((p) => [p[0], -p[2]]);
  // Vertical-ish face: u along the horizontal tangent, v = height.
  const t = normV([-n[2], 0, n[0]]);
  return pts.map((p) => [p[0] * t[0] + p[2] * t[2], p[1]]);
}

export function emptyMesh(): MeshData {
  return { positions: new Float32Array(), normals: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array() };
}

/** Axis-aligned bounds of a mesh in world metres. */
export function meshBounds(m: MeshData): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], m.positions[i + k]);
      max[k] = Math.max(max[k], m.positions[i + k]);
    }
  }
  return { min, max };
}
