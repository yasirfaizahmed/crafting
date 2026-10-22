/**
 * 2D documentation drawings generated from the BIM model.
 *
 *   generatePlanDrawing(project, levelId, options) → Drawing (model-space mm)
 *   generateElevationDrawing(project, side) / generateSectionDrawing(project, cut) → Drawing
 *   doorSchedule / windowSchedule / roomSchedule / wallQuantities → ScheduleTable
 *   hatchLines(outline, holes, pattern, spacing, angle) → clipped hatch segments
 *
 * Every Drawing uses AIA / ISO 13567 layers with ISO 128 lineweights and ISO 3098 text heights,
 * and is consumed by the SVG, DXF, PDF and PNG exporters (src/export).
 */
import { PLAN_LAYERS } from './layers';
import type { DrawingLayer } from './types';

export * from './types';
export { generatePlanDrawing, planTitle, DEFAULT_CUT_HEIGHT, type PlanDrawingOptions } from './plan';
export { hatchLines, hatchFamilies, HATCHES, defaultHatchSpacing } from './hatch';
export { PLAN_LAYERS, ELEVATION_LAYERS, SHEET_LAYERS, ALL_LAYERS, PEN, TEXT, LINETYPE_PATTERNS, layerByName } from './layers';
export { explodeDimension, formatDimension } from './dimension';
export { DrawingBuilder, drawingBounds } from './builder';

/** Standard plan layers (painter's order). */
export const STANDARD_LAYERS: DrawingLayer[] = PLAN_LAYERS;
