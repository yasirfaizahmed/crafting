import { pointInPolygon } from '../../core/math2d';
import type { Element, Level, Opening, Project, Vec2, Wall } from '../../core/types';
import { pointAtOffset, wallDirection, wallFaceOffsets, wallHeight, wallNormal, type WallFootprint } from '../../core/walls';
import type { DrawingBuilder } from '../builder';

/** Everything the per-element plan generators need. */
export interface PlanContext {
  project: Project;
  level: Level;
  b: DrawingBuilder;
  /** Scale denominator. */
  scale: number;
  /** Plan cut plane height above the level, mm. */
  cut: number;
  /** Visible elements on the level. */
  elements: Element[];
  footprints: Map<string, WallFootprint>;
  /** Outer building outlines (outer wall faces), used to find exterior sides. */
  outer: Vec2[][];
}

/** Paper mm → model mm. */
export const mm = (ctx: Pick<PlanContext, 'scale'>, paper: number): number => paper * ctx.scale;

/** Local frame of an opening in its host wall. */
export interface OpeningFrame {
  wall: Wall;
  /** Start / end of the opening along the location line. */
  a: number;
  b: number;
  /** Lateral offsets of the left / right faces. */
  left: number;
  right: number;
  dir: Vec2;
  normal: Vec2;
  at(s: number, lateral: number): Vec2;
}

export function openingFrame(wall: Wall, op: Pick<Opening, 'offset' | 'width'>): OpeningFrame {
  const faces = wallFaceOffsets(wall);
  return {
    wall,
    a: op.offset - op.width / 2,
    b: op.offset + op.width / 2,
    left: faces.left,
    right: faces.right,
    dir: wallDirection(wall),
    normal: wallNormal(wall),
    at: (s, lat) => pointAtOffset(wall, s, lat),
  };
}

/** True if the wall is cut by the plan cut plane. */
export function wallIsCut(ctx: Pick<PlanContext, 'project' | 'cut'>, w: Wall): boolean {
  return w.baseOffset <= ctx.cut && w.baseOffset + wallHeight(ctx.project, w) > ctx.cut;
}

/** True if the opening's vertical extent contains the cut plane (it shows as a gap in the wall). */
export function openingIsCut(ctx: Pick<PlanContext, 'cut'>, host: Wall, op: Opening): boolean {
  const base = host.baseOffset + op.sill;
  return base <= ctx.cut + 1e-6 && base + op.height >= ctx.cut - 1e-6;
}

/**
 * Exterior side of a wall at an opening: +1 = left face is exterior, −1 = right face is exterior,
 * 0 = interior wall (both sides inside the building).
 */
export function exteriorSide(ctx: Pick<PlanContext, 'outer'>, fr: OpeningFrame): -1 | 0 | 1 {
  const s = (fr.a + fr.b) / 2;
  const probe = 150;
  const inside = (lat: number) => ctx.outer.some((poly) => pointInPolygon(fr.at(s, lat), poly));
  const l = inside(fr.left + probe);
  const r = inside(fr.right - probe);
  if (l && !r) return -1;
  if (r && !l) return 1;
  if (l && r) return 0;
  return -1;
}
