/**
 * Parametric low-poly furniture. Every FURNITURE catalog id has a dedicated model; unknown ids fall
 * back to a model chosen by the catalog plan symbol (or a plain box). Models are built at the
 * element's actual width/depth/height (overrides included), then mirrored, rotated and placed.
 */
import { getFurniture, type FurniturePlanSymbol } from '../../core/catalog';
import { DEFAULT_MATERIAL_FOR, getMaterial, hasMaterial } from '../../core/materials';
import type { Furniture } from '../../core/types';
import { levelElevation } from '../cache';
import { Model, placement } from '../model';
import type { GeometryContext, GeometryPart, LightDef } from '../types';
import { BATH, BASIN_TAP_RISE } from './bath';
import { BEDROOM, bed } from './bedroom';
import { DECOR } from './decor';
import { DINING, chair, rectTable, roundTable } from './dining';
import { KITCHEN, TAP_RISE, baseCabinet } from './kitchen';
import type { FurnitureBuilder, FurnitureSpec } from './kit';
import { LIGHTING } from './lighting';
import { LIVING } from './living';
import { OFFICE } from './office';
import { OUTDOOR } from './outdoor';

export type { FurnitureBuilder, FurnitureSpec } from './kit';

/** Dedicated model per catalog id. */
export const FURNITURE_MODELS: Record<string, FurnitureBuilder> = {
  ...LIVING,
  ...DINING,
  ...BEDROOM,
  ...OFFICE,
  ...KITCHEN,
  ...BATH,
  ...LIGHTING,
  ...OUTDOOR,
  ...DECOR,
};

const box: FurnitureBuilder = (m, s) => {
  m.use(s.primary, 'body');
  m.box(-s.w / 2, -s.d / 2, 0, s.w / 2, s.d / 2, s.h);
};

/** Fallback models for ids without a dedicated model, by plan symbol. */
const BY_SYMBOL: Partial<Record<FurniturePlanSymbol, FurnitureBuilder>> = {
  rect: (m, s) => baseCabinet(m, s.w, s.d, s.h, { carcass: s.primary, front: s.primary, drawerRow: false }),
  counter: (m, s) => baseCabinet(m, s.w, s.d, s.h, { carcass: s.primary, front: s.primary, top: s.secondary }),
  round: (m, s) => roundTable(m, s.w, s.d, s.h, s.primary),
  table: (m, s) => rectTable(m, s.w, s.d, s.h, s.primary),
  chair: (m, s) => chair(m, s.w, s.d, s.h, { frame: s.primary, seat: s.secondary }),
  bed: (m, s) => bed(m, s.w, s.d, s.h, { frame: s.secondary, bedding: s.primary }),
  sofa: FURNITURE_MODELS['sofa-3'],
  toilet: FURNITURE_MODELS.toilet,
  sink: FURNITURE_MODELS.washbasin,
  bathtub: FURNITURE_MODELS.bathtub,
  shower: FURNITURE_MODELS.shower,
  stove: FURNITURE_MODELS.stove,
  fridge: FURNITURE_MODELS.fridge,
  tree: FURNITURE_MODELS.tree,
  car: FURNITURE_MODELS.car,
  lamp: FURNITURE_MODELS['floor-lamp'],
  wardrobe: FURNITURE_MODELS.wardrobe,
  rug: FURNITURE_MODELS.rug,
  plant: FURNITURE_MODELS.shrub,
};

/**
 * Height a model may exceed its catalog height by (taps above sink and basin rims); everything
 * else stays inside width × depth × height.
 */
export const FURNITURE_HEIGHT_ALLOWANCE: Record<string, number> = {
  'kitchen-sink': TAP_RISE,
  washbasin: BASIN_TAP_RISE,
  vanity: BASIN_TAP_RISE,
};

const SECONDARY_FALLBACK = 'wood-walnut';

const positive = (v: number | undefined): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Resolved model inputs for a furniture element. */
export function furnitureSpec(el: Furniture): FurnitureSpec {
  const def = getFurniture(el.catalogId) ?? {
    id: el.catalogId,
    name: el.catalogId,
    category: 'decor' as const,
    width: 1000,
    depth: 1000,
    height: 1000,
    materialId: DEFAULT_MATERIAL_FOR.furniture,
    plan: 'rect' as const,
    icon: '',
  };
  const primary = el.materialId && hasMaterial(el.materialId) ? el.materialId : def.materialId;
  const secondary = def.secondaryMaterialId && hasMaterial(def.secondaryMaterialId) ? def.secondaryMaterialId : SECONDARY_FALLBACK;
  return {
    def,
    w: positive(el.width) ?? def.width,
    d: positive(el.depth) ?? def.depth,
    h: positive(el.height) ?? def.height,
    primary: hasMaterial(primary) ? primary : getMaterial(undefined).id,
    secondary,
  };
}

export function buildFurniture(ctx: GeometryContext, el: Furniture): { parts: GeometryPart[]; lights: LightDef[] } {
  const spec = furnitureSpec(el);
  const z = levelElevation(ctx, el.levelId) + (Number.isFinite(el.elevation) ? el.elevation : 0);
  const m = new Model(placement(el.position.x, el.position.y, z, el.rotation, !!el.mirrored), spec.primary);
  const builder = FURNITURE_MODELS[spec.def.id] ?? BY_SYMBOL[spec.def.plan] ?? box;
  const res = builder(m, spec) ?? {};
  if (m.isEmpty) box(m, spec);
  const lights: LightDef[] = [];
  const light = getFurniture(el.catalogId)?.light;
  if (light) lights.push({ position: m.toWorld(res.light ?? [0, 0, spec.h / 2]), ...light });
  return { parts: m.parts(), lights };
}
