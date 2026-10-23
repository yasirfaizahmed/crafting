import type { ElementType } from './types';

export type MaterialCategory =
  | 'masonry'
  | 'concrete'
  | 'wood'
  | 'metal'
  | 'glass'
  | 'stone'
  | 'tile'
  | 'paint'
  | 'fabric'
  | 'roofing'
  | 'ground'
  | 'plastic'
  | 'light';

/** Procedural texture the 3D view can synthesise (no binary assets needed). */
export type TexturePattern =
  | 'none'
  | 'brick'
  | 'block'
  | 'stone'
  | 'tiles'
  | 'planks'
  | 'wood-grain'
  | 'shingles'
  | 'metal-seam'
  | 'grass'
  | 'gravel'
  | 'fabric'
  | 'marble'
  | 'concrete';

/** Section hatch for cut elements in 2D drawings (ISO 128-50 / common AIA practice). */
export type HatchPattern = 'none' | 'solid' | 'concrete' | 'brick' | 'insulation' | 'wood' | 'stone' | 'earth' | 'steel' | 'glass';

export interface MaterialDef {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Base colour #rrggbb. */
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  pattern: TexturePattern;
  /** Real-world size of one pattern repeat in mm (e.g. a brick course module). */
  patternSize: number;
  hatch: HatchPattern;
  emissive?: string;
  /** Approximate density kg/m³ for quantity take-off. */
  density?: number;
}

const m = (
  id: string,
  name: string,
  category: MaterialCategory,
  color: string,
  opts: Partial<Omit<MaterialDef, 'id' | 'name' | 'category' | 'color'>> = {},
): MaterialDef => ({
  id,
  name,
  category,
  color,
  roughness: opts.roughness ?? 0.85,
  metalness: opts.metalness ?? 0,
  opacity: opts.opacity ?? 1,
  pattern: opts.pattern ?? 'none',
  patternSize: opts.patternSize ?? 1000,
  hatch: opts.hatch ?? 'none',
  emissive: opts.emissive,
  density: opts.density,
});

export const MATERIALS: MaterialDef[] = [
  // Masonry & concrete
  m('brick-red', 'Brick — Red', 'masonry', '#a4502f', { pattern: 'brick', patternSize: 450, hatch: 'brick', density: 1900 }),
  m('brick-white', 'Brick — White', 'masonry', '#e6e1d6', { pattern: 'brick', patternSize: 450, hatch: 'brick', density: 1900 }),
  m('brick-yellow', 'Brick — London Stock', 'masonry', '#c9a76a', { pattern: 'brick', patternSize: 450, hatch: 'brick', density: 1900 }),
  m('block-cmu', 'Concrete Block (CMU)', 'masonry', '#b9b6ae', { pattern: 'block', patternSize: 800, hatch: 'concrete', density: 2000 }),
  m('aac-block', 'AAC Block', 'masonry', '#e4e2dc', { pattern: 'block', patternSize: 1200, hatch: 'concrete', density: 600 }),
  m('concrete', 'Concrete — Cast in place', 'concrete', '#a9a9a4', { pattern: 'concrete', patternSize: 2000, hatch: 'concrete', density: 2400 }),
  m('concrete-polished', 'Concrete — Polished', 'concrete', '#bdbcb7', { roughness: 0.35, pattern: 'concrete', patternSize: 2000, hatch: 'concrete', density: 2400 }),
  m('plaster-white', 'Plaster — White', 'paint', '#f2f0eb', { roughness: 0.9, hatch: 'none' }),
  // Paints
  m('paint-white', 'Paint — Pure White', 'paint', '#fafafa'),
  m('paint-warm-white', 'Paint — Warm White', 'paint', '#f3ead8'),
  m('paint-grey', 'Paint — Dove Grey', 'paint', '#a7a9ac'),
  m('paint-charcoal', 'Paint — Charcoal', 'paint', '#3b3d40'),
  m('paint-sage', 'Paint — Sage Green', 'paint', '#9caf88'),
  m('paint-teal', 'Paint — Deep Teal', 'paint', '#2f6f73'),
  m('paint-navy', 'Paint — Navy', 'paint', '#273a5c'),
  m('paint-terracotta', 'Paint — Terracotta', 'paint', '#c46a47'),
  m('paint-mustard', 'Paint — Mustard', 'paint', '#d4a235'),
  m('paint-blush', 'Paint — Blush Pink', 'paint', '#e3b5a8'),
  m('paint-sky', 'Paint — Sky Blue', 'paint', '#9ec5e0'),
  m('paint-black', 'Paint — Matte Black', 'paint', '#1d1d1f'),
  // Wood
  m('wood-oak', 'Wood — Oak', 'wood', '#b88a55', { pattern: 'wood-grain', patternSize: 1200, hatch: 'wood', density: 700 }),
  m('wood-walnut', 'Wood — Walnut', 'wood', '#6b4a32', { pattern: 'wood-grain', patternSize: 1200, hatch: 'wood', density: 650 }),
  m('wood-pine', 'Wood — Pine', 'wood', '#d8b47c', { pattern: 'wood-grain', patternSize: 1200, hatch: 'wood', density: 500 }),
  m('wood-floor-oak', 'Flooring — Oak Planks', 'wood', '#c09062', { pattern: 'planks', patternSize: 1200, hatch: 'wood' }),
  m('wood-floor-dark', 'Flooring — Dark Planks', 'wood', '#5e4430', { pattern: 'planks', patternSize: 1200, hatch: 'wood' }),
  m('timber-frame', 'Timber — Structural', 'wood', '#c8a26b', { pattern: 'wood-grain', patternSize: 1200, hatch: 'wood', density: 500 }),
  // Stone & tile
  m('stone-granite', 'Stone — Granite', 'stone', '#77777a', { roughness: 0.5, pattern: 'stone', patternSize: 800, hatch: 'stone', density: 2700 }),
  m('stone-sandstone', 'Stone — Sandstone', 'stone', '#d2b48c', { pattern: 'stone', patternSize: 800, hatch: 'stone', density: 2300 }),
  m('marble-white', 'Marble — Carrara', 'stone', '#ecebe7', { roughness: 0.25, pattern: 'marble', patternSize: 1500, hatch: 'stone', density: 2700 }),
  m('tile-white', 'Tile — White Ceramic', 'tile', '#f1f1ee', { roughness: 0.3, pattern: 'tiles', patternSize: 300, hatch: 'none' }),
  m('tile-grey', 'Tile — Grey Porcelain', 'tile', '#8f9094', { roughness: 0.4, pattern: 'tiles', patternSize: 600, hatch: 'none' }),
  m('tile-terracotta', 'Tile — Terracotta', 'tile', '#b8653f', { pattern: 'tiles', patternSize: 300, hatch: 'none' }),
  m('tile-blue', 'Tile — Blue Mosaic', 'tile', '#3f7ca8', { roughness: 0.3, pattern: 'tiles', patternSize: 100, hatch: 'none' }),
  // Metal & glass
  m('steel', 'Steel — Structural', 'metal', '#8a9097', { roughness: 0.45, metalness: 0.85, hatch: 'steel', density: 7850 }),
  m('aluminium', 'Aluminium — Anodised', 'metal', '#c4c7cb', { roughness: 0.35, metalness: 0.9, density: 2700 }),
  m('metal-black', 'Metal — Powder Coat Black', 'metal', '#2a2b2d', { roughness: 0.5, metalness: 0.6 }),
  m('copper', 'Copper', 'metal', '#b87333', { roughness: 0.35, metalness: 0.9 }),
  m('glass-clear', 'Glass — Clear', 'glass', '#cfe6f2', { roughness: 0.05, opacity: 0.28, hatch: 'glass' }),
  m('glass-frosted', 'Glass — Frosted', 'glass', '#e8f1f4', { roughness: 0.6, opacity: 0.6, hatch: 'glass' }),
  m('glass-tinted', 'Glass — Tinted', 'glass', '#5d7380', { roughness: 0.05, opacity: 0.45, hatch: 'glass' }),
  // Roofing
  m('roof-tiles-clay', 'Roof — Clay Tiles', 'roofing', '#a5492f', { pattern: 'shingles', patternSize: 400, hatch: 'none' }),
  m('roof-shingles-grey', 'Roof — Asphalt Shingles', 'roofing', '#4f5257', { pattern: 'shingles', patternSize: 400, hatch: 'none' }),
  m('roof-metal-seam', 'Roof — Standing Seam', 'roofing', '#5a6470', { roughness: 0.4, metalness: 0.6, pattern: 'metal-seam', patternSize: 500 }),
  m('roof-slate', 'Roof — Slate', 'roofing', '#3c4148', { pattern: 'shingles', patternSize: 350 }),
  m('roof-membrane', 'Roof — Membrane', 'roofing', '#6f7275', { roughness: 0.7 }),
  // Fabric, plastic
  m('fabric-grey', 'Fabric — Grey', 'fabric', '#8c8f94', { pattern: 'fabric', patternSize: 200 }),
  m('fabric-beige', 'Fabric — Linen', 'fabric', '#d6c7ad', { pattern: 'fabric', patternSize: 200 }),
  m('fabric-blue', 'Fabric — Indigo', 'fabric', '#3d4f7a', { pattern: 'fabric', patternSize: 200 }),
  m('leather-brown', 'Leather — Cognac', 'fabric', '#8a4f2a', { roughness: 0.55 }),
  m('plastic-white', 'Plastic — Gloss White', 'plastic', '#f5f5f5', { roughness: 0.25 }),
  m('ceramic-white', 'Ceramic — Sanitary', 'plastic', '#fbfbfa', { roughness: 0.15 }),
  // Ground & landscape
  m('grass', 'Grass', 'ground', '#5f8f3e', { pattern: 'grass', patternSize: 1000, hatch: 'earth' }),
  m('gravel', 'Gravel', 'ground', '#9a958b', { pattern: 'gravel', patternSize: 600, hatch: 'earth' }),
  m('soil', 'Soil', 'ground', '#6d5038', { hatch: 'earth', density: 1600 }),
  m('water', 'Water', 'ground', '#3d86b8', { roughness: 0.05, opacity: 0.7 }),
  m('foliage', 'Foliage', 'ground', '#3f6f2a'),
  // Light
  m('light-warm', 'Light — Warm Emissive', 'light', '#fff2d6', { emissive: '#ffe2a8' }),
  m('light-off', 'Light — Switched Off', 'light', '#e9e4da', { roughness: 0.55 }),
  m('insulation', 'Insulation', 'masonry', '#e8d36a', { hatch: 'insulation', density: 30 }),
];

const BY_ID = new Map(MATERIALS.map((x) => [x.id, x]));

export const DEFAULT_MATERIAL_FOR: Record<ElementType, string> = {
  wall: 'plaster-white',
  door: 'wood-oak',
  window: 'glass-clear',
  slab: 'concrete',
  roof: 'roof-tiles-clay',
  stair: 'concrete',
  column: 'concrete',
  beam: 'concrete',
  furniture: 'wood-oak',
  room: 'wood-floor-oak',
  block: 'brick-red',
  railing: 'metal-black',
  dimension: 'paint-black',
  label: 'paint-black',
};

const FALLBACK = MATERIALS[0];

export function getMaterial(id: string | undefined): MaterialDef {
  return (id && BY_ID.get(id)) || FALLBACK;
}

export function hasMaterial(id: string | undefined): boolean {
  return !!id && BY_ID.has(id);
}

export function materialFor(el: { type: ElementType; materialId?: string }): MaterialDef {
  return getMaterial(el.materialId && BY_ID.has(el.materialId) ? el.materialId : DEFAULT_MATERIAL_FOR[el.type]);
}

export function materialsByCategory(): Map<MaterialCategory, MaterialDef[]> {
  const out = new Map<MaterialCategory, MaterialDef[]>();
  for (const mat of MATERIALS) {
    const arr = out.get(mat.category) ?? [];
    arr.push(mat);
    out.set(mat.category, arr);
  }
  return out;
}
