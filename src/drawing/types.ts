import type { HatchPattern } from '../core/materials';
import type { Bounds2 } from '../core/math2d';
import type { Vec2 } from '../core/types';

/**
 * Vector drawing primitives shared by every 2D output (SVG, DXF, PDF, PNG, on-screen sheets).
 * Coordinates are MODEL SPACE millimetres (plan x east / y north, y up — NOT screen space).
 * Text heights and lineweights are PAPER millimetres; multiply by `scale` for model space.
 */
export type Linetype = 'continuous' | 'dashed' | 'hidden' | 'center' | 'phantom' | 'dot';

export interface DrawingLayer {
  /** AIA / ISO 13567 style layer name, e.g. "A-WALL", "A-DOOR", "A-ANNO-DIMS". */
  name: string;
  /** #rrggbb used for screen/PDF output (DXF maps to the nearest ACI colour). */
  color: string;
  /** Pen width in paper mm (0.13, 0.18, 0.25, 0.35, 0.5, 0.7 …). */
  lineweight: number;
  linetype: Linetype;
  description: string;
}

interface EntityBase {
  layer: string;
  /** Overrides the layer colour. */
  color?: string;
  /** Overrides the layer lineweight (paper mm). */
  lineweight?: number;
  linetype?: Linetype;
  /** Source element id (for selection / hyperlinks / DXF handles). */
  elementId?: string;
}

export interface LineEntity extends EntityBase {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}

export interface PolylineEntity extends EntityBase {
  kind: 'polyline';
  points: Vec2[];
  closed: boolean;
}

/** Filled region (cut walls, slabs in section, room fills). Outline is not stroked unless `stroke`. */
export interface FillEntity extends EntityBase {
  kind: 'fill';
  outline: Vec2[];
  holes?: Vec2[][];
  /** Solid fill colour, or a hatch pattern drawn in the entity colour. */
  fill: string;
  hatch?: HatchPattern;
  /** Hatch spacing in paper mm. */
  hatchSpacing?: number;
  stroke?: boolean;
  /** 0..1 fill opacity for screen/PDF. */
  opacity?: number;
}

export interface ArcEntity extends EntityBase {
  kind: 'arc';
  center: Vec2;
  radius: number;
  /** Degrees CCW from +x. The arc runs CCW from start to end. */
  startAngle: number;
  endAngle: number;
}

export interface CircleEntity extends EntityBase {
  kind: 'circle';
  center: Vec2;
  radius: number;
  fill?: string;
}

export interface TextEntity extends EntityBase {
  kind: 'text';
  position: Vec2;
  text: string;
  /** Paper mm (2.5 / 3.5 / 5 / 7 per ISO 3098). */
  height: number;
  /** Degrees CCW. */
  rotation: number;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'baseline' | 'bottom';
  bold?: boolean;
}

/** Aligned linear dimension. Renderers draw extension lines, dimension line, ticks and text. */
export interface DimensionEntity extends EntityBase {
  kind: 'dimension';
  a: Vec2;
  b: Vec2;
  /** Perpendicular offset of the dimension line, model mm, positive = left of a→b. */
  offset: number;
  /** Override text; default is the measured length formatted in the drawing units. */
  text?: string;
}

export type DrawingEntity = LineEntity | PolylineEntity | FillEntity | ArcEntity | CircleEntity | TextEntity | DimensionEntity;

export interface Drawing {
  title: string;
  /** Scale denominator: 100 means 1:100. */
  scale: number;
  units: 'metric' | 'imperial';
  layers: DrawingLayer[];
  /** Painter's order: earlier entities are drawn first (fills before lines). */
  entities: DrawingEntity[];
  /** Model-space extents of all entities. */
  bounds: Bounds2;
}

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0' | 'Letter' | 'Tabloid' | 'ARCH-D';

/** Paper sizes in mm, portrait (width, height). */
export const PAPER_SIZES: Record<PaperSize, [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  A2: [420, 594],
  A1: [594, 841],
  A0: [841, 1189],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
  'ARCH-D': [609.6, 914.4],
};
