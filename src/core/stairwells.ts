/**
 * Stairwells: openings that stairs automatically cut through the floors and ceilings they rise
 * through (the floor above, the ceiling of their own storey), like Revit's stair shafts.
 *
 * Openings are derived on the fly rather than stored, so they follow a stair when it moves, resize
 * with it and close when it is deleted. A slab opts out with `stairOpenings: false`. Every consumer
 * that renders, exports or measures a slab should use `slabHoles()` instead of `slab.holes`.
 */
import { add, centroid, dirFromDeg, dot, ensureCCW, lineIntersection, normalize, perp, pointInPolygon, polygonArea, scale, signedArea, sub } from './math2d';
import { computeStairLayout } from './stairs';
import type { Level, Project, Slab, Stair, Vec2 } from './types';

/** Slack when deciding whether a slab lies within a stair's rise, mm. */
const LEVEL_TOLERANCE = 50;
/** Openings are kept this far inside the slab edge so they stay valid holes, mm. */
const EDGE_CLEARANCE = 1;
/** Ignore slivers smaller than this, mm² (0.01 m²). */
const MIN_OPENING_AREA = 10_000;

type ProjectLike = Pick<Project, 'elements' | 'levels'>;

/** Convex plan outline of a stair: its oriented bounding box, or the circle of a spiral stair. CCW. */
export function stairwellOutline(stair: Stair, levelHeight: number): Vec2[] {
  const layout = computeStairLayout(stair, levelHeight);
  if (stair.shape === 'spiral') return ensureCCW(layout.footprint[0]);
  const f = dirFromDeg(stair.rotation);
  const s = perp(f);
  let f0 = Infinity;
  let f1 = -Infinity;
  let s0 = Infinity;
  let s1 = -Infinity;
  for (const poly of layout.footprint)
    for (const p of poly) {
      const d = sub(p, stair.position);
      f0 = Math.min(f0, dot(d, f));
      f1 = Math.max(f1, dot(d, f));
      s0 = Math.min(s0, dot(d, s));
      s1 = Math.max(s1, dot(d, s));
    }
  const at = (a: number, b: number) => add(stair.position, add(scale(f, a), scale(s, b)));
  return ensureCCW([at(f0, s0), at(f1, s0), at(f1, s1), at(f0, s1)]);
}

/** Absolute elevations a stair spans, mm. */
export function stairSpan(project: Pick<Project, 'levels'>, stair: Stair): { base: number; top: number } | null {
  const level = project.levels.find((l) => l.id === stair.levelId);
  if (!level) return null;
  const base = level.elevation;
  return { base, top: base + (stair.rise ?? level.height) };
}

function slabTop(levels: readonly Level[], slab: Slab): number | null {
  const level = levels.find((l) => l.id === slab.levelId);
  return level ? level.elevation + slab.topOffset : null;
}

/** Does this stair rise through the slab's top surface? (Not the floor it stands on.) */
export function stairPierces(project: ProjectLike, stair: Stair, slab: Slab): boolean {
  if (slab.kind === 'foundation' || slab.stairOpenings === false || stair.hidden) return false;
  const span = stairSpan(project, stair);
  const z = slabTop(project.levels, slab);
  if (!span || z === null) return false;
  return z > span.base + LEVEL_TOLERANCE && z <= span.top + LEVEL_TOLERANCE;
}

/** Automatic stair openings in a slab, clipped to stay strictly inside its outline. */
export function stairwellOpenings(project: ProjectLike, slab: Slab): { stairId: string; polygon: Vec2[] }[] {
  if (slab.outline.length < 3 || slab.kind === 'foundation' || slab.stairOpenings === false) return [];
  let inner: Vec2[] | null = null;
  const out: { stairId: string; polygon: Vec2[] }[] = [];
  for (const el of Object.values(project.elements)) {
    if (el.type !== 'stair' || !stairPierces(project, el, slab)) continue;
    const level = project.levels.find((l) => l.id === el.levelId);
    if (!level) continue;
    inner ??= insetPolygon(ensureCCW(slab.outline), EDGE_CLEARANCE);
    if (!inner) return [];
    const clipped = clipToConvex(inner, stairwellOutline(el, level.height));
    if (clipped.length >= 3 && polygonArea(clipped) >= MIN_OPENING_AREA) out.push({ stairId: el.id, polygon: ensureCCW(clipped) });
  }
  return out;
}

/**
 * Every opening of a slab: the user-drawn `holes` plus automatic stairwells. A stairwell that
 * overlaps a user hole or an earlier stairwell is skipped (the area is already open).
 */
export function slabHoles(project: ProjectLike | null | undefined, slab: Slab): Vec2[][] {
  const holes = (slab.holes ?? []).filter((h) => h.length >= 3);
  if (!project) return holes;
  const out = [...holes];
  for (const { polygon } of stairwellOpenings(project, slab)) {
    if (!out.some((h) => polygonsOverlap(h, polygon))) out.push(polygon);
  }
  return out;
}

/** Net slab area (outline minus all openings), mm². */
export function slabNetArea(project: ProjectLike | null | undefined, slab: Slab): number {
  if (slab.outline.length < 3) return 0;
  const open = slabHoles(project, slab).reduce((a, h) => a + polygonArea(h), 0);
  return Math.max(0, polygonArea(slab.outline) - open);
}

// -----------------------------------------------------------------------------

/** Clip a (possibly concave) polygon to a convex CCW window (Sutherland–Hodgman). */
function clipToConvex(subject: Vec2[], window: Vec2[]): Vec2[] {
  let out = subject;
  for (let i = 0; i < window.length && out.length >= 3; i++) {
    const a = window[i];
    const n = perp(sub(window[(i + 1) % window.length], a)); // inside = left of a→b
    const next: Vec2[] = [];
    for (let k = 0; k < out.length; k++) {
      const p = out[k];
      const q = out[(k + 1) % out.length];
      const fp = dot(sub(p, a), n);
      const fq = dot(sub(q, a), n);
      if (fp >= 0) next.push(p);
      if (fp >= 0 !== fq >= 0) next.push(add(p, scale(sub(q, p), fp / (fp - fq))));
    }
    out = next;
  }
  return out.length >= 3 ? out : [];
}

/** Miter-inset a CCW polygon by `d` mm; null if it collapses. */
function insetPolygon(poly: Vec2[], d: number): Vec2[] | null {
  const n = poly.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    const d1 = normalize(sub(b, a));
    const d2 = normalize(sub(c, b));
    // Inward normal of a CCW edge is its left perpendicular.
    const hit = lineIntersection(add(a, scale(perp(d1), d)), d1, add(b, scale(perp(d2), d)), d2);
    out.push(hit ? hit.point : add(b, scale(perp(d2), d)));
  }
  return signedArea(out) > 0 ? out : null;
}

function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  return (
    pointInPolygon(centroid(a), b) ||
    pointInPolygon(centroid(b), a) ||
    a.some((p) => pointInPolygon(p, b)) ||
    b.some((p) => pointInPolygon(p, a))
  );
}
