import { MATERIALS } from './materials';

/**
 * The "creative inventory": every placeable thing in Crafting.
 *
 * A CatalogItem binds an inventory tile (hotbar slot) to a ToolKind plus a template of default
 * element properties. Tools (2D plan editor and 3D builder) read the active CatalogItem from
 * UIState and create elements by merging `template` over the element type defaults
 * (core/defaults.ts → createElement).
 */

export type ToolKind =
  | 'select'
  | 'wall'
  | 'slab'
  | 'door'
  | 'window'
  | 'stair'
  | 'roof'
  | 'column'
  | 'beam'
  | 'furniture'
  | 'block'
  | 'railing'
  | 'room'
  | 'dimension'
  | 'label'
  | 'paint'
  | 'eraser'
  | 'eyedropper'
  | 'measure';

export type CatalogCategory =
  | 'tools'
  | 'structure'
  | 'openings'
  | 'circulation'
  | 'roofs'
  | 'living'
  | 'dining'
  | 'bedroom'
  | 'kitchen'
  | 'bath'
  | 'office'
  | 'lighting'
  | 'outdoor'
  | 'decor'
  | 'blocks'
  | 'paint'
  | 'annotation';

export const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  tools: 'Tools',
  structure: 'Structure',
  openings: 'Doors & Windows',
  circulation: 'Stairs & Railings',
  roofs: 'Roofs',
  living: 'Living Room',
  dining: 'Dining',
  bedroom: 'Bedroom',
  kitchen: 'Kitchen',
  bath: 'Bathroom',
  office: 'Office',
  lighting: 'Lighting',
  outdoor: 'Outdoor & Landscape',
  decor: 'Decor',
  blocks: 'Building Blocks',
  paint: 'Paint & Materials',
  annotation: 'Annotation',
};

export interface CatalogItem {
  id: string;
  name: string;
  category: CatalogCategory;
  tool: ToolKind;
  /** Emoji glyph used for the tile icon. */
  icon: string;
  /** Tile swatch colour. */
  color: string;
  /** Defaults merged into the created element (keys of the element type). */
  template?: Record<string, unknown>;
  description?: string;
  keywords?: string[];
}

export type FurniturePlanSymbol =
  | 'rect'
  | 'round'
  | 'bed'
  | 'sofa'
  | 'chair'
  | 'table'
  | 'toilet'
  | 'sink'
  | 'bathtub'
  | 'shower'
  | 'stove'
  | 'fridge'
  | 'tree'
  | 'car'
  | 'lamp'
  | 'counter'
  | 'wardrobe'
  | 'rug'
  | 'plant';

export interface FurnitureDef {
  id: string;
  name: string;
  category: Exclude<CatalogCategory, 'tools' | 'structure' | 'openings' | 'circulation' | 'roofs' | 'blocks' | 'paint' | 'annotation'>;
  /** Footprint along local x (mm). */
  width: number;
  /** Footprint along local y (mm). Local -y is the FRONT, +y is the BACK (against a wall). */
  depth: number;
  height: number;
  materialId: string;
  secondaryMaterialId?: string;
  plan: FurniturePlanSymbol;
  icon: string;
  /** Default bottom elevation (e.g. wall cabinets, ceiling lights), mm above level. */
  elevation?: number;
  /** Light source definition for lighting fixtures. */
  light?: { color: string; intensity: number; distance: number };
}

const f = (
  id: string,
  name: string,
  category: FurnitureDef['category'],
  dims: [number, number, number],
  materialId: string,
  plan: FurniturePlanSymbol,
  icon: string,
  extra: Partial<FurnitureDef> = {},
): FurnitureDef => ({ id, name, category, width: dims[0], depth: dims[1], height: dims[2], materialId, plan, icon, ...extra });

export const FURNITURE: FurnitureDef[] = [
  // Living
  f('sofa-3', 'Sofa — 3 Seat', 'living', [2200, 900, 850], 'fabric-grey', 'sofa', '🛋️', { secondaryMaterialId: 'wood-walnut' }),
  f('sofa-2', 'Sofa — 2 Seat', 'living', [1600, 900, 850], 'fabric-beige', 'sofa', '🛋️', { secondaryMaterialId: 'wood-walnut' }),
  f('sofa-l', 'Sofa — Corner L', 'living', [2600, 1800, 850], 'fabric-blue', 'sofa', '🛋️', { secondaryMaterialId: 'wood-walnut' }),
  f('armchair', 'Armchair', 'living', [850, 850, 900], 'leather-brown', 'chair', '💺', { secondaryMaterialId: 'wood-walnut' }),
  f('coffee-table', 'Coffee Table', 'living', [1200, 600, 420], 'wood-oak', 'table', '🟫'),
  f('tv-unit', 'TV Unit + TV', 'living', [1800, 450, 1200], 'wood-walnut', 'counter', '📺', { secondaryMaterialId: 'paint-black' }),
  f('bookshelf', 'Bookshelf', 'living', [1000, 350, 2000], 'wood-oak', 'counter', '📚'),
  f('rug', 'Rug', 'living', [2400, 1700, 15], 'fabric-beige', 'rug', '🟨'),
  f('fireplace', 'Fireplace', 'living', [1500, 500, 1100], 'stone-sandstone', 'counter', '🔥', { secondaryMaterialId: 'paint-charcoal' }),
  f('piano', 'Upright Piano', 'living', [1500, 600, 1250], 'paint-black', 'counter', '🎹'),
  // Dining
  f('dining-table-6', 'Dining Table — 6', 'dining', [1800, 900, 750], 'wood-oak', 'table', '🍽️'),
  f('dining-table-4', 'Dining Table — 4', 'dining', [1200, 800, 750], 'wood-walnut', 'table', '🍽️'),
  f('dining-table-round', 'Dining Table — Round', 'dining', [1100, 1100, 750], 'wood-oak', 'round', '⚪'),
  f('dining-chair', 'Dining Chair', 'dining', [450, 500, 900], 'wood-oak', 'chair', '🪑', { secondaryMaterialId: 'fabric-grey' }),
  f('bar-stool', 'Bar Stool', 'dining', [400, 400, 750], 'metal-black', 'round', '🪑', { secondaryMaterialId: 'leather-brown' }),
  // Bedroom
  f('bed-king', 'Bed — King', 'bedroom', [1930, 2130, 1000], 'fabric-beige', 'bed', '🛏️', { secondaryMaterialId: 'wood-walnut' }),
  f('bed-double', 'Bed — Double', 'bedroom', [1500, 2050, 1000], 'fabric-grey', 'bed', '🛏️', { secondaryMaterialId: 'wood-oak' }),
  f('bed-single', 'Bed — Single', 'bedroom', [950, 2000, 900], 'fabric-blue', 'bed', '🛏️', { secondaryMaterialId: 'wood-pine' }),
  f('bunk-bed', 'Bunk Bed', 'bedroom', [1000, 2050, 1700], 'wood-pine', 'bed', '🛏️', { secondaryMaterialId: 'fabric-blue' }),
  f('crib', 'Crib', 'bedroom', [700, 1300, 950], 'paint-white', 'bed', '👶', { secondaryMaterialId: 'fabric-beige' }),
  f('nightstand', 'Nightstand', 'bedroom', [500, 400, 550], 'wood-walnut', 'rect', '🗄️'),
  f('wardrobe', 'Wardrobe', 'bedroom', [1800, 600, 2200], 'wood-oak', 'wardrobe', '🚪'),
  f('dresser', 'Dresser', 'bedroom', [1200, 500, 850], 'wood-walnut', 'rect', '🗄️'),
  // Office
  f('desk', 'Desk', 'office', [1400, 700, 750], 'wood-oak', 'table', '🖥️', { secondaryMaterialId: 'metal-black' }),
  f('office-chair', 'Office Chair', 'office', [650, 650, 1100], 'fabric-grey', 'chair', '💺', { secondaryMaterialId: 'metal-black' }),
  f('filing-cabinet', 'Filing Cabinet', 'office', [450, 600, 1300], 'steel', 'rect', '🗄️'),
  f('meeting-table', 'Meeting Table — 8', 'office', [2400, 1100, 750], 'wood-walnut', 'table', '🧑‍💼'),
  // Kitchen
  f('kitchen-base', 'Base Cabinet 600', 'kitchen', [600, 600, 900], 'paint-white', 'counter', '🧱', { secondaryMaterialId: 'stone-granite' }),
  f('kitchen-base-1200', 'Base Cabinet 1200', 'kitchen', [1200, 600, 900], 'paint-white', 'counter', '🧱', { secondaryMaterialId: 'stone-granite' }),
  f('kitchen-sink', 'Sink Unit', 'kitchen', [900, 600, 900], 'paint-white', 'sink', '🚰', { secondaryMaterialId: 'stone-granite' }),
  f('stove', 'Cooktop & Oven', 'kitchen', [600, 600, 900], 'steel', 'stove', '🍳', { secondaryMaterialId: 'paint-black' }),
  f('fridge', 'Refrigerator', 'kitchen', [700, 700, 1850], 'aluminium', 'fridge', '🧊'),
  f('kitchen-island', 'Kitchen Island', 'kitchen', [2000, 1000, 900], 'wood-walnut', 'counter', '🏝️', { secondaryMaterialId: 'marble-white' }),
  f('wall-cabinet', 'Wall Cabinet', 'kitchen', [600, 350, 700], 'paint-white', 'counter', '🗄️', { elevation: 1450 }),
  f('dishwasher', 'Dishwasher', 'kitchen', [600, 600, 850], 'aluminium', 'rect', '🫧'),
  // Bath
  f('toilet', 'Toilet', 'bath', [380, 700, 800], 'ceramic-white', 'toilet', '🚽'),
  f('washbasin', 'Washbasin', 'bath', [550, 450, 850], 'ceramic-white', 'sink', '🚰'),
  f('vanity', 'Vanity Unit', 'bath', [1200, 550, 850], 'wood-oak', 'sink', '🪞', { secondaryMaterialId: 'ceramic-white' }),
  f('bathtub', 'Bathtub', 'bath', [1700, 750, 580], 'ceramic-white', 'bathtub', '🛁'),
  f('shower', 'Shower Tray + Screen', 'bath', [900, 900, 2000], 'ceramic-white', 'shower', '🚿', { secondaryMaterialId: 'glass-clear' }),
  f('washing-machine', 'Washing Machine', 'bath', [600, 600, 850], 'plastic-white', 'rect', '🧺'),
  // Lighting
  f('ceiling-light', 'Ceiling Light', 'lighting', [400, 400, 150], 'light-warm', 'lamp', '💡', {
    elevation: 2550,
    light: { color: '#fff1d6', intensity: 6, distance: 7 },
  }),
  f('pendant-light', 'Pendant Light', 'lighting', [350, 350, 600], 'metal-black', 'lamp', '💡', {
    elevation: 1900,
    secondaryMaterialId: 'light-warm',
    light: { color: '#ffe6bf', intensity: 5, distance: 6 },
  }),
  f('floor-lamp', 'Floor Lamp', 'lighting', [400, 400, 1650], 'metal-black', 'lamp', '🪔', {
    secondaryMaterialId: 'light-warm',
    light: { color: '#ffe6bf', intensity: 3, distance: 5 },
  }),
  f('wall-light', 'Wall Sconce', 'lighting', [250, 150, 300], 'copper', 'lamp', '🕯️', {
    elevation: 1800,
    secondaryMaterialId: 'light-warm',
    light: { color: '#ffe6bf', intensity: 2, distance: 4 },
  }),
  // Outdoor
  f('tree', 'Tree — Deciduous', 'outdoor', [4000, 4000, 7000], 'foliage', 'tree', '🌳', { secondaryMaterialId: 'wood-walnut' }),
  f('tree-conifer', 'Tree — Conifer', 'outdoor', [3000, 3000, 8000], 'foliage', 'tree', '🌲', { secondaryMaterialId: 'wood-walnut' }),
  f('palm', 'Palm Tree', 'outdoor', [3000, 3000, 6000], 'foliage', 'tree', '🌴', { secondaryMaterialId: 'wood-pine' }),
  f('shrub', 'Shrub', 'outdoor', [1200, 1200, 1000], 'foliage', 'plant', '🌿'),
  f('car', 'Car', 'outdoor', [1850, 4600, 1450], 'paint-navy', 'car', '🚗', { secondaryMaterialId: 'glass-tinted' }),
  f('bench', 'Garden Bench', 'outdoor', [1500, 600, 800], 'wood-pine', 'rect', '🪵', { secondaryMaterialId: 'metal-black' }),
  f('pool', 'Swimming Pool', 'outdoor', [8000, 4000, 300], 'water', 'rect', '🏊', { secondaryMaterialId: 'tile-blue' }),
  f('patio-set', 'Patio Table Set', 'outdoor', [1800, 1800, 750], 'metal-black', 'round', '⛱️', { secondaryMaterialId: 'fabric-beige' }),
  // Decor
  f('plant-pot', 'Potted Plant', 'decor', [450, 450, 1200], 'foliage', 'plant', '🪴', { secondaryMaterialId: 'tile-terracotta' }),
  f('mirror', 'Wall Mirror', 'decor', [800, 40, 1200], 'glass-clear', 'rect', '🪞', { elevation: 900, secondaryMaterialId: 'wood-oak' }),
  f('artwork', 'Framed Artwork', 'decor', [1000, 40, 700], 'paint-sky', 'rect', '🖼️', { elevation: 1300, secondaryMaterialId: 'wood-walnut' }),
];

const FURNITURE_BY_ID = new Map(FURNITURE.map((x) => [x.id, x]));

export function getFurniture(id: string): FurnitureDef | undefined {
  return FURNITURE_BY_ID.get(id);
}

const item = (
  id: string,
  name: string,
  category: CatalogCategory,
  tool: ToolKind,
  icon: string,
  color: string,
  template?: Record<string, unknown>,
  description?: string,
): CatalogItem => ({ id, name, category, tool, icon, color, template, description });

export const CATALOG: CatalogItem[] = [
  // Tools
  item('tool-select', 'Select / Move', 'tools', 'select', '🖱️', '#5b7bd5', undefined, 'Select, move, rotate and edit elements'),
  item('tool-eraser', 'Break (Eraser)', 'tools', 'eraser', '⛏️', '#c0504d', undefined, 'Remove whatever you point at'),
  item('tool-eyedropper', 'Pick Block', 'tools', 'eyedropper', '💧', '#8e6bbf', undefined, 'Copy the type and settings of an element'),
  item('tool-measure', 'Measure', 'tools', 'measure', '📏', '#d9a441', undefined, 'Measure distances'),
  // Structure
  item('wall-200', 'Wall — 200 Plaster', 'structure', 'wall', '🧱', '#e9e5dc', { thickness: 200, materialId: 'plaster-white' }),
  item('wall-brick', 'Wall — 230 Brick', 'structure', 'wall', '🧱', '#a4502f', { thickness: 230, materialId: 'brick-red', structural: true }),
  item('wall-block', 'Wall — 200 Block', 'structure', 'wall', '🧱', '#b9b6ae', { thickness: 200, materialId: 'block-cmu', structural: true }),
  item('wall-concrete', 'Wall — 250 Concrete', 'structure', 'wall', '🧱', '#a9a9a4', { thickness: 250, materialId: 'concrete', structural: true }),
  item('wall-partition', 'Partition — 100', 'structure', 'wall', '▭', '#f2f0eb', { thickness: 100, materialId: 'plaster-white' }),
  item('wall-glass', 'Glass Wall', 'structure', 'wall', '🪟', '#cfe6f2', { thickness: 60, materialId: 'glass-clear' }),
  item('wall-low', 'Low Wall — 1000', 'structure', 'wall', '▬', '#d2b48c', { thickness: 200, height: 1000, materialId: 'stone-sandstone' }),
  item('slab-concrete', 'Floor Slab — Concrete', 'structure', 'slab', '⬛', '#a9a9a4', { thickness: 200, materialId: 'concrete', kind: 'floor' }),
  item('slab-wood', 'Floor — Oak Planks', 'structure', 'slab', '🟫', '#c09062', { thickness: 200, materialId: 'wood-floor-oak', kind: 'floor' }),
  item('slab-tile', 'Floor — Porcelain Tile', 'structure', 'slab', '⬜', '#8f9094', { thickness: 200, materialId: 'tile-grey', kind: 'floor' }),
  item('slab-terrace', 'Terrace — Stone', 'structure', 'slab', '🟧', '#d2b48c', { thickness: 150, materialId: 'stone-sandstone', kind: 'terrace' }),
  item('foundation', 'Foundation Slab', 'structure', 'slab', '◼️', '#8a8a86', { thickness: 400, materialId: 'concrete', kind: 'foundation' }),
  item('column-rect', 'Column — 300×300', 'structure', 'column', '▮', '#a9a9a4', { width: 300, depth: 300, shape: 'rect' }),
  item('column-round', 'Column — Ø350', 'structure', 'column', '⚫', '#bdbcb7', { width: 350, depth: 350, shape: 'round' }),
  item('column-steel', 'Column — Steel 200', 'structure', 'column', '▮', '#8a9097', { width: 200, depth: 200, shape: 'rect', materialId: 'steel' }),
  item('beam-concrete', 'Beam — 300×500', 'structure', 'beam', '━', '#a9a9a4', { width: 300, depth: 500 }),
  item('beam-timber', 'Beam — Timber 150×300', 'structure', 'beam', '━', '#c8a26b', { width: 150, depth: 300, materialId: 'timber-frame' }),
  item('beam-steel', 'Beam — Steel 200×400', 'structure', 'beam', '━', '#8a9097', { width: 200, depth: 400, materialId: 'steel' }),
  item('room', 'Room / Space', 'structure', 'room', '🏷️', '#9ec5e0', { name: 'Room' }, 'Define a named space with area'),
  // Openings
  item('door-single', 'Door — Single 900', 'openings', 'door', '🚪', '#b88a55', { style: 'single', width: 900, height: 2100 }),
  item('door-double', 'Door — Double 1500', 'openings', 'door', '🚪', '#6b4a32', { style: 'double', width: 1500, height: 2100 }),
  item('door-sliding', 'Door — Sliding Glass', 'openings', 'door', '🚪', '#cfe6f2', { style: 'sliding', width: 2400, height: 2200, materialId: 'glass-clear' }),
  item('door-pocket', 'Door — Pocket 800', 'openings', 'door', '🚪', '#d8b47c', { style: 'pocket', width: 800, height: 2100 }),
  item('door-garage', 'Garage Door', 'openings', 'door', '🚘', '#c4c7cb', { style: 'garage', width: 2700, height: 2400, materialId: 'aluminium' }),
  item('opening', 'Opening (Archway)', 'openings', 'door', '⬚', '#f2f0eb', { style: 'opening', width: 1200, height: 2200 }),
  item('window-casement', 'Window — Casement', 'openings', 'window', '🪟', '#cfe6f2', { style: 'casement', width: 1200, height: 1200, sill: 900 }),
  item('window-sliding', 'Window — Sliding', 'openings', 'window', '🪟', '#cfe6f2', { style: 'sliding', width: 1800, height: 1200, sill: 900 }),
  item('window-fixed', 'Window — Picture', 'openings', 'window', '🖼️', '#cfe6f2', { style: 'fixed', width: 2400, height: 1800, sill: 450 }),
  item('window-awning', 'Window — Awning', 'openings', 'window', '🪟', '#cfe6f2', { style: 'awning', width: 900, height: 600, sill: 1500 }),
  item('window-tall', 'Window — Floor to Ceiling', 'openings', 'window', '🪟', '#cfe6f2', { style: 'fixed', width: 1500, height: 2400, sill: 100 }),
  // Circulation
  item('stair-straight', 'Stair — Straight', 'circulation', 'stair', '🪜', '#a9a9a4', { shape: 'straight', width: 1000 }),
  item('stair-l', 'Stair — L Shape', 'circulation', 'stair', '🪜', '#b88a55', { shape: 'l-shape', width: 1000, materialId: 'wood-oak' }),
  item('stair-u', 'Stair — U Shape', 'circulation', 'stair', '🪜', '#bdbcb7', { shape: 'u-shape', width: 1100 }),
  item('stair-spiral', 'Stair — Spiral', 'circulation', 'stair', '🌀', '#8a9097', { shape: 'spiral', width: 900, materialId: 'steel' }),
  item('railing-bars', 'Railing — Balusters', 'circulation', 'railing', '┼', '#2a2b2d', { style: 'bars', height: 1000 }),
  item('railing-glass', 'Railing — Glass', 'circulation', 'railing', '▯', '#cfe6f2', { style: 'glass', height: 1000, materialId: 'glass-clear' }),
  // Roofs
  item('roof-gable', 'Roof — Gable', 'roofs', 'roof', '🏠', '#a5492f', { shape: 'gable', pitch: 35, materialId: 'roof-tiles-clay' }),
  item('roof-hip', 'Roof — Hip', 'roofs', 'roof', '🏡', '#4f5257', { shape: 'hip', pitch: 30, materialId: 'roof-shingles-grey' }),
  item('roof-shed', 'Roof — Shed (Mono)', 'roofs', 'roof', '📐', '#5a6470', { shape: 'shed', pitch: 10, materialId: 'roof-metal-seam' }),
  item('roof-pyramid', 'Roof — Pyramid', 'roofs', 'roof', '🔺', '#3c4148', { shape: 'pyramid', pitch: 35, materialId: 'roof-slate' }),
  item('roof-flat', 'Roof — Flat', 'roofs', 'roof', '▬', '#6f7275', { shape: 'flat', pitch: 0, materialId: 'roof-membrane', overhang: 0 }),
  // Blocks (pure Minecraft freedom)
  item('block-brick', 'Block — Brick', 'blocks', 'block', '🟥', '#a4502f', { materialId: 'brick-red', shape: 'box' }),
  item('block-stone', 'Block — Stone', 'blocks', 'block', '⬜', '#77777a', { materialId: 'stone-granite', shape: 'box' }),
  item('block-wood', 'Block — Oak', 'blocks', 'block', '🟫', '#b88a55', { materialId: 'wood-oak', shape: 'box' }),
  item('block-concrete', 'Block — Concrete', 'blocks', 'block', '◻️', '#a9a9a4', { materialId: 'concrete', shape: 'box' }),
  item('block-glass', 'Block — Glass', 'blocks', 'block', '🧊', '#cfe6f2', { materialId: 'glass-clear', shape: 'box' }),
  item('block-grass', 'Block — Grass', 'blocks', 'block', '🟩', '#5f8f3e', { materialId: 'grass', shape: 'box' }),
  item('block-marble', 'Block — Marble', 'blocks', 'block', '🤍', '#ecebe7', { materialId: 'marble-white', shape: 'box' }),
  item('block-cylinder', 'Cylinder — Concrete', 'blocks', 'block', '🛢️', '#bdbcb7', { materialId: 'concrete', shape: 'cylinder' }),
  item('block-wedge', 'Wedge — Stone', 'blocks', 'block', '◣', '#d2b48c', { materialId: 'stone-sandstone', shape: 'wedge' }),
  item('block-sphere', 'Sphere — Copper', 'blocks', 'block', '🟠', '#b87333', { materialId: 'copper', shape: 'sphere' }),
  // Annotation
  item('dimension', 'Dimension', 'annotation', 'dimension', '↔️', '#3b3d40'),
  item('label', 'Text Label', 'annotation', 'label', '🔤', '#3b3d40', { text: 'Label', size: 3.5 }),
];

// Furniture items are generated from FURNITURE so the inventory always matches the catalog.
for (const def of FURNITURE) {
  CATALOG.push(item(`furn-${def.id}`, def.name, def.category, 'furniture', def.icon, '#d9c9a8', { catalogId: def.id }));
}

// Every material doubles as a paint bucket for the paint tool.
for (const mat of MATERIALS) {
  CATALOG.push(item(`paint-${mat.id}`, mat.name, 'paint', 'paint', '🎨', mat.color, { materialId: mat.id }));
}

const CATALOG_BY_ID = new Map(CATALOG.map((x) => [x.id, x]));

export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG_BY_ID.get(id);
}

/** Default hotbar: what a new player gets in slots 1-9. */
export const DEFAULT_HOTBAR: string[] = [
  'tool-select',
  'wall-200',
  'slab-wood',
  'door-single',
  'window-casement',
  'stair-straight',
  'roof-gable',
  'furn-sofa-3',
  'block-brick',
];

export function searchCatalog(query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return CATALOG;
  return CATALOG.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.category.includes(q) ||
      c.tool.includes(q) ||
      (c.keywords ?? []).some((k) => k.includes(q)),
  );
}

/**
 * Best inventory item for an existing element ("pick block"): prefers an item whose template
 * matches the element's key properties (catalogId, style/shape, material, thickness).
 */
export function catalogItemForElement(el: { type: string } & Record<string, unknown>): CatalogItem | undefined {
  const candidates = CATALOG.filter((c) => c.tool === el.type);
  let best: CatalogItem | undefined;
  let bestScore = -1;
  for (const c of candidates) {
    const t = c.template ?? {};
    let score = 0;
    let conflict = false;
    for (const [k, v] of Object.entries(t)) {
      if (el[k] === undefined) continue;
      if (el[k] === v) score += k === 'catalogId' ? 10 : 2;
      else if (k === 'catalogId' || k === 'shape' || k === 'style') conflict = true;
    }
    if (conflict) continue;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
