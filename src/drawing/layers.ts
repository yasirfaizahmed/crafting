/**
 * Layer catalogue (AIA CAD Layer Guidelines / ISO 13567 style names), ISO 128 pen weights and
 * ISO 3098 text heights shared by every drawing generator and output format.
 */
import type { DrawingLayer, Linetype } from './types';

/** ISO 128 pen series, paper mm. */
export const PEN = {
  extraFine: 0.13,
  fine: 0.18,
  thin: 0.25,
  medium: 0.35,
  thick: 0.5,
  heavy: 0.7,
} as const;

/** ISO 3098 nominal text heights, paper mm. */
export const TEXT = {
  tiny: 1.8,
  small: 2.5,
  normal: 3.5,
  large: 5,
  title: 7,
} as const;

/**
 * Dash patterns in PAPER mm: positive = dash, negative = gap, 0 = dot (round caps). DXF linetypes
 * use the same numbers with $LTSCALE = drawing scale.
 */
export const LINETYPE_PATTERNS: Record<Linetype, number[]> = {
  continuous: [],
  dashed: [3, -1.5],
  hidden: [1.5, -0.9],
  center: [8, -1.5, 1.5, -1.5],
  phantom: [8, -1.5, 1.5, -1.5, 1.5, -1.5],
  dot: [0, -1],
};

export const LINETYPE_DESCRIPTIONS: Record<Linetype, string> = {
  continuous: 'Solid line',
  dashed: 'Dashed __ __ __ __',
  hidden: 'Hidden _ _ _ _ _ _',
  center: 'Center ____ _ ____ _',
  phantom: 'Phantom ____ _ _ ____',
  dot: 'Dot . . . . . . . .',
};

const L = (name: string, color: string, lineweight: number, linetype: Linetype, description: string, aci?: number): DrawingLayer => ({
  name,
  color,
  lineweight,
  linetype,
  description,
  ...(aci !== undefined ? { aci } : {}),
});

/** Plan layers in painter's order (bottom → top). */
export const PLAN_LAYERS: DrawingLayer[] = [
  L('A-ANNO-REFR', '#b4b4b4', PEN.extraFine, 'continuous', 'Reference: level below', 9),
  L('S-GRID', '#606060', PEN.fine, 'center', 'Structural grid', 1),
  L('A-FLOR', '#404040', PEN.thin, 'continuous', 'Floor slab edges and openings', 8),
  L('I-FURN', '#505050', PEN.fine, 'continuous', 'Furniture and equipment', 30),
  L('A-GENM', '#404040', PEN.thin, 'continuous', 'Generic model (blocks)', 8),
  L('A-FLOR-STRS', '#202020', PEN.thin, 'continuous', 'Stairs: treads, walk line, cut line', 6),
  L('A-FLOR-HRAL', '#202020', PEN.fine, 'continuous', 'Railings and handrails', 6),
  L('A-WALL-PATT', '#5a5a5a', PEN.extraFine, 'continuous', 'Wall poché / material hatching', 8),
  L('A-WALL', '#000000', PEN.thick, 'continuous', 'Walls (cut)', 7),
  L('S-COLS', '#000000', PEN.thick, 'continuous', 'Structural columns (cut, filled)', 7),
  L('A-DOOR', '#000000', PEN.thin, 'continuous', 'Doors: leaves and swings', 3),
  L('A-GLAZ', '#000000', PEN.thin, 'continuous', 'Windows and glazing', 4),
  L('S-BEAM', '#303030', PEN.thin, 'hidden', 'Structural beams (above, hidden)', 1),
  L('A-ROOF', '#303030', PEN.thin, 'dashed', 'Roof outline and overhang (above)', 5),
  L('A-AREA-IDEN', '#000000', PEN.thin, 'continuous', 'Room tags: name, number, area', 2),
  L('A-ANNO-DIMS', '#000000', PEN.fine, 'continuous', 'Dimensions', 1),
  L('A-ANNO-TEXT', '#000000', PEN.thin, 'continuous', 'Text and labels', 7),
  L('A-ANNO-SYMB', '#000000', PEN.thin, 'continuous', 'Symbols: north arrow, scale bar, titles', 7),
];

/** Elevation / section layers in painter's order. */
export const ELEVATION_LAYERS: DrawingLayer[] = [
  L('A-ELEV', '#1a1a1a', PEN.fine, 'continuous', 'Elevation: visible surfaces', 7),
  L('A-SECT-PATT', '#5a5a5a', PEN.extraFine, 'continuous', 'Section: cut hatching', 8),
  L('A-SECT-MCUT', '#000000', PEN.thick, 'continuous', 'Section: material cut', 7),
  L('A-ELEV-OTLN', '#000000', PEN.heavy, 'continuous', 'Ground line and outlines', 7),
  L('A-ANNO-SYMB', '#000000', PEN.thin, 'continuous', 'Symbols: level datums, titles', 7),
  L('A-ANNO-TEXT', '#000000', PEN.thin, 'continuous', 'Text and labels', 7),
  L('A-ANNO-DIMS', '#000000', PEN.fine, 'continuous', 'Dimensions', 1),
];

/** Paper-space layers (sheets: border, title block, tables). */
export const SHEET_LAYERS: DrawingLayer[] = [
  L('G-ANNO-TTLB', '#000000', PEN.thin, 'continuous', 'Sheet border and title block', 7),
  L('G-ANNO-TEXT', '#000000', PEN.thin, 'continuous', 'Sheet text', 7),
  L('G-ANNO-TABL', '#000000', PEN.fine, 'continuous', 'Schedules and tables', 7),
  L('G-ANNO-IMG', '#000000', PEN.fine, 'continuous', 'Images', 7),
];

export const ALL_LAYERS: DrawingLayer[] = [...PLAN_LAYERS, ...ELEVATION_LAYERS.filter((l) => !PLAN_LAYERS.some((p) => p.name === l.name)), ...SHEET_LAYERS];

const BY_NAME = new Map(ALL_LAYERS.map((l) => [l.name, l]));

export function layerByName(name: string): DrawingLayer | undefined {
  return BY_NAME.get(name);
}
