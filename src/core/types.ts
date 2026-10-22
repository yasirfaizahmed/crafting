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
}

export interface Window extends HostedOpeningBase {
  type: 'window';
  style: WindowStyle;
  frameMaterialId?: string;
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

export type StairShape = 'straight' | 'l-shape' | 'u-shape' | 'spiral';

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
  /** For l/u shapes: turn direction. */
  turn: 'left' | 'right';
  /** Spiral only: outer radius uses width; this is the central column radius. */
  innerRadius?: number;
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
