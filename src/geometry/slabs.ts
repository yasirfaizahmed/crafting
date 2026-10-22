/**
 * Slabs: the outline (with holes) extruded downward from the slab top. Floor slabs whose material
 * is a floor finish (wood, tile, stone, fabric) put that finish on the top face only and give the
 * underside (the ceiling of the room below) and the edges a plaster finish.
 */
import { ensureCCW, pointInPolygon, signedArea, simplifyPolygon } from '../core/math2d';
import { getMaterial, materialFor } from '../core/materials';
import type { Slab, Vec2 } from '../core/types';
import { levelElevation } from './cache';
import { Model } from './model';
import { dedupe } from './poly2d';
import type { GeometryContext, GeometryPart } from './types';

const FINISH_CATEGORIES = new Set(['wood', 'tile', 'stone', 'fabric']);
export const SLAB_UNDERSIDE_MATERIAL = 'plaster-white';

/** Clean a plan ring: finite points, no duplicates/collinear points, CCW. */
export function cleanRing(ring: Vec2[] | undefined): Vec2[] {
  if (!ring || ring.length < 3) return [];
  const pts = dedupe(ring.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 0.01);
  if (pts.length < 3) return [];
  const s = simplifyPolygon(pts, 0.01);
  if (s.length < 3 || Math.abs(signedArea(s)) < 1) return [];
  return ensureCCW(s);
}

/** Holes that lie inside the outline (CW). Holes crossing the outline are dropped. */
export function cleanHoles(outline: Vec2[], holes: Vec2[][] | undefined): Vec2[][] {
  const out: Vec2[][] = [];
  for (const h of holes ?? []) {
    const r = cleanRing(h);
    if (!r.length) continue;
    if (!r.every((p) => pointInPolygon(p, outline))) continue;
    out.push([...r].reverse());
  }
  return out;
}

export function buildSlab(ctx: GeometryContext, s: Slab): GeometryPart[] {
  const outline = cleanRing(s.outline);
  if (!outline.length || !(s.thickness > 0)) return [];
  const holes = cleanHoles(outline, s.holes);
  const top = levelElevation(ctx, s.levelId) + s.topOffset;
  const bottom = top - s.thickness;
  const mat = materialFor(s).id;
  const finish = s.kind === 'floor' && FINISH_CATEGORIES.has(getMaterial(mat).category);
  const body = finish ? SLAB_UNDERSIDE_MATERIAL : mat;
  const m = new Model(undefined, body);
  if (finish) m.use(mat, 'finish', 'top');
  m.region(outline, holes, (p) => [p.x, p.y, top], [0, 0, 1]);
  m.use(body, 'body');
  m.region(outline, holes, (p) => [p.x, p.y, bottom], [0, 0, -1]);
  for (const ring of [outline, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      m.poly([
        [a.x, a.y, bottom],
        [b.x, b.y, bottom],
        [b.x, b.y, top],
        [a.x, a.y, top],
      ]);
    }
  }
  return m.parts();
}
