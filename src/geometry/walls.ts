/**
 * Wall solids: the join-aware plan footprint extruded to the wall height with every hosted opening
 * cut through the full thickness.
 *
 * The wall is described in wall-local coordinates: u along the location line from `start`,
 * l along wallNormal (left), v above the wall base. Because openings cut straight through the
 * thickness, the solid is { (u,l) ∈ footprint, (u,v) ∈ R } with R = [u range]×[0,H] minus the
 * opening rectangles. Its boundary is assembled from:
 *  - the left/right faces: R restricted to each face's u range (polygons with holes, triangulated);
 *  - the end caps (incl. hub points): R pulled back onto each cap edge;
 *  - every horizontal edge of ∂R (top, bottom, sills, heads): footprint ∩ u-interval at that v;
 *  - every vertical edge of ∂R (jambs): the footprint chord at that u, spanning the edge's v range.
 * All faces meet edge to edge, so the result is watertight, including openings clipped by wall
 * ends, doors with sill 0 (no bottom face) and openings clamped to the wall top.
 */
import { add, dot, scale, signedArea, sub } from '../core/math2d';
import { getMaterial, hasMaterial, materialFor } from '../core/materials';
import type { Opening, Vec2, Wall } from '../core/types';
import { openingInterval, wallBaseElevation, wallDirection, wallFaceOffsets, wallHeight, wallLength, wallNormal } from '../core/walls';
import { hostedOpenings } from './cache';
import { Model, type P3 } from './model';
import { chordAtX, clipSlabX, rectRegion, type Rect } from './poly2d';
import type { GeometryContext, GeometryPart, PartRole } from './types';

/** Wall-local description shared by the wall and opening builders. */
export interface WallFrame {
  wall: Wall;
  start: Vec2;
  dir: Vec2;
  /** Unit normal to the wall's left. */
  nrm: Vec2;
  length: number;
  /** Effective height (mm) and absolute base elevation (mm). */
  height: number;
  base: number;
  /** Lateral offsets of the left/right faces from the location line. */
  left: number;
  right: number;
  /** Footprint in (u, l) coordinates, CCW: startRight, endRight, [endHub], endLeft, startLeft, [startHub]. */
  ul: Vec2[];
  /** Cap chains in (u, l): end cap endRight→…→endLeft, start cap startLeft→…→startRight. */
  caps: Vec2[][];
  uLeft: [number, number];
  uRight: [number, number];
}

export function wallFrame(ctx: GeometryContext, wall: Wall): WallFrame | null {
  const length = wallLength(wall);
  const height = wallHeight(ctx.project, wall);
  if (!(length > 1e-3) || !(height > 1e-3) || !(wall.thickness > 0)) return null;
  const start = wall.start;
  const dir = wallDirection(wall);
  const nrm = wallNormal(wall);
  const faces = wallFaceOffsets(wall);
  const toUL = (p: Vec2): Vec2 => {
    const r = sub(p, start);
    return { x: dot(r, dir), y: dot(r, nrm) };
  };
  const fp = ctx.footprints(wall.levelId).get(wall.id);
  let frame: Pick<WallFrame, 'ul' | 'caps' | 'uLeft' | 'uRight'> | null = null;
  if (fp) {
    const sR = toUL(fp.startRight);
    const eR = toUL(fp.endRight);
    const eL = toUL(fp.endLeft);
    const sL = toUL(fp.startLeft);
    const eH = fp.endHub ? [toUL(fp.endHub)] : [];
    const sH = fp.startHub ? [toUL(fp.startHub)] : [];
    const ul = [sR, eR, ...eH, eL, sL, ...sH];
    const ok =
      eR.x - sR.x > 0.5 &&
      eL.x - sL.x > 0.5 &&
      signedArea(ul) > 1 &&
      Math.abs(sL.y - faces.left) < 1 &&
      Math.abs(eL.y - faces.left) < 1 &&
      Math.abs(sR.y - faces.right) < 1 &&
      Math.abs(eR.y - faces.right) < 1;
    if (ok) frame = { ul, caps: [[eR, ...eH, eL], [sL, ...sH, sR]], uLeft: [sL.x, eL.x], uRight: [sR.x, eR.x] };
  }
  if (!frame) {
    const sR = { x: 0, y: faces.right };
    const eR = { x: length, y: faces.right };
    const eL = { x: length, y: faces.left };
    const sL = { x: 0, y: faces.left };
    frame = { ul: [sR, eR, eL, sL], caps: [[eR, eL], [sL, sR]], uLeft: [0, length], uRight: [0, length] };
  }
  return {
    wall,
    start,
    dir,
    nrm,
    length,
    height,
    base: wallBaseElevation(ctx.project, wall),
    left: faces.left,
    right: faces.right,
    ...frame,
  };
}

/** Wall-local (u, l, v) → plan mm + absolute elevation. */
export function wallPoint(f: WallFrame, u: number, l: number, v: number): P3 {
  const p = add(f.start, add(scale(f.dir, u), scale(f.nrm, l)));
  return [p.x, p.y, f.base + v];
}

/** Opening rectangle in (u, v): [interval] × [sill, sill + height] clamped to the wall height. */
export function openingRect(op: Pick<Opening, 'offset' | 'width' | 'height' | 'sill'>, wallHeightMm: number): Rect | null {
  const [a, b] = openingInterval(op);
  const v0 = Math.max(0, Math.min(wallHeightMm, op.sill));
  const v1 = Math.max(0, Math.min(wallHeightMm, op.sill + op.height));
  if (!(b - a > 1) || !(v1 - v0 > 1) || !Number.isFinite(a + b + v0 + v1)) return null;
  return { x0: a, x1: b, y0: v0, y1: v1 };
}

const role = (materialId: string): PartRole => (getMaterial(materialId).category === 'glass' ? 'glass' : 'body');

export function buildWall(ctx: GeometryContext, wall: Wall): GeometryPart[] {
  const f = wallFrame(ctx, wall);
  if (!f) return [];
  const H = f.height;
  const rects = hostedOpenings(ctx, wall.id)
    .filter((o) => !o.hidden)
    .map((o) => openingRect(o, H))
    .filter((r): r is Rect => !!r);

  const core = materialFor(wall).id;
  const coreRole = role(core);
  const m = new Model(undefined, core, coreRole);
  const P = (u: number, l: number, v: number) => wallPoint(f, u, l, v);
  const n3 = (d: Vec2, s = 1): P3 => [d.x * s, d.y * s, 0];

  const useFace = (finishId: string | undefined, name: string) => {
    if (finishId && hasMaterial(finishId)) m.use(finishId, 'finish', name);
    else m.use(core, coreRole);
  };

  // Long faces.
  useFace(wall.leftFinishId, 'left');
  for (const pg of rectRegion({ x0: f.uLeft[0], x1: f.uLeft[1], y0: 0, y1: H }, rects).polygons)
    m.region(pg.outer, pg.holes, (p) => P(p.x, f.left, p.y), n3(f.nrm));
  useFace(wall.rightFinishId, 'right');
  for (const pg of rectRegion({ x0: f.uRight[0], x1: f.uRight[1], y0: 0, y1: H }, rects).polygons)
    m.region(pg.outer, pg.holes, (p) => P(p.x, f.right, p.y), n3(f.nrm, -1));
  m.use(core, coreRole);

  // End caps (each edge of the cap chains), with the openings pulled back onto the edge.
  for (const chain of f.caps) {
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i];
      const b = chain[i + 1];
      const e = sub(b, a);
      const len = Math.hypot(e.x, e.y);
      if (len < 1e-3) continue;
      const du = e.x / len;
      const holes: Rect[] = [];
      for (const r of rects) {
        if (Math.abs(e.x) < 1e-6) {
          // Cap perpendicular to the wall: covered when the solid side next to it is cut.
          const inward = -e.y / len; // u component of the inward (left) normal
          const probe = a.x + Math.sign(inward) * 0.01;
          if (probe > r.x0 && probe < r.x1) holes.push({ x0: 0, x1: len, y0: r.y0, y1: r.y1 });
        } else {
          const s0 = (r.x0 - a.x) / du;
          const s1 = (r.x1 - a.x) / du;
          holes.push({ x0: Math.min(s0, s1), x1: Math.max(s0, s1), y0: r.y0, y1: r.y1 });
        }
      }
      // Outward normal (right of a→b) in (u, l), expressed in plan.
      const nu = e.y / len;
      const nl = -e.x / len;
      const normal: P3 = [f.dir.x * nu + f.nrm.x * nl, f.dir.y * nu + f.nrm.y * nl, 0];
      for (const pg of rectRegion({ x0: 0, x1: len, y0: 0, y1: H }, holes).polygons)
        m.region(pg.outer, pg.holes, (p) => P(a.x + (e.x * p.x) / len, a.y + (e.y * p.x) / len, p.y), normal);
    }
  }

  // Top, bottom, sills, heads and jambs from the boundary of R.
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const p of f.ul) {
    uMin = Math.min(uMin, p.x);
    uMax = Math.max(uMax, p.x);
  }
  const R = rectRegion({ x0: uMin - 1, x1: uMax + 1, y0: 0, y1: H }, rects);
  for (const loop of R.loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (Math.abs(a.y - b.y) < 1e-9) {
        // Horizontal: moving +u means the solid is above (face looks down).
        const down = b.x > a.x;
        const piece = clipSlabX(f.ul, Math.min(a.x, b.x), Math.max(a.x, b.x));
        if (piece.length >= 3) m.region(piece, [], (p) => P(p.x, p.y, a.y), [0, 0, down ? -1 : 1]);
      } else {
        // Vertical: moving +v means the solid lies at smaller u (face looks along +u).
        const sgn = b.y > a.y ? 1 : -1;
        const v0 = Math.min(a.y, b.y);
        const v1 = Math.max(a.y, b.y);
        for (const [l0, l1] of chordAtX(f.ul, a.x)) {
          const quad = [
            { x: l0, y: v0 },
            { x: l1, y: v0 },
            { x: l1, y: v1 },
            { x: l0, y: v1 },
          ];
          m.region(quad, [], (p) => P(a.x, p.x, p.y), n3(f.dir, sgn));
        }
      }
    }
  }
  return m.parts();
}
