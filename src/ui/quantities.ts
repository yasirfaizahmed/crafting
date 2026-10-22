/**
 * Quantity take-off (pure): counts, wall lengths/areas, floor areas, slab and concrete volumes.
 * All results are in model units (mm, mm², mm³).
 */
import { getFurniture } from '../core/catalog';
import { distance, polygonArea, polygonPerimeter } from '../core/math2d';
import { materialFor } from '../core/materials';
import { computeStairLayout } from '../core/stairs';
import type { Column, Element, ElementType, Project, Slab, Wall } from '../core/types';
import { formatArea, formatLength, formatVolume } from '../core/units';
import type { UnitSystem } from '../core/types';
import { openingsOfWall, wallHeight, wallLength } from '../core/walls';

export const TYPE_ORDER: ElementType[] = [
  'wall',
  'door',
  'window',
  'slab',
  'roof',
  'stair',
  'column',
  'beam',
  'railing',
  'room',
  'furniture',
  'block',
  'dimension',
  'label',
];

export const TYPE_LABELS: Record<ElementType, [string, string]> = {
  wall: ['Wall', 'Walls'],
  door: ['Door', 'Doors'],
  window: ['Window', 'Windows'],
  slab: ['Slab', 'Slabs'],
  roof: ['Roof', 'Roofs'],
  stair: ['Stair', 'Stairs'],
  column: ['Column', 'Columns'],
  beam: ['Beam', 'Beams'],
  railing: ['Railing', 'Railings'],
  room: ['Room', 'Rooms'],
  furniture: ['Furniture', 'Furniture'],
  block: ['Block', 'Blocks'],
  dimension: ['Dimension', 'Dimensions'],
  label: ['Label', 'Labels'],
};

export const TYPE_ICONS: Record<ElementType, string> = {
  wall: '🧱',
  door: '🚪',
  window: '🪟',
  slab: '⬛',
  roof: '🏠',
  stair: '🪜',
  column: '▮',
  beam: '━',
  railing: '┼',
  room: '🏷️',
  furniture: '🛋️',
  block: '🟫',
  dimension: '↔️',
  label: '🔤',
};

export interface WallQuantity {
  length: number;
  height: number;
  grossArea: number;
  openingArea: number;
  netArea: number;
  volume: number;
}

export interface RoomQuantity {
  id: string;
  name: string;
  number?: string;
  levelId: string;
  area: number;
  perimeter: number;
}

export interface Quantities {
  counts: Partial<Record<ElementType, number>>;
  total: number;
  walls: { count: number; length: number; grossArea: number; netArea: number; volume: number };
  rooms: RoomQuantity[];
  totalFloorArea: number;
  slabs: { count: number; area: number; volume: number };
  /** Cast concrete estimate (walls, slabs, columns, beams, stairs with a concrete material). */
  concreteVolume: number;
  doorsByStyle: Record<string, number>;
  windowsByStyle: Record<string, number>;
  furnitureByName: Record<string, number>;
}

export function wallQuantity(project: Pick<Project, 'elements' | 'levels'>, w: Wall): WallQuantity {
  const length = wallLength(w);
  const height = wallHeight(project, w);
  const grossArea = length * height;
  let openingArea = 0;
  for (const o of openingsOfWall(project, w.id)) openingArea += Math.max(0, Math.min(o.width, length)) * Math.max(0, Math.min(o.height, height - o.sill));
  const netArea = Math.max(0, grossArea - openingArea);
  return { length, height, grossArea, openingArea, netArea, volume: netArea * w.thickness };
}

export function slabArea(s: Pick<Slab, 'outline' | 'holes'>): number {
  const holes = (s.holes ?? []).reduce((a, h) => a + polygonArea(h), 0);
  return Math.max(0, polygonArea(s.outline) - holes);
}

export function columnVolume(project: Pick<Project, 'levels'>, c: Column): number {
  const h = c.height ?? project.levels.find((l) => l.id === c.levelId)?.height ?? 3000;
  const section = c.shape === 'round' ? Math.PI * (c.width / 2) * (c.depth / 2) : c.width * c.depth;
  return section * h;
}

/** Concrete-ish volume of an element (mm³), 0 for non-structural types. */
export function elementVolume(project: Pick<Project, 'elements' | 'levels'>, el: Element): number {
  switch (el.type) {
    case 'wall':
      return wallQuantity(project, el).volume;
    case 'slab':
      return slabArea(el) * el.thickness;
    case 'column':
      return columnVolume(project, el);
    case 'beam':
      return distance(el.start, el.end) * el.width * el.depth;
    case 'stair': {
      const levelHeight = project.levels.find((l) => l.id === el.levelId)?.height ?? 3000;
      const lay = computeStairLayout(el, levelHeight);
      // Solid steps (triangular prism per riser) + 150 mm waist under the flight.
      const steps = [...lay.treads, ...lay.landings].reduce((a, t) => a + polygonArea(t.polygon) * lay.riserHeight * 0.5, 0);
      const waist = lay.footprint.reduce((a, p) => a + polygonArea(p), 0) * 150;
      return steps + waist;
    }
    case 'block': {
      const v = el.size.x * el.size.y * el.size.z;
      return el.shape === 'sphere' ? (Math.PI / 6) * v : el.shape === 'cylinder' ? (Math.PI / 4) * v : el.shape === 'wedge' ? v / 2 : v;
    }
    default:
      return 0;
  }
}

/** Take-off for the given levels (all levels when omitted). */
export function computeQuantities(project: Pick<Project, 'elements' | 'levels'>, levelIds?: readonly string[]): Quantities {
  const scope = levelIds ? new Set(levelIds) : null;
  const els = Object.values(project.elements).filter((e) => !scope || scope.has(e.levelId));
  const q: Quantities = {
    counts: {},
    total: els.length,
    walls: { count: 0, length: 0, grossArea: 0, netArea: 0, volume: 0 },
    rooms: [],
    totalFloorArea: 0,
    slabs: { count: 0, area: 0, volume: 0 },
    concreteVolume: 0,
    doorsByStyle: {},
    windowsByStyle: {},
    furnitureByName: {},
  };
  for (const el of els) {
    q.counts[el.type] = (q.counts[el.type] ?? 0) + 1;
    switch (el.type) {
      case 'wall': {
        const w = wallQuantity(project, el);
        q.walls.count++;
        q.walls.length += w.length;
        q.walls.grossArea += w.grossArea;
        q.walls.netArea += w.netArea;
        q.walls.volume += w.volume;
        break;
      }
      case 'room': {
        const area = el.outline.length >= 3 ? polygonArea(el.outline) : 0;
        q.rooms.push({ id: el.id, name: el.name, number: el.number, levelId: el.levelId, area, perimeter: el.outline.length >= 3 ? polygonPerimeter(el.outline) : 0 });
        q.totalFloorArea += area;
        break;
      }
      case 'slab': {
        const a = slabArea(el);
        q.slabs.count++;
        q.slabs.area += a;
        q.slabs.volume += a * el.thickness;
        break;
      }
      case 'door':
        q.doorsByStyle[el.style] = (q.doorsByStyle[el.style] ?? 0) + 1;
        break;
      case 'window':
        q.windowsByStyle[el.style] = (q.windowsByStyle[el.style] ?? 0) + 1;
        break;
      case 'furniture': {
        const name = getFurniture(el.catalogId)?.name ?? el.catalogId;
        q.furnitureByName[name] = (q.furnitureByName[name] ?? 0) + 1;
        break;
      }
      default:
        break;
    }
    if (['wall', 'slab', 'column', 'beam', 'stair'].includes(el.type) && materialFor(el).category === 'concrete') q.concreteVolume += elementVolume(project, el);
  }
  const levelOrder = new Map(project.levels.map((l, i) => [l.id, i]));
  q.rooms.sort((a, b) => (levelOrder.get(a.levelId) ?? 0) - (levelOrder.get(b.levelId) ?? 0) || (a.number ?? '').localeCompare(b.number ?? '') || a.name.localeCompare(b.name));
  return q;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Spreadsheet-friendly take-off (values formatted in the display units). */
export function quantitiesToCSV(q: Quantities, units: UnitSystem, levelName = (id: string) => id): string {
  const rows: (string | number)[][] = [['Section', 'Item', 'Quantity', 'Unit / Value']];
  for (const t of TYPE_ORDER) if (q.counts[t]) rows.push(['Count', TYPE_LABELS[t][1], q.counts[t]!, 'pcs']);
  rows.push(['Walls', 'Total length', '', formatLength(q.walls.length, units)]);
  rows.push(['Walls', 'Gross area (one face)', '', formatArea(q.walls.grossArea, units)]);
  rows.push(['Walls', 'Net area (less openings)', '', formatArea(q.walls.netArea, units)]);
  rows.push(['Walls', 'Volume', '', formatVolume(q.walls.volume, units)]);
  for (const r of q.rooms) rows.push(['Rooms', `${r.number ? `${r.number} ` : ''}${r.name} (${levelName(r.levelId)})`, '', formatArea(r.area, units)]);
  rows.push(['Rooms', 'Total net floor area', '', formatArea(q.totalFloorArea, units)]);
  rows.push(['Slabs', 'Area', q.slabs.count, formatArea(q.slabs.area, units)]);
  rows.push(['Slabs', 'Volume', '', formatVolume(q.slabs.volume, units)]);
  rows.push(['Concrete', 'Estimated volume', '', formatVolume(q.concreteVolume, units)]);
  for (const [s, n] of Object.entries(q.doorsByStyle)) rows.push(['Doors', s, n, 'pcs']);
  for (const [s, n] of Object.entries(q.windowsByStyle)) rows.push(['Windows', s, n, 'pcs']);
  for (const [s, n] of Object.entries(q.furnitureByName)) rows.push(['Furniture', s, n, 'pcs']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
