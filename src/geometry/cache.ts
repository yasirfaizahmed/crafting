/**
 * Per-GeometryContext lookup tables (openings by host, walls by level, level centres). Keyed by the
 * context object in a WeakMap so contexts created by other modules work without extra fields.
 */
import { getLevel } from '../core/walls';
import type { Opening, Vec2, Wall } from '../core/types';
import type { GeometryContext } from './types';

interface Cache {
  openings?: Map<string, Opening[]>;
  walls?: Map<string, Wall[]>;
  centers: Map<string, Vec2 | null>;
}

const caches = new WeakMap<GeometryContext, Cache>();

function cache(ctx: GeometryContext): Cache {
  let c = caches.get(ctx);
  if (!c) {
    c = { centers: new Map() };
    caches.set(ctx, c);
  }
  return c;
}

/** Doors and windows hosted by `wallId`. */
export function hostedOpenings(ctx: GeometryContext, wallId: string): Opening[] {
  const c = cache(ctx);
  if (!c.openings) {
    c.openings = new Map();
    for (const e of Object.values(ctx.project.elements)) {
      if (e.type !== 'door' && e.type !== 'window') continue;
      const list = c.openings.get(e.hostId);
      if (list) list.push(e);
      else c.openings.set(e.hostId, [e]);
    }
  }
  return c.openings.get(wallId) ?? [];
}

/** All walls of a level (including zero-length ones). */
export function levelWalls(ctx: GeometryContext, levelId: string): Wall[] {
  const c = cache(ctx);
  if (!c.walls) {
    c.walls = new Map();
    for (const e of Object.values(ctx.project.elements)) {
      if (e.type !== 'wall') continue;
      const list = c.walls.get(e.levelId);
      if (list) list.push(e);
      else c.walls.set(e.levelId, [e]);
    }
  }
  return c.walls.get(levelId) ?? [];
}

/** Every wall in the project. */
export function allWalls(ctx: GeometryContext): Wall[] {
  levelWalls(ctx, '');
  return [...(cache(ctx).walls?.values() ?? [])].flat();
}

/** Centre of the walls' bounding box on a level (used to tell interior from exterior faces). */
export function levelCenter(ctx: GeometryContext, levelId: string): Vec2 | null {
  const c = cache(ctx);
  if (c.centers.has(levelId)) return c.centers.get(levelId) ?? null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of levelWalls(ctx, levelId)) {
    for (const p of [w.start, w.end]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const center = minX <= maxX ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : null;
  c.centers.set(levelId, center);
  return center;
}

export const levelElevation = (ctx: GeometryContext, levelId: string): number => getLevel(ctx.project, levelId)?.elevation ?? 0;
export const levelHeight = (ctx: GeometryContext, levelId: string): number => getLevel(ctx.project, levelId)?.height ?? 3000;
