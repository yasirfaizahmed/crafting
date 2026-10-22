/**
 * Roofs.
 *
 * Pitched shapes (gable, hip, shed, pyramid) are generated over the outline's bounding rectangle in
 * a roof-local frame whose x axis runs along `ridgeAngle`, expanded by the overhang. The roof
 * underside is z = eave + min_i f_i(x, y) over a few planes f_i (each rising from one wall line at
 * the pitch: rise = run · tan(pitch)); the region where plane i is lowest is the rectangle clipped
 * by half-planes, so hips and ridges fall out exactly. The top surface is the underside raised by
 * the vertical thickness thickness / cos(pitch) (exact for equal-pitch planes), so the solid is
 * watertight: top faces, soffits and vertical fascia/verge faces around the perimeter.
 *
 * Gable / shed ends get infill solids from the wall top up to the roof underside, in the material of
 * the wall found below that edge (plaster when none is found).
 *
 * Flat roofs support any simple outline (offset by the overhang) with an optional low parapet:
 * `props.parapet` = parapet height in mm (default 300 when the overhang is 0, otherwise none).
 *
 * The shed roof's high side is the +y side of the roof-local frame (left of the ridge direction).
 */
import { add, dot, ensureCCW, rotate, signedArea, sub } from '../core/math2d';
import { materialFor } from '../core/materials';
import type { Project, Roof, RoofShape, Vec2, Wall } from '../core/types';
import { getLevel, wallBaseElevation, wallCenterOffset, wallDirection, wallHeight, wallLength, wallNormal } from '../core/walls';
import { allWalls, levelWalls } from './cache';
import { Model, placement, type P3 } from './model';
import { clipConvex, clipHalfPlane, dedupe, offsetPolygon } from './poly2d';
import { cleanRing } from './slabs';
import type { GeometryContext, GeometryPart } from './types';

export interface RoofPlane {
  /** Plan polygon (mm, CCW) covered by this roof plane, overhang included. */
  polygon: Vec2[];
  /** Absolute elevation (mm) of the TOP surface at each polygon vertex. */
  elevations: number[];
  /** Unit plan vector pointing downhill; (0, 0) for a flat plane. */
  downhill: Vec2;
  /** Slope in degrees. */
  pitch: number;
}

export type RoofLineKind = 'ridge' | 'hip' | 'eave' | 'verge';

export interface RoofLine {
  a: Vec2;
  b: Vec2;
  kind: RoofLineKind;
}

export interface RoofPlanes {
  shape: RoofShape;
  planes: RoofPlane[];
  /** Ridges and hips (interior), eaves and verges (perimeter), in plan mm. */
  lines: RoofLine[];
  /** Outer roof edge in plan (wall line expanded by the overhang), CCW. */
  outline: Vec2[];
  /** Wall-line polygon: the oriented rectangle for pitched shapes, the outline for flat roofs. */
  wallLine: Vec2[];
  /** Underside elevation at the wall line (mm, absolute). */
  eaveElevation: number;
  /** Highest point of the top surface (mm, absolute). */
  ridgeElevation: number;
  /** Vertical thickness of the roof build-up (mm). */
  verticalThickness: number;
}

/** z = a·x + b·y + c (relative to the eave), in roof-local coordinates. */
interface Plane {
  a: number;
  b: number;
  c: number;
}

interface PitchedRoof {
  kind: 'pitched';
  angle: number;
  eave: number;
  /** Wall-line rectangle and expanded rectangle in local coords. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  X0: number;
  X1: number;
  Y0: number;
  Y1: number;
  planes: Plane[];
  regions: Vec2[][];
  dz: number;
}

interface FlatRoof {
  kind: 'flat';
  eave: number;
  outline: Vec2[];
  wallLine: Vec2[];
  dz: number;
}

const evalPlane = (p: Plane, q: Vec2) => p.a * q.x + p.b * q.y + p.c;

function roofEave(project: Pick<Project, 'levels'>, roof: Roof): number {
  const lvl = getLevel(project, roof.levelId);
  return (lvl?.elevation ?? 0) + (roof.baseOffset ?? lvl?.height ?? 3000);
}

function analyseRoof(project: Pick<Project, 'levels'>, roof: Roof): PitchedRoof | FlatRoof | null {
  const outline = cleanRing(roof.outline);
  if (!outline.length || !(roof.thickness > 0)) return null;
  const eave = roofEave(project, roof);
  const overhang = Math.max(0, Number.isFinite(roof.overhang) ? roof.overhang : 0);
  const pitch = Math.max(0, Math.min(75, Number.isFinite(roof.pitch) ? roof.pitch : 0));
  if (roof.shape === 'flat' || pitch < 0.01) {
    const outer = overhang > 0 ? ensureCCW(offsetPolygon(outline, overhang)) : outline;
    return { kind: 'flat', eave, outline: outer, wallLine: outline, dz: roof.thickness };
  }
  const angle = Number.isFinite(roof.ridgeAngle) ? roof.ridgeAngle : 0;
  const local = outline.map((p) => rotate(p, -angle));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of local) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const k = Math.tan((pitch * Math.PI) / 180);
  const sx = (x1 - x0) / 2;
  const sy = (y1 - y0) / 2;
  const S: Plane = { a: 0, b: k, c: -k * y0 };
  const N: Plane = { a: 0, b: -k, c: k * y1 };
  const Wp: Plane = { a: k, b: 0, c: -k * x0 };
  const E: Plane = { a: -k, b: 0, c: k * x1 };
  let planes: Plane[];
  switch (roof.shape) {
    case 'shed':
      planes = [S];
      break;
    case 'hip':
      planes = [S, N, Wp, E];
      break;
    case 'pyramid': {
      const h = k * Math.min(sx, sy);
      planes = [
        { a: 0, b: h / sy, c: (-h / sy) * y0 },
        { a: 0, b: -h / sy, c: (h / sy) * y1 },
        { a: h / sx, b: 0, c: (-h / sx) * x0 },
        { a: -h / sx, b: 0, c: (h / sx) * x1 },
      ];
      break;
    }
    default:
      planes = [S, N];
  }
  const X0 = x0 - overhang;
  const X1 = x1 + overhang;
  const Y0 = y0 - overhang;
  const Y1 = y1 + overhang;
  const rect: Vec2[] = [
    { x: X0, y: Y0 },
    { x: X1, y: Y0 },
    { x: X1, y: Y1 },
    { x: X0, y: Y1 },
  ];
  const regions = planes.map((pi, i) => {
    let poly = rect;
    planes.forEach((pj, j) => {
      if (j === i || poly.length < 3) return;
      poly = clipHalfPlane(poly, pj.a - pi.a, pj.b - pi.b, pj.c - pi.c);
    });
    return poly.length >= 3 ? poly : [];
  });
  const slope = Math.max(...planes.map((p) => Math.hypot(p.a, p.b)));
  return { kind: 'pitched', angle, eave, x0, x1, y0, y1, X0, X1, Y0, Y1, planes, regions, dz: roof.thickness * Math.sqrt(1 + slope * slope) };
}

const onRectSide = (r: PitchedRoof, p: Vec2, q: Vec2): boolean => {
  const e = 1e-6 * Math.max(1, Math.abs(r.X1 - r.X0) + Math.abs(r.Y1 - r.Y0));
  const same = (v1: number, v2: number, t: number) => Math.abs(v1 - t) < e && Math.abs(v2 - t) < e;
  return same(p.x, q.x, r.X0) || same(p.x, q.x, r.X1) || same(p.y, q.y, r.Y0) || same(p.y, q.y, r.Y1);
};

/** Roof planes, ridge/hip/eave/verge lines and key elevations for drawings (plan mm). */
export function roofPlanes(project: Pick<Project, 'levels'>, roof: Roof): RoofPlanes | null {
  const a = analyseRoof(project, roof);
  if (!a) return null;
  if (a.kind === 'flat') {
    const top = a.eave + a.dz;
    const n = a.outline.length;
    return {
      shape: roof.shape,
      planes: [{ polygon: a.outline, elevations: a.outline.map(() => top), downhill: { x: 0, y: 0 }, pitch: 0 }],
      lines: a.outline.map((p, i) => ({ a: p, b: a.outline[(i + 1) % n], kind: 'eave' as const })),
      outline: a.outline,
      wallLine: a.wallLine,
      eaveElevation: a.eave,
      ridgeElevation: top,
      verticalThickness: a.dz,
    };
  }
  const toPlan = (p: Vec2) => rotate(p, a.angle);
  const planes: RoofPlane[] = [];
  const lines: RoofLine[] = [];
  const seen = new Set<string>();
  const key = (p: Vec2) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  let ridge = -Infinity;
  a.regions.forEach((reg, i) => {
    if (reg.length < 3) return;
    const pl = a.planes[i];
    const g = Math.hypot(pl.a, pl.b);
    const elevations = reg.map((p) => a.eave + evalPlane(pl, p) + a.dz);
    for (const z of elevations) ridge = Math.max(ridge, z);
    planes.push({
      polygon: reg.map(toPlan),
      elevations,
      downhill: g > 1e-12 ? rotate({ x: -pl.a / g, y: -pl.b / g }, a.angle) : { x: 0, y: 0 },
      pitch: (Math.atan(g) * 180) / Math.PI,
    });
    for (let j = 0; j < reg.length; j++) {
      const p = reg[j];
      const q = reg[(j + 1) % reg.length];
      if (Math.hypot(q.x - p.x, q.y - p.y) < 0.5) continue;
      const level = Math.abs(evalPlane(pl, p) - evalPlane(pl, q)) < 0.5;
      if (onRectSide(a, p, q)) {
        lines.push({ a: toPlan(p), b: toPlan(q), kind: level ? 'eave' : 'verge' });
        continue;
      }
      const k1 = key(p);
      const k2 = key(q);
      const k = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push({ a: toPlan(p), b: toPlan(q), kind: level ? 'ridge' : 'hip' });
    }
  });
  const rect = [
    { x: a.X0, y: a.Y0 },
    { x: a.X1, y: a.Y0 },
    { x: a.X1, y: a.Y1 },
    { x: a.X0, y: a.Y1 },
  ];
  const wallLine = [
    { x: a.x0, y: a.y0 },
    { x: a.x1, y: a.y0 },
    { x: a.x1, y: a.y1 },
    { x: a.x0, y: a.y1 },
  ];
  return {
    shape: roof.shape,
    planes,
    lines,
    outline: rect.map(toPlan),
    wallLine: wallLine.map(toPlan),
    eaveElevation: a.eave,
    ridgeElevation: ridge,
    verticalThickness: a.dz,
  };
}

export const ROOF_SOFFIT_MATERIAL = 'plaster-white';
export const ROOF_FASCIA_MATERIAL = 'paint-white';
const DEFAULT_INFILL = 'plaster-white';

/** Roofing that needs a pitch (tiles, slates, shingles) is shown as a membrane on flat roofs unless chosen explicitly. */
const PITCH_ONLY_ROOFING = new Set(['roof-tiles-clay', 'roof-shingles-grey', 'roof-slate']);
export const FLAT_ROOF_DEFAULT_MATERIAL = 'roof-membrane';

export function buildRoof(ctx: GeometryContext, roof: Roof): GeometryPart[] {
  const a = analyseRoof(ctx.project, roof);
  if (!a) return [];
  let mat = materialFor(roof).id;
  if (a.kind === 'flat' && !roof.materialId && PITCH_ONLY_ROOFING.has(mat)) mat = FLAT_ROOF_DEFAULT_MATERIAL;
  return a.kind === 'flat' ? buildFlat(ctx, roof, a, mat) : buildPitched(ctx, a, mat);
}

function buildPitched(ctx: GeometryContext, r: PitchedRoof, mat: string): GeometryPart[] {
  const m = new Model(placement(0, 0, 0, r.angle), mat);
  r.regions.forEach((reg, i) => {
    if (reg.length < 3) return;
    const pl = r.planes[i];
    const under = (p: Vec2) => r.eave + evalPlane(pl, p);
    m.use(mat, 'body');
    m.region(reg, [], (p) => [p.x, p.y, under(p) + r.dz], [-pl.a, -pl.b, 1]);
    m.use(ROOF_SOFFIT_MATERIAL, 'finish', 'soffit');
    m.region(reg, [], (p) => [p.x, p.y, under(p)], [pl.a, pl.b, -1]);
    m.use(ROOF_FASCIA_MATERIAL, 'detail', 'fascia');
    for (let j = 0; j < reg.length; j++) {
      const p = reg[j];
      const q = reg[(j + 1) % reg.length];
      if (!onRectSide(r, p, q)) continue;
      m.poly([
        [p.x, p.y, under(p)],
        [q.x, q.y, under(q)],
        [q.x, q.y, under(q) + r.dz],
        [p.x, p.y, under(p) + r.dz],
      ]);
    }
  });
  buildInfills(ctx, m, r);
  return m.parts();
}

interface SideInfo {
  /** Offsets of the infill band's outer/inner edges, measured inward from the wall line. */
  dOut: number;
  dIn: number;
  base: number;
  material: string;
  detected: boolean;
}

/** Find the wall supporting each side of the wall-line rectangle (S, E, N, W in roof-local terms). */
function sideSupports(ctx: GeometryContext, r: PitchedRoof): SideInfo[] {
  const sides = [
    { axis: 'y' as const, at: r.y0, inward: 1, lo: r.x0, hi: r.x1 },
    { axis: 'x' as const, at: r.x1, inward: -1, lo: r.y0, hi: r.y1 },
    { axis: 'y' as const, at: r.y1, inward: -1, lo: r.x0, hi: r.x1 },
    { axis: 'x' as const, at: r.x0, inward: 1, lo: r.y0, hi: r.y1 },
  ];
  const walls = allWalls(ctx).filter((w) => !w.hidden && wallLength(w) > 1);
  return sides.map((s) => {
    let best: { wall: Wall; score: number; c: number } | undefined;
    for (const w of walls) {
      const top = wallBaseElevation(ctx.project, w) + wallHeight(ctx.project, w);
      if (Math.abs(top - r.eave) > 1000) continue;
      const d = rotate(wallDirection(w), -r.angle);
      const along = s.axis === 'y' ? Math.abs(d.x) : Math.abs(d.y);
      if (along < 0.999) continue;
      const off = wallCenterOffset(w);
      const n = wallNormal(w);
      const a = rotate(add(w.start, { x: n.x * off, y: n.y * off }), -r.angle);
      const b = rotate(add(w.end, { x: n.x * off, y: n.y * off }), -r.angle);
      const c = s.axis === 'y' ? (a.y + b.y) / 2 : (a.x + b.x) / 2;
      if (Math.abs(c - s.at) > w.thickness / 2 + 60) continue;
      const u0 = s.axis === 'y' ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
      const u1 = s.axis === 'y' ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
      const overlap = Math.min(u1, s.hi) - Math.max(u0, s.lo);
      if (overlap < 0.25 * (s.hi - s.lo)) continue;
      const score = overlap - Math.abs(c - s.at);
      if (!best || score > best.score) best = { wall: w, score, c };
    }
    if (!best) return { dOut: 0, dIn: 200, base: r.eave, material: DEFAULT_INFILL, detected: false };
    const t = best.wall.thickness;
    const inner = s.inward * (best.c - s.at); // centre distance inward from the wall line
    return {
      dOut: inner - t / 2,
      dIn: inner + t / 2,
      base: Math.min(r.eave, wallBaseElevation(ctx.project, best.wall) + wallHeight(ctx.project, best.wall)),
      material: materialFor(best.wall).id,
      detected: true,
    };
  });
}

function buildInfills(ctx: GeometryContext, m: Model, r: PitchedRoof): void {
  const info = sideSupports(ctx, r);
  const [S, E, N, W] = info;
  // Mitred band corners (out/in) at SW, SE, NE, NW.
  const corner = (cx: 'x0' | 'x1', cy: 'y0' | 'y1', which: 'dOut' | 'dIn'): Vec2 => {
    const sx = cx === 'x0' ? W : E;
    const sy = cy === 'y0' ? S : N;
    return {
      x: cx === 'x0' ? r.x0 + sx[which] : r.x1 - sx[which],
      y: cy === 'y0' ? r.y0 + sy[which] : r.y1 - sy[which],
    };
  };
  const bands: Vec2[][] = [
    [corner('x0', 'y0', 'dOut'), corner('x1', 'y0', 'dOut'), corner('x1', 'y0', 'dIn'), corner('x0', 'y0', 'dIn')],
    [corner('x1', 'y0', 'dOut'), corner('x1', 'y1', 'dOut'), corner('x1', 'y1', 'dIn'), corner('x1', 'y0', 'dIn')],
    [corner('x1', 'y1', 'dOut'), corner('x0', 'y1', 'dOut'), corner('x0', 'y1', 'dIn'), corner('x1', 'y1', 'dIn')],
    [corner('x0', 'y1', 'dOut'), corner('x0', 'y0', 'dOut'), corner('x0', 'y0', 'dIn'), corner('x0', 'y1', 'dIn')],
  ];
  const sideLine: [Vec2, Vec2][] = [
    [
      { x: r.x0, y: r.y0 },
      { x: r.x1, y: r.y0 },
    ],
    [
      { x: r.x1, y: r.y0 },
      { x: r.x1, y: r.y1 },
    ],
    [
      { x: r.x1, y: r.y1 },
      { x: r.x0, y: r.y1 },
    ],
    [
      { x: r.x0, y: r.y1 },
      { x: r.x0, y: r.y0 },
    ],
  ];
  const underside = (p: Vec2) => Math.min(...r.planes.map((pl) => evalPlane(pl, p)));
  bands.forEach((rawBand, i) => {
    const side = info[i];
    if (!side.detected) {
      // Only gable/shed ends need an infill without a supporting wall: the underside rises at the wall line.
      const [a, b] = sideLine[i];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (Math.max(underside(a), underside(b), underside(mid)) < 1) return;
    }
    const band = ensureCCW(dedupe(rawBand, 1e-6));
    if (band.length < 3) return;
    const rel = side.base - r.eave;
    m.use(side.material, 'body', 'infill');
    r.regions.forEach((reg, j) => {
      if (reg.length < 3) return;
      const pl = r.planes[j];
      let piece = clipConvex(band, reg);
      if (piece.length >= 3) piece = clipHalfPlane(piece, pl.a, pl.b, pl.c - rel);
      if (piece.length < 3) return;
      const top = (p: Vec2) => r.eave + evalPlane(pl, p);
      m.region(piece, [], (p) => [p.x, p.y, side.base], [0, 0, -1]);
      m.region(piece, [], (p) => [p.x, p.y, top(p)], [-pl.a, -pl.b, 1]);
      for (let k = 0; k < piece.length; k++) {
        const p = piece[k];
        const q = piece[(k + 1) % piece.length];
        if (!onPolygonBoundary(band, p, q)) continue;
        const pts: P3[] = [
          [p.x, p.y, side.base],
          [q.x, q.y, side.base],
          [q.x, q.y, Math.max(side.base, top(q))],
          [p.x, p.y, Math.max(side.base, top(p))],
        ];
        m.poly(pts);
      }
    });
  });
}

/** True if segment p→q lies along an edge of `poly`. */
function onPolygonBoundary(poly: Vec2[], p: Vec2, q: Vec2): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ab = sub(b, a);
    const len = Math.hypot(ab.x, ab.y);
    if (len < 1e-9) continue;
    const n = { x: -ab.y / len, y: ab.x / len };
    if (Math.abs(dot(sub(p, a), n)) < 1e-4 && Math.abs(dot(sub(q, a), n)) < 1e-4) return true;
  }
  return false;
}

function buildFlat(ctx: GeometryContext, roof: Roof, r: FlatRoof, mat: string): GeometryPart[] {
  const m = new Model(undefined, mat);
  const top = r.eave + r.dz;
  const ring = r.outline;
  m.use(mat, 'body');
  m.region(ring, [], (p) => [p.x, p.y, top], [0, 0, 1]);
  m.use(ROOF_SOFFIT_MATERIAL, 'finish', 'soffit');
  m.region(ring, [], (p) => [p.x, p.y, r.eave], [0, 0, -1]);
  m.use(ROOF_FASCIA_MATERIAL, 'detail', 'fascia');
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    m.poly([
      [a.x, a.y, r.eave],
      [b.x, b.y, r.eave],
      [b.x, b.y, top],
      [a.x, a.y, top],
    ]);
  }
  const prop = roof.props?.parapet;
  const parapet = typeof prop === 'number' && Number.isFinite(prop) ? Math.max(0, prop) : roof.overhang > 0 ? 0 : 300;
  const inner = ensureCCW(offsetPolygon(ring, -150));
  const innerCoping = ensureCCW(offsetPolygon(ring, -165));
  const shrinks = (p: Vec2[]) => p.length === ring.length && signedArea(p) > 0 && signedArea(p) < signedArea(ring);
  if (parapet > 0 && shrinks(inner) && shrinks(innerCoping)) {
    m.use(dominantWallMaterial(ctx, roof.levelId, r.eave), 'body', 'parapet');
    m.prism(ring, top, top + parapet, [inner]);
    m.use('aluminium', 'detail', 'coping');
    m.prism(ensureCCW(offsetPolygon(ring, 15)), top + parapet, top + parapet + 30, [innerCoping]);
  }
  return m.parts();
}

/** Material of the walls (by total length) on a level whose top is at `eave`; plaster if none. */
function dominantWallMaterial(ctx: GeometryContext, levelId: string, eave: number): string {
  const tally = new Map<string, number>();
  for (const w of levelWalls(ctx, levelId)) {
    if (w.hidden) continue;
    const top = wallBaseElevation(ctx.project, w) + wallHeight(ctx.project, w);
    if (Math.abs(top - eave) > 1000) continue;
    const id = materialFor(w).id;
    tally.set(id, (tally.get(id) ?? 0) + wallLength(w));
  }
  let best = DEFAULT_INFILL;
  let bestLen = 0;
  for (const [id, len] of tally) {
    if (len > bestLen) {
      best = id;
      bestLen = len;
    }
  }
  return best;
}
