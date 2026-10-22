import { getCatalogItem, getFurniture, type CatalogItem } from './catalog';
import { newId } from './ids';
import type {
  Beam,
  Block,
  Column,
  Dimension,
  Door,
  Element,
  ElementOfType,
  ElementType,
  Furniture,
  Label,
  Level,
  Project,
  Railing,
  Roof,
  Room,
  Slab,
  Stair,
  Wall,
  Window,
} from './types';

export const SCHEMA_VERSION = 1;

export const DEFAULT_LEVEL_HEIGHT = 3000;
export const DEFAULT_WALL_THICKNESS = 200;

export function createLevel(partial: Partial<Level> = {}): Level {
  return {
    id: partial.id ?? newId('lvl'),
    name: partial.name ?? 'Level 1',
    elevation: partial.elevation ?? 0,
    height: partial.height ?? DEFAULT_LEVEL_HEIGHT,
  };
}

export function createProject(name = 'Untitled Project'): Project {
  const now = new Date().toISOString();
  const ground = createLevel({ name: 'Ground Floor', elevation: 0 });
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('prj'),
    info: { name, author: '', description: '', address: '', created: now, modified: now },
    settings: {
      gridSize: 500,
      units: 'metric',
      wallThickness: DEFAULT_WALL_THICKNESS,
      levelHeight: DEFAULT_LEVEL_HEIGHT,
      northAngle: 0,
    },
    levels: [ground],
    elements: {},
  };
}

type Defaults = { [T in ElementType]: (levelId: string) => Omit<ElementOfType<T>, 'id'> };

const ORIGIN = { x: 0, y: 0 };

/** Default property values for each element type. Positions are placeholders the tool overwrites. */
export const ELEMENT_DEFAULTS: Defaults = {
  wall: (levelId): Omit<Wall, 'id'> => ({
    type: 'wall',
    levelId,
    start: { ...ORIGIN },
    end: { x: 1000, y: 0 },
    thickness: DEFAULT_WALL_THICKNESS,
    baseOffset: 0,
    justification: 'center',
    structural: false,
  }),
  door: (levelId): Omit<Door, 'id'> => ({
    type: 'door',
    levelId,
    hostId: '',
    offset: 0,
    width: 900,
    height: 2100,
    sill: 0,
    style: 'single',
    hinge: 'left',
    flip: false,
  }),
  window: (levelId): Omit<Window, 'id'> => ({
    type: 'window',
    levelId,
    hostId: '',
    offset: 0,
    width: 1200,
    height: 1200,
    sill: 900,
    style: 'casement',
  }),
  slab: (levelId): Omit<Slab, 'id'> => ({
    type: 'slab',
    levelId,
    outline: [],
    thickness: 200,
    topOffset: 0,
    kind: 'floor',
  }),
  roof: (levelId): Omit<Roof, 'id'> => ({
    type: 'roof',
    levelId,
    outline: [],
    shape: 'gable',
    pitch: 35,
    overhang: 500,
    thickness: 200,
    ridgeAngle: 0,
  }),
  stair: (levelId): Omit<Stair, 'id'> => ({
    type: 'stair',
    levelId,
    position: { ...ORIGIN },
    rotation: 90,
    width: 1000,
    shape: 'straight',
    tread: 280,
    maxRiser: 175,
    turn: 'left',
  }),
  column: (levelId): Omit<Column, 'id'> => ({
    type: 'column',
    levelId,
    position: { ...ORIGIN },
    width: 300,
    depth: 300,
    rotation: 0,
    baseOffset: 0,
    shape: 'rect',
  }),
  beam: (levelId): Omit<Beam, 'id'> => ({
    type: 'beam',
    levelId,
    start: { ...ORIGIN },
    end: { x: 4000, y: 0 },
    width: 300,
    depth: 500,
  }),
  furniture: (levelId): Omit<Furniture, 'id'> => ({
    type: 'furniture',
    levelId,
    catalogId: 'sofa-3',
    position: { ...ORIGIN },
    rotation: 0,
    elevation: 0,
  }),
  room: (levelId): Omit<Room, 'id'> => ({
    type: 'room',
    levelId,
    outline: [],
    name: 'Room',
  }),
  block: (levelId): Omit<Block, 'id'> => ({
    type: 'block',
    levelId,
    position: { x: 0, y: 0, z: 0 },
    size: { x: 500, y: 500, z: 500 },
    rotation: 0,
    shape: 'box',
  }),
  railing: (levelId): Omit<Railing, 'id'> => ({
    type: 'railing',
    levelId,
    path: [],
    height: 1000,
    baseOffset: 0,
    style: 'bars',
  }),
  dimension: (levelId): Omit<Dimension, 'id'> => ({
    type: 'dimension',
    levelId,
    a: { ...ORIGIN },
    b: { x: 1000, y: 0 },
    offset: 500,
  }),
  label: (levelId): Omit<Label, 'id'> => ({
    type: 'label',
    levelId,
    position: { ...ORIGIN },
    text: 'Label',
    size: 3.5,
    rotation: 0,
  }),
};

const ID_PREFIX: Record<ElementType, string> = {
  wall: 'wal',
  door: 'dor',
  window: 'win',
  slab: 'slb',
  roof: 'rof',
  stair: 'str',
  column: 'col',
  beam: 'bem',
  furniture: 'fur',
  room: 'rom',
  block: 'blk',
  railing: 'rai',
  dimension: 'dim',
  label: 'lbl',
};

/** Create a new element of `type` with defaults, overridden by `props`. Always assigns a fresh id. */
export function createElement<T extends ElementType>(
  type: T,
  levelId: string,
  props: Partial<Omit<ElementOfType<T>, 'type' | 'id'>> = {},
): ElementOfType<T> {
  const base = ELEMENT_DEFAULTS[type](levelId) as ElementOfType<T>;
  return { ...base, ...props, type, levelId, id: newId(ID_PREFIX[type]) } as ElementOfType<T>;
}

const TOOL_TO_TYPE: Partial<Record<CatalogItem['tool'], ElementType>> = {
  wall: 'wall',
  slab: 'slab',
  door: 'door',
  window: 'window',
  stair: 'stair',
  roof: 'roof',
  column: 'column',
  beam: 'beam',
  furniture: 'furniture',
  block: 'block',
  railing: 'railing',
  room: 'room',
  dimension: 'dimension',
  label: 'label',
};

export function elementTypeForTool(tool: CatalogItem['tool']): ElementType | undefined {
  return TOOL_TO_TYPE[tool];
}

/**
 * Create an element from an inventory item: element defaults ← catalog template ← `props`.
 * Furniture items also pick up their catalog default elevation.
 */
export function createFromCatalog(
  itemOrId: CatalogItem | string,
  levelId: string,
  props: Record<string, unknown> = {},
): Element | undefined {
  const it = typeof itemOrId === 'string' ? getCatalogItem(itemOrId) : itemOrId;
  if (!it) return undefined;
  const type = elementTypeForTool(it.tool);
  if (!type) return undefined;
  const extra: Record<string, unknown> = {};
  if (type === 'furniture') {
    const def = getFurniture(String(it.template?.catalogId ?? props.catalogId ?? ''));
    if (def?.elevation) extra.elevation = def.elevation;
  }
  return createElement(type, levelId, { ...extra, ...(it.template ?? {}), ...props } as never);
}

/** Deep clone that is safe for our plain-JSON elements. */
export function cloneElement<T extends Element>(el: T): T {
  return JSON.parse(JSON.stringify(el)) as T;
}
