/**
 * Walls in plan: cut walls as poché (material hatch on A-WALL-PATT) with a heavy union outline on
 * A-WALL; openings cut through the full wall thickness leave gaps closed by jamb lines. Walls
 * below the cut plane are drawn thin, walls above it hidden.
 */
import { angleDeg } from '../../core/math2d';
import { materialFor } from '../../core/materials';
import type { Opening, Vec2, Wall } from '../../core/types';
import { openingInterval, pointAtOffset, wallCenterOffset, wallDirection, wallHeight, wallLength } from '../../core/walls';
import { chainSegments, clipPolygonStrip, unionOutline, type UnionPolygon } from '../geom';
import { PEN } from '../layers';
import { openingIsCut, wallIsCut, type PlanContext } from './context';

/** Solid poché colour for cut walls whose material has no section hatch (plaster, paint, …). */
export const POCHE_GREY = '#c8c8c8';

export interface WallPiece {
  wall: Wall;
  polygon: Vec2[];
}

/** Solid (non-gap) intervals of a wall along its location line, given its cut openings. */
export function solidIntervals(openings: Pick<Opening, 'offset' | 'width'>[]): [number, number][] {
  const gaps = openings.map((o) => openingInterval(o)).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let lo = -Infinity;
  for (const [a, b] of gaps) {
    if (a > lo) out.push([lo, a]);
    lo = Math.max(lo, b);
  }
  out.push([lo, Infinity]);
  return out;
}

/** Wall footprint pieces between cut openings. */
export function wallPieces(ctx: PlanContext, w: Wall, openings: Opening[]): WallPiece[] {
  const fp = ctx.footprints.get(w.id);
  if (!fp) return [];
  const dir = wallDirection(w);
  return solidIntervals(openings)
    .map(([lo, hi]) => clipPolygonStrip(fp.polygon, w.start, dir, lo, hi))
    .filter((p) => p.length >= 3)
    .map((polygon) => ({ wall: w, polygon }));
}

export function drawWalls(ctx: PlanContext): void {
  const { b } = ctx;
  const walls = ctx.elements.filter((e): e is Wall => e.type === 'wall');
  const openings = ctx.elements.filter((e): e is Opening => e.type === 'door' || e.type === 'window');
  const cutPieces: WallPiece[] = [];
  const lowPieces: WallPiece[] = [];
  const highPieces: WallPiece[] = [];
  const glass: WallPiece[] = [];
  for (const w of walls) {
    const isCut = wallIsCut(ctx, w);
    const hosted = openings.filter((o) => o.hostId === w.id && (!isCut || openingIsCut(ctx, w, o)));
    const pieces = wallPieces(ctx, w, isCut ? hosted : []);
    if (materialFor(w).category === 'glass') glass.push(...pieces);
    else if (isCut) cutPieces.push(...pieces);
    else if (w.baseOffset + wallHeight(ctx.project, w) <= ctx.cut) lowPieces.push(...pieces);
    else highPieces.push(...pieces);
  }

  // Poché first (painter's order is per layer: A-WALL-PATT sits under A-WALL).
  for (const p of cutPieces) {
    const mat = materialFor(p.wall);
    const angle = mat.hatch === 'wood' || mat.hatch === 'insulation' ? angleDeg(wallDirection(p.wall)) : 0;
    if (mat.hatch === 'none' || mat.hatch === 'solid') {
      b.fill('A-WALL-PATT', p.polygon, mat.hatch === 'solid' ? '#000000' : POCHE_GREY, { elementId: p.wall.id, tag: 'poche' });
    } else {
      b.fill('A-WALL-PATT', p.polygon, '#ffffff', { hatch: mat.hatch, elementId: p.wall.id, tag: 'poche', ...(angle ? { hatchAngle: angle } : {}) });
    }
  }

  const emit = (pieces: WallPiece[], extra: { lineweight?: number; linetype?: 'hidden'; tag: string }) => {
    if (!pieces.length) return;
    const polys: UnionPolygon[] = pieces.map((p) => ({ polygon: p.polygon, key: `${materialFor(p.wall).id}` }));
    const { outline, seams } = unionOutline(polys);
    for (const c of chainSegments(outline)) {
      b.polyline('A-WALL', c.points, c.closed, extra);
    }
    for (const c of chainSegments(seams)) b.polyline('A-WALL', c.points, c.closed, { lineweight: PEN.fine, tag: 'seam' });
  };
  emit(cutPieces, { tag: 'cut' });
  emit(lowPieces, { lineweight: PEN.thin, tag: 'below-cut' });
  emit(highPieces, { lineweight: PEN.fine, linetype: 'hidden', tag: 'above-cut' });

  // Glass walls: thin face lines with the glazing line on A-GLAZ.
  for (const p of glass) {
    b.polyline('A-WALL', p.polygon, true, { lineweight: PEN.thin, elementId: p.wall.id, tag: 'glass-wall' });
    const c = wallCenterOffset(p.wall);
    b.line('A-GLAZ', pointAtOffset(p.wall, 0, c), pointAtOffset(p.wall, wallLength(p.wall), c), { lineweight: PEN.fine, elementId: p.wall.id, tag: 'glass' });
  }
}
