/** Crafting element kinds → IFC4 entity classes and predefined-type enumerations. */
import type { FurnitureDef } from '../../core/catalog';
import type { Door, RoofShape, Slab, StairShape, Window } from '../../core/types';

export interface IfcClass {
  entity: string;
  predefinedType: string;
  /** Required by IFC when predefinedType is USERDEFINED; otherwise a descriptive type label. */
  objectType?: string;
}

const RAILING_TYPE = 'GUARDRAIL';

export function roofType(shape: RoofShape): string {
  switch (shape) {
    case 'flat':
      return 'FLAT_ROOF';
    case 'gable':
      return 'GABLE_ROOF';
    case 'hip':
      return 'HIP_ROOF';
    case 'shed':
      return 'SHED_ROOF';
    case 'pyramid':
      return 'PAVILION_ROOF';
  }
}

export function stairType(shape: StairShape): string {
  switch (shape) {
    case 'straight':
      return 'STRAIGHT_RUN_STAIR';
    case 'l-shape':
      return 'QUARTER_TURN_STAIR';
    case 'open-well':
      return 'TWO_QUARTER_TURN_STAIR';
    case 'u-shape':
      return 'HALF_TURN_STAIR';
    case 'spiral':
      return 'SPIRAL_STAIR';
  }
}

export function railingType(): string {
  return RAILING_TYPE;
}

/**
 * Slab kinds: floors and foundations are IfcSlab .FLOOR./.BASESLAB.; terraces are .ROOF. slabs when
 * they sit above the lowest storey (roof terraces / balconies), .FLOOR. on the ground; ceilings are
 * finish layers under the structure above and become IfcCovering .CEILING..
 */
export function slabClass(kind: Slab['kind'], onLowestLevel: boolean): IfcClass {
  switch (kind) {
    case 'foundation':
      return { entity: 'IFCSLAB', predefinedType: 'BASESLAB' };
    case 'floor':
      return { entity: 'IFCSLAB', predefinedType: 'FLOOR' };
    case 'terrace':
      return { entity: 'IFCSLAB', predefinedType: onLowestLevel ? 'FLOOR' : 'ROOF', objectType: 'Terrace' };
    case 'ceiling':
      return { entity: 'IFCCOVERING', predefinedType: 'CEILING' };
  }
}

/**
 * IFC door operation per IFC4 IfcDoorTypeOperationEnum. IFC views the hinge side looking in the
 * door's +y (opening) direction; Crafting's `hinge` is seen from the wall's left side.
 */
export function doorOperation(d: Door): { operation: string; userDefined?: string } {
  // The door placement is rotated so its +y points to the swing side (see builder).
  const ifcHinge = d.flip ? d.hinge : d.hinge === 'left' ? 'right' : 'left';
  const side = ifcHinge.toUpperCase();
  switch (d.style) {
    case 'single':
      return { operation: `SINGLE_SWING_${side}` };
    case 'double':
      return { operation: 'DOUBLE_DOOR_SINGLE_SWING' };
    case 'sliding':
      return { operation: `SLIDING_TO_${side}` };
    case 'pocket':
      return { operation: 'USERDEFINED', userDefined: `POCKET_SLIDING_TO_${side}` };
    case 'garage':
      return { operation: 'ROLLINGUP' };
    case 'opening':
      return { operation: 'NOTDEFINED' };
  }
}

export function windowPartitioning(w: Window): string {
  switch (w.style) {
    case 'casement':
    case 'fixed':
    case 'awning':
      return 'SINGLE_PANEL';
    case 'sliding':
      return 'DOUBLE_PANEL_VERTICAL';
    case 'double-hung':
      return 'DOUBLE_PANEL_HORIZONTAL';
  }
}

const SANITARY: Record<string, string> = {
  toilet: 'TOILETPAN',
  bathtub: 'BATH',
  shower: 'SHOWER',
};

const APPLIANCES: Record<string, string> = {
  stove: 'ELECTRICCOOKER',
  fridge: 'REFRIGERATOR',
  dishwasher: 'DISHWASHER',
  'washing-machine': 'WASHINGMACHINE',
};

const FURNITURE_TYPES: Partial<Record<FurnitureDef['plan'], string>> = {
  bed: 'BED',
  sofa: 'SOFA',
  chair: 'CHAIR',
  table: 'TABLE',
};

/** IFC class for a furniture catalog item: furniture, sanitary terminals, appliances, lights, vegetation… */
export function furnitureClass(def: FurnitureDef | undefined): IfcClass {
  if (!def) return { entity: 'IFCFURNITURE', predefinedType: 'NOTDEFINED' };
  const named = (entity: string, predefinedType: string): IfcClass => ({ entity, predefinedType, objectType: def.name });
  if (def.plan === 'lamp' || def.light) return named('IFCLIGHTFIXTURE', 'POINTSOURCE');
  if (SANITARY[def.plan]) return named('IFCSANITARYTERMINAL', SANITARY[def.plan]);
  if (def.plan === 'sink') return named('IFCSANITARYTERMINAL', def.category === 'kitchen' ? 'SINK' : 'WASHHANDBASIN');
  const appliance = APPLIANCES[def.plan] ?? APPLIANCES[def.id];
  if (appliance) return named('IFCELECTRICAPPLIANCE', appliance);
  if (def.category === 'outdoor' && (def.plan === 'tree' || def.plan === 'plant')) return named('IFCGEOGRAPHICELEMENT', 'USERDEFINED');
  if (def.plan === 'car') return named('IFCBUILDINGELEMENTPROXY', 'USERDEFINED');
  if (def.id === 'desk') return named('IFCFURNITURE', 'DESK');
  if (def.id === 'filing-cabinet') return named('IFCFURNITURE', 'FILECABINET');
  if (def.id === 'bookshelf') return named('IFCFURNITURE', 'SHELF');
  const t = FURNITURE_TYPES[def.plan];
  return named('IFCFURNITURE', t ?? 'USERDEFINED');
}
