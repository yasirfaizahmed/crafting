/**
 * Structural members: columns (rectangular, round 24-gon, steel H sections) and beams
 * (rectangular, steel I sections) along start → end with the top at `topOffset`.
 */
import { angleDeg, distance, sub } from '../core/math2d';
import { getMaterial, materialFor } from '../core/materials';
import type { Beam, Column, Vec2 } from '../core/types';
import { levelElevation, levelHeight } from './cache';
import { Model, placement } from './model';
import type { GeometryContext, GeometryPart } from './types';

export const ROUND_COLUMN_SEGMENTS = 24;

const roleFor = (mat: string) => (getMaterial(mat).category === 'glass' ? 'glass' : 'body');
const isMetal = (mat: string) => getMaterial(mat).category === 'metal';

/**
 * Wide-flange (H / I) section outline, CCW: flanges of width `b` across `a`, total depth `d`.
 * Coordinates (u, v) centred on the section.
 */
export function wideFlange(b: number, d: number): Vec2[] {
  const tf = Math.max(6, Math.min(d * 0.08, d / 4));
  const tw = Math.max(5, Math.min(b * 0.05, b / 4));
  const hb = b / 2;
  const hd = d / 2;
  return [
    { x: -hb, y: -hd },
    { x: hb, y: -hd },
    { x: hb, y: -hd + tf },
    { x: tw / 2, y: -hd + tf },
    { x: tw / 2, y: hd - tf },
    { x: hb, y: hd - tf },
    { x: hb, y: hd },
    { x: -hb, y: hd },
    { x: -hb, y: hd - tf },
    { x: -tw / 2, y: hd - tf },
    { x: -tw / 2, y: -hd + tf },
    { x: -hb, y: -hd + tf },
  ];
}

export function buildColumn(ctx: GeometryContext, c: Column): GeometryPart[] {
  const h = c.height ?? levelHeight(ctx, c.levelId);
  if (!(h > 0) || !(c.width > 0) || !(c.depth > 0)) return [];
  const mat = materialFor(c).id;
  const m = new Model(placement(c.position.x, c.position.y, levelElevation(ctx, c.levelId) + c.baseOffset, c.rotation), mat, roleFor(mat));
  if (c.shape === 'round') m.cylinder(0, 0, 0, h, c.width / 2, ROUND_COLUMN_SEGMENTS, c.width / 2, c.depth / 2);
  else if (isMetal(mat)) m.prism(wideFlange(c.width, c.depth), 0, h);
  else m.box(-c.width / 2, -c.depth / 2, 0, c.width / 2, c.depth / 2, h);
  return m.parts();
}

export function buildBeam(ctx: GeometryContext, b: Beam): GeometryPart[] {
  const len = distance(b.start, b.end);
  if (len < 1 || !(b.width > 0) || !(b.depth > 0)) return [];
  const top = levelElevation(ctx, b.levelId) + (b.topOffset ?? levelHeight(ctx, b.levelId));
  const mat = materialFor(b).id;
  const m = new Model(placement(b.start.x, b.start.y, top - b.depth, angleDeg(sub(b.end, b.start))), mat, roleFor(mat));
  if (isMetal(mat)) {
    // Section in (y, z): flanges horizontal (top/bottom), web vertical.
    const sec = wideFlange(b.width, b.depth).map((p) => ({ x: p.x, y: p.y + b.depth / 2 }));
    m.prismX(sec, 0, len);
  } else m.box(0, -b.width / 2, 0, len, b.width / 2, b.depth);
  return m.parts();
}
