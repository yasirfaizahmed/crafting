/**
 * Core BIM data model for Crafting.
 *
 * Conventions (read ARCHITECTURE.md for the full contract):
 *  - All model lengths are MILLIMETRES (industry standard for metric architecture).
 *  - Plan coordinates: x = east, y = north, viewed from above (right-handed).
 *  - Angles stored on elements are DEGREES, counter-clockwise from +x in plan.
 *  - Elevations are measured upward; a level's `elevation` is the top of its floor finish.
 *  - Elements are plain JSON-serialisable objects. Never put class instances in them.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A raster blueprint/sketch image placed under a level's plan for tracing. */
export interface LevelUnderlay {
  /** data: URL of the image. */
  src: string;
  /** Plan position (mm) of the image's top-left corner. */
  x: number;
  y: number;
  /** Millimetres per image pixel (set by two-point calibration). */
  mmPerPixel: number;
  /** Degrees CCW. */
  rotation: number;
  opacity: number;
  visible: boolean;
}

export interface Level {
  id: string;
  name: string;
  /** Elevation of the level datum (top of floor) in mm. */
  elevation: number;
  /** Floor-to-floor height in mm. Walls without an explicit height use this. */
  height: number;
  underlay?: LevelUnderlay;
}

export type ElementType =
  | 'wall'
  | 'door'
  | 'window'
  | 'slab'
  | 'roof'
  | 'stair'
  | 'column'
  | 'beam'
  | 'furniture'
  | 'room'
  | 'block'
  | 'railing'
  | 'dimension'
  | 'label';

/** Arbitrary user metadata, exported as a property set (IFC) / extended data. */
export type PropValue = string | number | boolean;

export interface ElementBase {
  id: string;
  type: ElementType;
  levelId: string;
  name?: string;
  /** Primary material (see core/materials.ts). Falls back to a per-type default. */
  materialId?: string;
  /**
   * Material overrides for individual parts of the element's 3D model, keyed by part name (or role
   * for unnamed parts): e.g. a door's 'frame' / 'panel', a sofa's 'seat', a stair's 'handrail'.
   */
  partMaterials?: Record<string, string>;
  props?: Record<string, PropValue>;
  locked?: boolean;
  hidden?: boolean;
}

export type WallJustification = 'center' | 'left' | 'right';

export interface Wall extends ElementBase {
  type: 'wall';
  /** Location line start/end (plan, mm). */
  start: Vec2;
  end: Vec2;
  thickness: number;
  /** Explicit height in mm. Undefined = the level's floor-to-floor height. */
  height?: number;
  /** Offset of the wall base from the level elevation, mm. */
  baseOffset: number;
  /**
   * Where the location line sits relative to the wall body, looking from start to end.
   * 'left' means the body lies to the right of the line (line is the left face).
   */
  justification: WallJustification;
  structural: boolean;
  /** Optional finish materials per face (left/right looking start→end). */
  leftFinishId?: string;
  rightFinishId?: string;
}

export type DoorStyle = 'single' | 'double' | 'sliding' | 'pocket' | 'garage' | 'opening';
export type WindowStyle = 'casement' | 'sliding' | 'fixed' | 'awning' | 'double-hung';

interface HostedOpeningBase extends ElementBase {
  /** Host wall id. Openings are always hosted by a wall on the same level. */
  hostId: string;
  /** Distance along the host wall location line from wall.start to the opening CENTRE, mm. */
  offset: number;
  width: number;
  height: number;
  /** Bottom of the opening above the wall base, mm. */
  sill: number;
}

export interface Door extends HostedOpeningBase {
  type: 'door';
  style: DoorStyle;
  /** Hinge side looking from the wall's left side towards the right side. */
  hinge: 'left' | 'right';
  /** true = door leaf swings to the wall's right side instead of the left side. */
  flip: boolean;
  frameMaterialId?: string;
  /** Leaf design of swing and pocket doors. Default 'panelled'. */
  leaf?: 'panelled' | 'flush' | 'glazed' | 'half-glazed';
  /** How far swing leaves stand open in 3D, degrees (0 = closed). */
  openAngle?: number;
  /** Lining / casing width, mm (default 35). */
  frameWidth?: number;
}

export interface Window extends HostedOpeningBase {
  type: 'window';
  style: WindowStyle;
  frameMaterialId?: string;
  /** Sashes / panes across (casement and fixed windows). Undefined = by width. */
  panes?: number;
  /** Glazing bars per pane: vertical (x) and horizontal (y) bar counts. */
  glazingBars?: { x: number; y: number };
  /** Frame width, mm (default 60). */
  frameWidth?: number;
  /** Where the frame sits in the wall depth. Default 'center'. */
  setback?: 'outside' | 'center' | 'inside';
}

export type Opening = Door | Window;

export type SlabKind = 'floor' | 'ceiling' | 'foundation' | 'terrace';

export interface Slab extends ElementBase {
  type: 'slab';
  /** Outer boundary, counter-clockwise, no repeated closing vertex. */
  outline: Vec2[];
  holes?: Vec2[][];
  thickness: number;
  /** Top of slab relative to the level elevation (mm). Floor slabs: 0, ceilings: level.height. */
  topOffset: number;
  kind: SlabKind;
  /**
   * Stairs rising through this slab cut an opening automatically (core/stairwells.ts).
   * Undefined = true; set false to keep the slab solid.
   */
  stairOpenings?: boolean;
}

export type RoofShape = 'flat' | 'gable' | 'hip' | 'shed' | 'pyramid';

export interface Roof extends ElementBase {
  type: 'roof';
  /**
   * Footprint at eave level, CCW. 'flat' supports any simple polygon; pitched shapes are
   * generated over the oriented bounding rectangle of the outline (ridge along `ridgeAngle`).
   */
  outline: Vec2[];
  shape: RoofShape;
  /** Pitch in degrees (ignored for flat). */
  pitch: number;
  overhang: number;
  thickness: number;
  /** Eave (bottom of roof at the wall line) relative to level elevation, mm. Default = level height. */
  baseOffset?: number;
  /** Direction of the ridge in plan, degrees. Gable ends are perpendicular to this. */
  ridgeAngle: number;
}

/** 'open-well': U stair of three flights and two corner landings around an open well. */
export type StairShape = 'straight' | 'l-shape' | 'u-shape' | 'open-well' | 'spiral';

/** One straight run of a custom stair (see Stair.runs). */
export interface StairFlightSpec {
  /** Treads (goings) in the flight. Its risers = treads + 1: the last one lands on the next landing or floor. */
  treads: number;
  /** Tread depth (going) of this flight, mm. Undefined = the stair's `tread`. */
  going?: number;
  /** Clear width of this flight, mm. Undefined = the stair's `width`. */
  width?: number;
}

/** The landing between two flights of a custom stair. */
export interface StairLandingSpec {
  /** 'none' = straight-through landing; 'left' / 'right' = the next flight turns that way. */
  turn: 'none' | 'left' | 'right';
  /** Quarter (90°) or half (180°, U) turn. Ignored for 'none'. Default 90. */
  angle?: 90 | 180;
  /** Landing length along the incoming flight, mm. Undefined = just fits the next flight. */
  depth?: number;
  /** Half turns: the open well between the two flights, mm. Undefined = 100. */
  gap?: number;
  /**
   * Extra landing beyond the flights on the left / right (looking up the arriving flight), mm.
   * Undefined = 0. On the side a quarter turn leaves from, it is the walk before the next flight
   * starts (the next flight moves out with that edge); every other side just grows the platform.
   */
  extendLeft?: number;
  extendRight?: number;
  /** Quarter turns: landing continuing past the far side of the next flight, mm. Undefined = 0. */
  beyond?: number;
}

/** Flights and landings in walking order: landings[i] sits between flights[i] and flights[i + 1]. */
export interface StairRuns {
  flights: StairFlightSpec[];
  landings: StairLandingSpec[];
}

export type StairStructure = 'auto' | 'solid' | 'stringers';
export type StairRisers = 'auto' | 'closed' | 'open';
export type StairHandrails = 'both' | 'left' | 'right' | 'none';

export interface Stair extends ElementBase {
  type: 'stair';
  /** Centre of the bottom edge of the first tread (plan, mm). */
  position: Vec2;
  /** Direction of travel going up, degrees CCW from +x. */
  rotation: number;
  width: number;
  shape: StairShape;
  /** Total rise in mm. Undefined = level height. */
  rise?: number;
  /** Going (tread depth) in mm. */
  tread: number;
  /** Maximum allowed riser height in mm; riser count = ceil(rise / maxRiser). */
  maxRiser: number;
  /** For l/u shapes: turn direction. Spirals: winding direction going up. */
  turn: 'left' | 'right';
  /** For l/u/open-well shapes: treads in the first flight (before the landing). Undefined = an even split. */
  firstFlightTreads?: number;
  /** Open-well only: treads in the middle flight, which sets the width of the well. Undefined = a third. */
  secondFlightTreads?: number;
  /** Spiral only: outer radius uses width; this is the central column radius. */
  innerRadius?: number;
  /**
   * Custom flights and landings. When set, they replace the `shape` preset (and its tread split), and
   * the riser count is fixed by the flights: Σ(treads + 1). Riser height = total rise / riser count.
   */
  runs?: StairRuns;
  // --- Construction details (undefined = sensible default) ---------------------------------------
  /** 'solid' concrete-style flights, or 'stringers' with separate treads. 'auto' follows the material. */
  structure?: StairStructure;
  /** Stringer stairs: closed (with riser boards) or open risers. 'auto' = closed for wood, open for metal. */
  risers?: StairRisers;
  /** Tread nosing projection, mm (default 25). */
  nosing?: number;
  /** Tread board thickness for stringer stairs, mm (default 40). */
  treadThickness?: number;
  /** Stringer board thickness, mm (default 45). */
  stringerThickness?: number;
  /** Landing slab / platform thickness, mm (default 200 solid, 120 stringers). */
  landingThickness?: number;
  /** Handrail sides, looking up the stair (default both). */
  handrails?: StairHandrails;
  /** Handrail height above the pitch line / landing, mm (default 900). */
  railHeight?: number;
  /** Baluster spacing (clear gap), mm (default 110). */
  balusterSpacing?: number;
}

export interface Column extends ElementBase {
  type: 'column';
  position: Vec2;
  width: number;
  depth: number;
  rotation: number;
  /** Undefined = level height. */
  height?: number;
  baseOffset: number;
  shape: 'rect' | 'round';
}

export interface Beam extends ElementBase {
  type: 'beam';
  start: Vec2;
  end: Vec2;
  width: number;
  depth: number;
  /** Top of beam relative to the level elevation. Undefined = level height (underside of the slab above). */
  topOffset?: number;
}

export interface Furniture extends ElementBase {
  type: 'furniture';
  /** Key into the furniture catalog (core/catalog.ts FURNITURE). */
  catalogId: string;
  /** Centre of the footprint in plan. */
  position: Vec2;
  rotation: number;
  /** Bottom elevation relative to level elevation. */
  elevation: number;
  /** Optional dimension overrides (mm). Undefined = catalog defaults. */
  width?: number;
  depth?: number;
  height?: number;
  /** Mirror along the local x axis. */
  mirrored?: boolean;
  /** Light fixtures: switched off when false (no light, unlit diffuser). Undefined = on. */
  lightOn?: boolean;
}

export interface Room extends ElementBase {
  type: 'room';
  outline: Vec2[];
  name: string;
  number?: string;
  /** Floor finish material (used by auto slabs and the plan's room fill). */
  floorMaterialId?: string;
}

/** Free-form Minecraft-style block: an axis-aligned (in plan rotation) box. */
export interface Block extends ElementBase {
  type: 'block';
  /** Min corner in plan + elevation relative to the level elevation (z), mm. */
  position: Vec3;
  /** Size in mm (x = width, y = depth, z = height). */
  size: Vec3;
  rotation: number;
  shape: 'box' | 'cylinder' | 'wedge' | 'sphere';
}

export interface Railing extends ElementBase {
  type: 'railing';
  path: Vec2[];
  height: number;
  baseOffset: number;
  style: 'bars' | 'glass' | 'solid';
  /** Centre-to-centre baluster spacing, mm (default 110). */
  balusterSpacing?: number;
  /** Maximum distance between posts, mm (default 1200). */
  postSpacing?: number;
}

export interface Dimension extends ElementBase {
  type: 'dimension';
  a: Vec2;
  b: Vec2;
  /** Perpendicular offset of the dimension line from a-b, mm (positive = left of a→b). */
  offset: number;
}

export interface Label extends ElementBase {
  type: 'label';
  position: Vec2;
  text: string;
  /** Text height on paper in mm (scaled by drawing scale). */
  size: number;
  rotation: number;
}

export type Element =
  | Wall
  | Door
  | Window
  | Slab
  | Roof
  | Stair
  | Column
  | Beam
  | Furniture
  | Room
  | Block
  | Railing
  | Dimension
  | Label;

export type ElementOfType<T extends ElementType> = Extract<Element, { type: T }>;

export type UnitSystem = 'metric' | 'imperial';

export interface ProjectSettings {
  /** Snap grid size in mm. */
  gridSize: number;
  /** Display units in the UI (the model is always mm). */
  units: UnitSystem;
  /** Default wall thickness for new walls, mm. */
  wallThickness: number;
  /** Default level height for new levels, mm. */
  levelHeight: number;
  /** Geographic north angle relative to plan +y, degrees (for IFC true north). */
  northAngle: number;
}

export interface ProjectInfo {
  name: string;
  author: string;
  description: string;
  address: string;
  /** ISO timestamps. */
  created: string;
  modified: string;
}

export interface Project {
  /** File format version, see core/serialization.ts. */
  schemaVersion: number;
  id: string;
  info: ProjectInfo;
  settings: ProjectSettings;
  /** Ordered bottom → top by elevation. */
  levels: Level[];
  elements: Record<string, Element>;
}
