/**
 * Architectural floor plan generation: BIM elements of one level → layered Drawing in model mm.
 *
 * Cut plane at `cutHeight` (default 1200 mm above the level): cut walls are poché'd with their
 * material hatch and outlined heavy, openings leave gaps, stairs break at the cut, elements above
 * the cut (roof overhang, beams, high windows, wall cabinets) are hidden/dashed.
 */
import { detectOuterBoundaries } from '../core/rooms';
import { isEmptyBounds } from '../core/math2d';
import type { Column, Element, Level, Project } from '../core/types';
import { computeWallFootprints, wallLength } from '../core/walls';
import { DrawingBuilder, drawingBounds } from './builder';
import { chainSegments, unionOutline } from './geom';
import { PLAN_LAYERS } from './layers';
import { drawDimensionElement, drawExteriorChains, drawLabel, drawNorthArrow, drawRoomTag, drawViewTitle } from './plan/annotation';
import { mm, type PlanContext } from './plan/context';
import { drawFurniture } from './plan/furniture';
import { drawOpenings } from './plan/openings';
import { drawRailing, drawStair } from './plan/stairs';
import { drawBeam, drawBlock, drawColumn, drawGrid, drawRoof, drawSlab } from './plan/structure';
import { drawWalls } from './plan/walls';
import type { Drawing } from './types';

export interface PlanDrawingOptions {
  /** Scale denominator, default 100. */
  scale?: number;
  includeFurniture?: boolean;
  includeDimensions?: boolean;
  includeRoomTags?: boolean;
  /** Draw the level below as a faded underlay (for the on-screen editor). */
  includeLevelBelow?: boolean;
  /** Automatic exterior dimension chains (default: with includeDimensions). */
  autoDimensions?: boolean;
  /** Structural grid through the columns (default: when the level has 2+ columns). */
  includeGrid?: boolean;
  /** View title, scale and scale bar under the plan (default true). */
  includeTitle?: boolean;
  includeNorthArrow?: boolean;
  /** Plan cut plane height above the level, mm (default 1200). */
  cutHeight?: number;
}

export const DEFAULT_CUT_HEIGHT = 1200;

/** "Ground Floor" → "GROUND FLOOR PLAN". */
export function planTitle(level: Pick<Level, 'name'>): string {
  const n = (level.name || 'Level').trim().toUpperCase();
  return /PLAN$/.test(n) ? n : `${n} PLAN`;
}

export function generatePlanDrawing(project: Project, levelId: string, options: PlanDrawingOptions = {}): Drawing {
  const level: Level = project.levels.find((l) => l.id === levelId) ?? { id: levelId, name: 'Level', elevation: 0, height: project.settings.levelHeight || 3000 };
  const scale = options.scale && options.scale > 0 ? options.scale : 100;
  const b = new DrawingBuilder(scale, project.settings.units);
  const elements = Object.values(project.elements).filter((e) => e.levelId === levelId && !e.hidden);
  const ctx: PlanContext = {
    project,
    level,
    b,
    scale,
    cut: options.cutHeight ?? DEFAULT_CUT_HEIGHT,
    elements,
    footprints: computeWallFootprints(project, levelId),
    outer: detectOuterBoundaries(project, levelId).map((x) => x.polygon),
  };

  if (options.includeLevelBelow) drawLevelBelow(ctx);
  const columns: Column[] = [];
  for (const el of elements) {
    switch (el.type) {
      case 'slab':
        drawSlab(ctx, el);
        break;
      case 'roof':
        drawRoof(ctx, el);
        break;
      case 'column':
        columns.push(el);
        drawColumn(ctx, el);
        break;
      case 'beam':
        drawBeam(ctx, el);
        break;
      case 'block':
        drawBlock(ctx, el);
        break;
      case 'furniture':
        if (options.includeFurniture !== false) drawFurniture(ctx, el);
        break;
      case 'stair':
        drawStair(ctx, el, 'up', level.height);
        break;
      case 'railing':
        drawRailing(ctx, el.path, el.id);
        break;
      default:
        break;
    }
  }
  drawStairsFromBelow(ctx);
  drawWalls(ctx);
  drawOpenings(ctx);

  // Building extent (for the grid): architecture drawn so far, without furniture / underlay.
  const archLayers = PLAN_LAYERS.map((l) => l.name).filter((n) => n !== 'I-FURN' && n !== 'A-ANNO-REFR');
  const buildingExtent = drawingBounds(b.only(archLayers), scale, b.units);
  const hasExtent = !isEmptyBounds(buildingExtent);
  if (hasExtent && (options.includeGrid ?? columns.length >= 2) && columns.length) drawGrid(ctx, columns, buildingExtent);

  if (options.includeRoomTags !== false) for (const el of elements) if (el.type === 'room') drawRoomTag(ctx, el);
  for (const el of elements) if (el.type === 'label') drawLabel(ctx, el);
  if (options.includeDimensions !== false) {
    for (const el of elements) if (el.type === 'dimension') drawDimensionElement(ctx, el);
    // Chains go outside the building, its grid and the user's own annotation.
    if ((options.autoDimensions ?? true) && hasExtent) drawExteriorChains(ctx, drawingBounds(b.only(archLayers), scale, b.units));
  }

  const all = drawingBounds(b.entities(PLAN_LAYERS), scale, b.units);
  if (!isEmptyBounds(all)) {
    if (options.includeNorthArrow !== false) drawNorthArrow(ctx, { x: all.maxX + mm(ctx, 14), y: all.maxY - mm(ctx, 12) });
    if (options.includeTitle !== false) drawViewTitle(ctx, planTitle(level), { x: all.minX, y: all.minY - mm(ctx, 12) }, true);
  }
  return b.build(`${level.name || 'Level'} — Floor Plan`, PLAN_LAYERS);
}

function levelBelow(project: Project, level: Level): Level | undefined {
  const sorted = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  const i = sorted.findIndex((l) => l.id === level.id);
  return i > 0 ? sorted[i - 1] : undefined;
}

/** Stairs rising from the level below into this level, drawn as seen from above (DN). */
function drawStairsFromBelow(ctx: PlanContext): void {
  const below = levelBelow(ctx.project, ctx.level);
  if (!below) return;
  for (const el of Object.values(ctx.project.elements) as Element[]) {
    if (el.type !== 'stair' || el.levelId !== below.id || el.hidden) continue;
    const top = below.elevation + (el.rise ?? below.height);
    if (top < ctx.level.elevation - 50) continue;
    drawStair(ctx, el, 'down', below.height);
  }
}

/** Faded outline of the walls on the level below (reference underlay). */
function drawLevelBelow(ctx: PlanContext): void {
  const below = levelBelow(ctx.project, ctx.level);
  if (!below) return;
  const fps = computeWallFootprints(ctx.project, below.id);
  const polys = [...fps.values()].filter((f) => {
    const w = ctx.project.elements[f.wallId];
    return w && w.type === 'wall' && !w.hidden && wallLength(w) > 1;
  });
  const { outline } = unionOutline(polys.map((f) => ({ polygon: f.polygon })));
  for (const c of chainSegments(outline)) ctx.b.polyline('A-ANNO-REFR', c.points, c.closed, { tag: 'level-below' });
}
