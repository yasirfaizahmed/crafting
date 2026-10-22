/** Human-readable summary of an element for the HUD hover card (type, name, key dimensions). */
import { getFurniture } from '../core/catalog';
import { getMaterial, materialFor } from '../core/materials';
import { distance, polygonArea } from '../core/math2d';
import { computeStairLayout } from '../core/stairs';
import type { Element, Project, UnitSystem } from '../core/types';
import { formatArea, formatLength } from '../core/units';
import { wallHeight, wallLength } from '../core/walls';

export interface ElementInfo {
  title: string;
  subtitle: string;
  details: string[];
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function describeElement(project: Pick<Project, 'levels' | 'elements'>, el: Element, units: UnitSystem = 'metric'): ElementInfo {
  const L = (mm: number) => formatLength(mm, units);
  const level = project.levels.find((l) => l.id === el.levelId);
  const mat = materialFor(el);
  const details: string[] = [];
  let title = cap(el.type);
  let subtitle = el.name ?? '';
  switch (el.type) {
    case 'wall':
      details.push(`${L(wallLength(el))} long · ${L(el.thickness)} thick`, `Height ${L(wallHeight(project, el))}${el.baseOffset ? ` · base +${L(el.baseOffset)}` : ''}`);
      subtitle ||= `${mat.name}${el.structural ? ' · structural' : ''}`;
      if (el.leftFinishId || el.rightFinishId) {
        details.push(`Finish L: ${el.leftFinishId ? getMaterial(el.leftFinishId).name : '—'} · R: ${el.rightFinishId ? getMaterial(el.rightFinishId).name : '—'}`);
      }
      break;
    case 'door':
    case 'window':
      title = `${cap(el.type)} — ${el.style}`;
      details.push(`${L(el.width)} × ${L(el.height)}`);
      if (el.type === 'window') details.push(`Sill ${L(el.sill)}`);
      else details.push(`Hinge ${el.hinge}${el.flip ? ' · swings right' : ''}`);
      break;
    case 'slab':
      title = `Slab — ${el.kind}`;
      details.push(`${formatArea(polygonArea(el.outline), units)} · ${L(el.thickness)} thick`);
      subtitle ||= mat.name;
      break;
    case 'roof':
      title = `Roof — ${el.shape}${el.shape === 'flat' ? '' : ` ${el.pitch}°`}`;
      details.push(`Overhang ${L(el.overhang)} · ${L(el.thickness)} thick`);
      subtitle ||= mat.name;
      break;
    case 'stair': {
      const lay = computeStairLayout(el, level?.height ?? 3000);
      title = `Stair — ${el.shape}`;
      details.push(`${L(el.width)} wide · ${lay.riserCount} risers × ${L(Math.round(lay.riserHeight))}`, `Going ${L(el.tread)}`);
      break;
    }
    case 'column':
      details.push(el.shape === 'round' ? `Ø ${L(el.width)}` : `${L(el.width)} × ${L(el.depth)}`, `Height ${L(el.height ?? level?.height ?? 3000)}`);
      subtitle ||= mat.name;
      break;
    case 'beam':
      details.push(`${L(distance(el.start, el.end))} span`, `${L(el.width)} × ${L(el.depth)}`);
      subtitle ||= mat.name;
      break;
    case 'furniture': {
      const def = getFurniture(el.catalogId);
      title = def?.name ?? 'Furniture';
      details.push(`${L(el.width ?? def?.width ?? 0)} × ${L(el.depth ?? def?.depth ?? 0)} × ${L(el.height ?? def?.height ?? 0)}`);
      break;
    }
    case 'block':
      title = `Block — ${el.shape}`;
      details.push(`${L(el.size.x)} × ${L(el.size.y)} × ${L(el.size.z)}`);
      subtitle ||= mat.name;
      break;
    case 'railing': {
      let len = 0;
      for (let i = 0; i + 1 < el.path.length; i++) len += distance(el.path[i], el.path[i + 1]);
      title = `Railing — ${el.style}`;
      details.push(`${L(len)} long · ${L(el.height)} high`);
      break;
    }
    case 'room':
      title = el.name;
      details.push(formatArea(polygonArea(el.outline), units));
      break;
    default:
      break;
  }
  if (level) details.push(level.name);
  if (el.locked) details.push('Locked');
  return { title, subtitle, details };
}
