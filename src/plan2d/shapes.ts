/**
 * Plan-space shapes of elements (pure): outlines for hit testing, box selection and framing.
 */
import { getFurniture } from '../core/catalog';
import {
  add,
  type Bounds2,
  closestOnSegment,
  dirFromDeg,
  distance,
  emptyBounds,
  extendBounds,
  normalize,
  orientedRect,
  perp,
  pointInPolygon,
  polygonArea,
  rotate,
  scale,
  segmentIntersection,
  signedArea,
  sub,
  lineIntersection,
} from '../core/math2d';
import { computeStairLayout } from '../core/stairs';
import type { Block, Dimension, Element, ElementType, Furniture, Label, Level, Opening, Vec2, Wall } from '../core/types';
import { pointAtOffset, wallDirection, wallFaceOffsets, wallLength, wallNormal, type WallFootprint } from '../core/walls';

/** Plan text height multiplier: label `size` is paper mm at a nominal 1:100. */
export const LABEL_SCALE = 100;

export interface ShapeContext {
  elements: Record<string, Element>;
  footprints: Map<string, WallFootprint>;
  level?: Pick<Level, 'height'>;
}

/** Local frame of an opening in its host wall. */
export interface OpeningFrame {
  wall: Wall;
  /** Along-wall interval of the opening. */
  a: number;
  b: number;
  /** Lateral offsets of the wall's left / right faces. */
  left: number;
  right: number;
  dir: Vec2;
  normal: Vec2;
  /** Point at distance `s` along the location line and `lat` across it. */
  at(s: number, lat: number): Vec2;
}

export function openingFrame(wall: Wall, op: Pick<Opening, 'offset' | 'width'>): OpeningFrame {
  const faces = wallFaceOffsets(wall);
  const dir = wallDirection(wall);
  const normal = wallNormal(wall);
  return {
    wall,
    a: op.offset - op.width / 2,
    b: op.offset + op.width / 2,
    left: faces.left,
    right: faces.right,
    dir,
    normal,
    at: (s, lat) => pointAtOffset(wall, s, lat),
  };
}

export function furnitureSize(f: Furniture): { w: number; d: number } {
  const def = getFurniture(f.catalogId);
  return { w: f.width ?? def?.width ?? 1000, d: f.depth ?? def?.depth ?? 1000 };
}

export function furnitureOutline(f: Furniture): Vec2[] {
  const { w, d } = furnitureSize(f);
  return orientedRect(f.position, w, d, f.rotation);
}

export function blockOutline(b: Block): Vec2[] {
  const o = { x: b.position.x, y: b.position.y };
  return [
    { x: 0, y: 0 },
    { x: b.size.x, y: 0 },
    { x: b.size.x, y: b.size.y },
    { x: 0, y: b.size.y },
  ].map((p) => add(rotate(p, b.rotation), o));
}

export function circlePolygon(c: Vec2, r: number, n = 24): Vec2[] {
  return Array.from({ length: n }, (_, i) => add(c, scale(dirFromDeg((360 * i) / n), r)));
}

export function labelBox(l: Label): Vec2[] {
  const h = l.size * LABEL_SCALE;
  const w = Math.max(h, l.text.length * h * 0.58);
  return orientedRect(l.position, w, h * 1.3, l.rotation);
}

export function dimensionLine(d: Dimension): { a: Vec2; b: Vec2; n: Vec2 } {
  const n = perp(normalize(sub(d.b, d.a)));
  return { a: add(d.a, scale(n, d.offset)), b: add(d.b, scale(n, d.offset)), n };
}

function segmentQuad(a: Vec2, b: Vec2, half: number): Vec2[] {
  const n = scale(perp(normalize(sub(b, a))), half);
  return [sub(a, n), sub(b, n), add(b, n), add(a, n)];
}

/** Outline polygons of an element in plan (model mm). */
export function elementPolygons(el: Element, ctx: ShapeContext): Vec2[][] {
  switch (el.type) {
    case 'wall': {
      const fp = ctx.footprints.get(el.id);
      if (fp) return [fp.polygon];
      const f = wallFaceOffsets(el);
      return [[pointAtOffset(el, 0, f.right), pointAtOffset(el, wallLength(el), f.right), pointAtOffset(el, wallLength(el), f.left), pointAtOffset(el, 0, f.left)]];
    }
    case 'door':
    case 'window': {
      const host = ctx.elements[el.hostId];
      if (!host || host.type !== 'wall') return [];
      const fr = openingFrame(host, el);
      const polys = [[fr.at(fr.a, fr.right), fr.at(fr.b, fr.right), fr.at(fr.b, fr.left), fr.at(fr.a, fr.left)]];
      if (el.type === 'door' && (el.style === 'single' || el.style === 'double')) {
        // Swing area so the leaf/arc is clickable.
        const side = el.flip ? -1 : 1;
        const lat = side > 0 ? fr.left : fr.right;
        const reach = el.style === 'double' ? el.width / 2 : el.width;
        polys.push([fr.at(fr.a, lat), fr.at(fr.b, lat), fr.at(fr.b, lat + side * reach), fr.at(fr.a, lat + side * reach)]);
      }
      return polys;
    }
    case 'slab':
    case 'room':
    case 'roof':
      return el.outline.length >= 3 ? [el.outline] : [];
    case 'stair':
      return computeStairLayout(el, ctx.level?.height ?? 3000).footprint;
    case 'column':
      return el.shape === 'round' ? [circlePolygon(el.position, el.width / 2)] : [orientedRect(el.position, el.width, el.depth, el.rotation)];
    case 'beam':
      return distance(el.start, el.end) > 1 ? [segmentQuad(el.start, el.end, el.width / 2)] : [];
    case 'furniture':
      return [furnitureOutline(el)];
    case 'block':
      return el.shape === 'cylinder' || el.shape === 'sphere'
        ? [circlePolygon(add({ x: el.position.x, y: el.position.y }, rotate({ x: el.size.x / 2, y: el.size.y / 2 }, el.rotation)), Math.min(el.size.x, el.size.y) / 2)]
        : [blockOutline(el)];
    case 'railing': {
      const out: Vec2[][] = [];
      for (let i = 0; i + 1 < el.path.length; i++) if (distance(el.path[i], el.path[i + 1]) > 1) out.push(segmentQuad(el.path[i], el.path[i + 1], 40));
      return out;
    }
    case 'dimension': {
      const l = dimensionLine(el);
      return distance(l.a, l.b) > 1 ? [segmentQuad(l.a, l.b, 60)] : [];
    }
    case 'label':
      return [labelBox(el)];
  }
}

export function elementBounds(els: Element[], ctx: ShapeContext): Bounds2 {
  const b = emptyBounds();
  for (const el of els) for (const poly of elementPolygons(el, ctx)) for (const p of poly) extendBounds(b, p);
  return b;
}

/** Selection priority: lower wins when several elements are under the cursor. */
const PRIORITY: Record<ElementType, number> = {
  label: 0,
  dimension: 0,
  door: 1,
  window: 1,
  column: 2,
  furniture: 2,
  stair: 2,
  block: 2,
  railing: 2,
  beam: 3,
  wall: 3,
  room: 5,
  slab: 6,
  roof: 7,
};

function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]).distance);
  return d;
}

export interface HitOptions {
  types?: ElementType[];
  exclude?: Set<string>;
  /** Area elements (rooms, slabs, roofs) only count when the point is inside, not near the edge. */
  areas?: boolean;
}

/** Topmost element under `p` (within `tol` mm of its outline). */
export function hitTest(els: Element[], ctx: ShapeContext, p: Vec2, tol: number, opts: HitOptions = {}): Element | undefined {
  let best: { el: Element; pri: number; d: number; area: number; inside: boolean } | undefined;
  for (const el of els) {
    if (el.hidden || opts.exclude?.has(el.id)) continue;
    if (opts.types && !opts.types.includes(el.type)) continue;
    const isArea = el.type === 'room' || el.type === 'slab' || el.type === 'roof';
    if (isArea && opts.areas === false) continue;
    let inside = false;
    let d = Infinity;
    let area = Infinity;
    for (const poly of elementPolygons(el, ctx)) {
      if (poly.length < 2) continue;
      const pin = poly.length >= 3 && pointInPolygon(p, poly);
      const pd = pin ? 0 : distanceToPolygon(p, poly);
      if (pin && el.type === 'slab' && (el.holes ?? []).some((h) => pointInPolygon(p, h))) continue;
      if (pin) inside = true;
      d = Math.min(d, pd);
      area = Math.min(area, poly.length >= 3 ? polygonArea(poly) : 0);
    }
    if (!inside && (isArea || d > tol)) continue;
    const pri = PRIORITY[el.type];
    // Elements under the point beat ones merely near it; then priority, distance, size.
    const better =
      !best ||
      (inside && !best.inside) ||
      (inside === best.inside && (pri < best.pri || (pri === best.pri && (d < best.d - 1e-6 || (Math.abs(d - best.d) < 1e-6 && area < best.area)))));
    if (better) best = { el, pri, d, area, inside };
  }
  return best?.el;
}

/**
 * Ids of elements selected by a box: 'window' = entirely inside; 'crossing' = inside or touching
 * the box edges.
 */
export function elementsInBox(els: Element[], ctx: ShapeContext, box: Bounds2, mode: 'window' | 'crossing'): string[] {
  const inBox = (q: Vec2) => q.x >= box.minX && q.x <= box.maxX && q.y >= box.minY && q.y <= box.maxY;
  const corners: Vec2[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  const out: string[] = [];
  for (const el of els) {
    if (el.hidden) continue;
    const polys = elementPolygons(el, ctx).filter((poly) => poly.length >= 2);
    if (!polys.length) continue;
    if (mode === 'window') {
      if (polys.every((poly) => poly.every(inBox))) out.push(el.id);
      continue;
    }
    const hit = polys.some((poly) => {
      if (poly.some(inBox)) return true;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        for (let k = 0; k < 4; k++) if (segmentIntersection(a, b, corners[k], corners[(k + 1) % 4])) return true;
      }
      // A small element-free box inside a furniture/wall outline still "crosses" it, but areas don't.
      return el.type !== 'room' && el.type !== 'slab' && el.type !== 'roof' && poly.length >= 3 && pointInPolygon(corners[0], poly);
    });
    if (hit) out.push(el.id);
  }
  return out;
}

/** Offset a CCW polygon outward by `d` (mitred). */
export function offsetPolygon(poly: Vec2[], d: number): Vec2[] {
  const ccw = signedArea(poly) >= 0 ? poly : [...poly].reverse();
  const n = ccw.length;
  const lines = ccw.map((q, i) => {
    const r = ccw[(i + 1) % n];
    const dir = normalize(sub(r, q));
    const off = scale(perp(dir), -d);
    return { p: add(q, off), dir };
  });
  return lines.map((l, i) => {
    const prev = lines[(i + n - 1) % n];
    const hit = lineIntersection(prev.p, prev.dir, l.p, l.dir);
    return hit ? hit.point : l.p;
  });
}
