/**
 * Human-readable names for elements (outliner rows, properties header, toasts).
 */
import { catalogItemForElement, getFurniture } from '../core/catalog';
import { distance, polygonArea } from '../core/math2d';
import { getMaterial } from '../core/materials';
import { slabNetArea } from '../core/stairwells';
import type { Element, Project, UnitSystem } from '../core/types';
import { formatArea, formatLength } from '../core/units';
import { wallLength } from '../core/walls';
import { TYPE_ICONS, TYPE_LABELS } from './quantities';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

/** Primary display name of an element. */
export function elementName(el: Element): string {
  if (el.type === 'room') return el.number ? `${el.number} · ${el.name}` : el.name;
  if (el.name) return el.name;
  switch (el.type) {
    case 'furniture':
      return getFurniture(el.catalogId)?.name ?? cap(el.catalogId);
    case 'label':
      return el.text ? `“${el.text}”` : 'Label';
    case 'door':
      return `${cap(el.style)} door`;
    case 'window':
      return `${cap(el.style)} window`;
    case 'slab':
      return `${cap(el.kind)} slab`;
    case 'roof':
      return `${cap(el.shape)} roof`;
    case 'stair':
      return `${cap(el.shape)} stair`;
    case 'column':
      return el.shape === 'round' ? 'Round column' : 'Column';
    case 'block':
      return `${cap(el.shape === 'box' ? 'block' : el.shape)} — ${getMaterial(el.materialId).name.split('—')[0].trim()}`;
    case 'railing':
      return `${cap(el.style)} railing`;
    default:
      return TYPE_LABELS[el.type][0];
  }
}

/** Secondary detail (size / material) for compact rows. With the project, slab areas are net of stair openings. */
export function elementDetail(el: Element, units: UnitSystem, project?: Pick<Project, 'elements' | 'levels'>): string {
  switch (el.type) {
    case 'wall':
      return `${formatLength(wallLength(el), units)} · ${formatLength(el.thickness, units)}`;
    case 'door':
    case 'window':
      return `${formatLength(el.width, units)} × ${formatLength(el.height, units)}`;
    case 'slab':
      return el.outline.length >= 3 ? formatArea(slabNetArea(project, el), units) : '';
    case 'room':
      return el.outline.length >= 3 ? formatArea(polygonArea(el.outline), units) : '';
    case 'roof':
      return el.shape === 'flat' ? 'flat' : `${el.pitch}°`;
    case 'beam':
      return formatLength(distance(el.start, el.end), units);
    case 'dimension':
      return formatLength(distance(el.a, el.b), units);
    case 'stair':
      return formatLength(el.width, units);
    case 'furniture': {
      const def = getFurniture(el.catalogId);
      return def ? `${formatLength(el.width ?? def.width, units)} × ${formatLength(el.depth ?? def.depth, units)}` : '';
    }
    default:
      return '';
  }
}

/** Icon for an element (its catalog item's glyph where possible). */
export function elementIcon(el: Element): string {
  if (el.type === 'furniture') return getFurniture(el.catalogId)?.icon ?? TYPE_ICONS.furniture;
  return catalogItemForElement(el as unknown as { type: string } & Record<string, unknown>)?.icon ?? TYPE_ICONS[el.type];
}
