/**
 * Copy / paste / duplicate of model elements (pure functions, no DOM).
 *
 * - Copying a wall also copies the doors/windows it hosts.
 * - Pasting assigns fresh ids, remaps `hostId` of copied openings to the copied walls, moves the
 *   elements onto the target level and translates them by `offset` (plan mm).
 * - Openings copied WITHOUT their host stay on the original wall (same level only), shifted
 *   along it; they are dropped when they cannot fit.
 */
import { cloneElement, createElement } from '../core/defaults';
import type { Element, Opening, Project, Vec2, Wall } from '../core/types';
import { openingFits, openingOverlaps, wallLength } from '../core/walls';

export interface ClipboardData {
  /** Deep copies of the copied elements (original ids). */
  elements: Element[];
  sourceLevelId: string;
}

/** Collect the elements to copy: the given ids plus openings hosted by copied walls. */
export function copyElements(project: Pick<Project, 'elements'>, ids: readonly string[]): ClipboardData | null {
  const picked = new Map<string, Element>();
  for (const id of ids) {
    const el = project.elements[id];
    if (el) picked.set(id, el);
  }
  if (!picked.size) return null;
  for (const el of Object.values(project.elements)) {
    if ((el.type === 'door' || el.type === 'window') && picked.get(el.hostId)?.type === 'wall') picked.set(el.id, el);
  }
  const elements = [...picked.values()].map((e) => cloneElement(e));
  // Most common level wins as the "source" level (used to decide on paste offsets).
  const counts = new Map<string, number>();
  for (const e of elements) counts.set(e.levelId, (counts.get(e.levelId) ?? 0) + 1);
  const sourceLevelId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { elements, sourceLevelId };
}

const mv = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** Translate an element in plan by `d` (returns a new object; hosted openings are unchanged). */
export function translateElement<T extends Element>(el: T, d: Vec2): T {
  const e = cloneElement(el) as Element;
  switch (e.type) {
    case 'wall':
    case 'beam':
      e.start = mv(e.start, d);
      e.end = mv(e.end, d);
      break;
    case 'slab':
      e.outline = e.outline.map((p) => mv(p, d));
      if (e.holes) e.holes = e.holes.map((h) => h.map((p) => mv(p, d)));
      break;
    case 'roof':
    case 'room':
      e.outline = e.outline.map((p) => mv(p, d));
      break;
    case 'stair':
    case 'column':
    case 'furniture':
    case 'label':
      e.position = mv(e.position, d);
      break;
    case 'block':
      e.position = { ...e.position, x: e.position.x + d.x, y: e.position.y + d.y };
      break;
    case 'railing':
      e.path = e.path.map((p) => mv(p, d));
      break;
    case 'dimension':
      e.a = mv(e.a, d);
      e.b = mv(e.b, d);
      break;
    case 'door':
    case 'window':
      break;
  }
  return e as T;
}

export interface PasteOptions {
  /** Level to paste onto. */
  levelId: string;
  /** Plan translation in mm. */
  offset: Vec2;
}

/**
 * Prepare clipboard elements for insertion: fresh ids, remapped hosts, target level, offset.
 * `project` is the CURRENT project (used to validate openings pasted onto existing walls).
 */
export function preparePaste(project: Pick<Project, 'elements' | 'levels'>, data: ClipboardData, opts: PasteOptions): Element[] {
  const idMap = new Map<string, string>();
  const out: Element[] = [];
  const copiedIds = new Set(data.elements.map((e) => e.id));
  // Non-openings first so openings can be remapped to their new hosts.
  for (const el of data.elements) {
    if (el.type === 'door' || el.type === 'window') continue;
    const fresh = withNewId(translateElement(el, opts.offset));
    fresh.levelId = opts.levelId;
    idMap.set(el.id, fresh.id);
    out.push(fresh);
  }
  const pastedOpenings: Opening[] = [];
  for (const el of data.elements) {
    if (el.type !== 'door' && el.type !== 'window') continue;
    if (copiedIds.has(el.hostId)) {
      const hostId = idMap.get(el.hostId);
      if (!hostId) continue;
      const fresh = withNewId(cloneElement(el)) as Opening;
      fresh.hostId = hostId;
      fresh.levelId = opts.levelId;
      out.push(fresh);
      continue;
    }
    // Host not copied: re-host on the original wall, next to the original opening.
    const host = project.elements[el.hostId];
    if (!host || host.type !== 'wall' || host.levelId !== opts.levelId) continue;
    const placed = placeAlongHost(project, host, el, pastedOpenings);
    if (placed) {
      pastedOpenings.push(placed);
      out.push(placed);
    }
  }
  return out;
}

function placeAlongHost(project: Pick<Project, 'elements' | 'levels'>, host: Wall, op: Opening, extra: Opening[]): Opening | null {
  const step = op.width + 300;
  const len = wallLength(host);
  const view = { elements: { ...project.elements } };
  for (const e of extra) view.elements[e.id] = e;
  for (let k = 1; k <= Math.ceil(len / step) + 1; k++) {
    for (const dir of [1, -1]) {
      const candidate = withNewId(cloneElement(op)) as Opening;
      candidate.offset = op.offset + dir * k * step;
      if (openingFits(project, host, candidate, 50) && !openingOverlaps(view, candidate)) return candidate;
    }
  }
  return null;
}

function withNewId<T extends Element>(el: T): T {
  const id = createElement(el.type, el.levelId).id;
  return { ...el, id };
}

/** Offset for the n-th paste (1-based): onto the source level shift by n grid steps, else paste in place. */
export function pasteOffset(data: ClipboardData, targetLevelId: string, gridSize: number, n: number): Vec2 {
  if (targetLevelId !== data.sourceLevelId) return { x: 0, y: 0 };
  const g = Math.max(1, gridSize) * Math.max(1, n);
  return { x: g, y: -g };
}

/** Duplicate each element on its own level, offset by one grid step (Ctrl+D). */
export function duplicateElements(project: Pick<Project, 'elements' | 'levels'>, ids: readonly string[], gridSize: number): Element[] {
  const data = copyElements(project, ids);
  if (!data) return [];
  const byLevel = new Map<string, Element[]>();
  for (const e of data.elements) byLevel.set(e.levelId, [...(byLevel.get(e.levelId) ?? []), e]);
  const out: Element[] = [];
  for (const [levelId, elements] of byLevel) {
    const group: ClipboardData = { elements, sourceLevelId: levelId };
    out.push(...preparePaste(project, group, { levelId, offset: pasteOffset(group, levelId, gridSize, 1) }));
  }
  return out;
}
