/**
 * 2D documentation drawings generated from the BIM model.
 *
 *   generatePlanDrawing(project, levelId, options) → Drawing (model-space mm)
 *
 * NOTE: phase-0 baseline (wall outlines only). The drawing module owner implements the full
 * architectural plan (cut walls with hatches, door swings, window symbols, stairs with
 * break line + arrow, furniture symbols, room tags with areas, dimension chains, grid, north arrow).
 */
import { boundsOf, emptyBounds } from '../core/math2d';
import type { Project } from '../core/types';
import { computeWallFootprints } from '../core/walls';
import type { Drawing, DrawingLayer } from './types';

export * from './types';

export interface PlanDrawingOptions {
  /** Scale denominator, default 100. */
  scale?: number;
  includeFurniture?: boolean;
  includeDimensions?: boolean;
  includeRoomTags?: boolean;
  /** Draw the level below as a faded underlay (for the on-screen editor). */
  includeLevelBelow?: boolean;
}

export const STANDARD_LAYERS: DrawingLayer[] = [
  { name: 'A-WALL', color: '#000000', lineweight: 0.5, linetype: 'continuous', description: 'Walls (cut)' },
];

export function generatePlanDrawing(project: Project, levelId: string, options: PlanDrawingOptions = {}): Drawing {
  const level = project.levels.find((l) => l.id === levelId);
  const entities: Drawing['entities'] = [];
  for (const fp of computeWallFootprints(project, levelId).values()) {
    entities.push({ kind: 'polyline', layer: 'A-WALL', points: fp.polygon, closed: true, elementId: fp.wallId });
  }
  const pts = entities.flatMap((e) => (e.kind === 'polyline' ? e.points : []));
  return {
    title: `${level?.name ?? 'Level'} — Floor Plan`,
    scale: options.scale ?? 100,
    units: project.settings.units,
    layers: STANDARD_LAYERS,
    entities,
    bounds: pts.length ? boundsOf(pts) : emptyBounds(),
  };
}
