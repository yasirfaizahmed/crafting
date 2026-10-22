/**
 * Pure move / rotate helpers for the select tool. Moving a wall moves both ends and drags the
 * joined ends of neighbouring walls along (T-joined walls follow the perpendicular component);
 * openings slide along their host; everything else translates in plan.
 */
import { add, closestOnSegment, distance, dot, rotate, scale, sub } from '../../core/math2d';
import type { Element, Opening, Project, Vec2, Wall } from '../../core/types';
import { JOIN_TOLERANCE, openingFits, wallDirection, wallFaceOffsets, wallLength, wallNormal } from '../../core/walls';

const mv = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** Translate an element's plan geometry by `d` (openings are unchanged: they ride on their host). */
export function translateElement<T extends Element>(el: T, d: Vec2): T {
  const e = el as Element;
  switch (e.type) {
    case 'wall':
    case 'beam':
      return { ...el, start: mv(e.start, d), end: mv(e.end, d) };
    case 'slab':
      return { ...el, outline: e.outline.map((p) => mv(p, d)), holes: e.holes?.map((h) => h.map((p) => mv(p, d))) };
    case 'roof':
    case 'room':
      return { ...el, outline: e.outline.map((p) => mv(p, d)) };
    case 'stair':
    case 'column':
    case 'furniture':
    case 'label':
      return { ...el, position: mv(e.position, d) };
    case 'block':
      return { ...el, position: { ...e.position, x: e.position.x + d.x, y: e.position.y + d.y } };
    case 'railing':
      return { ...el, path: e.path.map((p) => mv(p, d)) };
    case 'dimension':
      return { ...el, a: mv(e.a, d), b: mv(e.b, d) };
    default:
      return el;
  }
}

export interface MoveResult {
  /** Changed copies of every affected element (selection + attached neighbours). */
  elements: Element[];
  valid: boolean;
}

/** Compute the result of moving `ids` by `delta` (mm) without touching the store. */
export function moveElements(project: Pick<Project, 'elements' | 'levels'>, ids: readonly string[], delta: Vec2): MoveResult {
  const els = project.elements;
  const sel = new Set(ids.filter((id) => els[id] && !els[id].locked));
  const out = new Map<string, Element>();
  let valid = true;
  for (const id of sel) {
    const el = els[id];
    if (el.type === 'door' || el.type === 'window') {
      if (sel.has(el.hostId)) continue;
      const host = els[el.hostId];
      if (host?.type !== 'wall') continue;
      const len = wallLength(host);
      let offset = el.offset + dot(delta, wallDirection(host));
      if (len >= el.width) offset = Math.min(len - el.width / 2, Math.max(el.width / 2, offset));
      const next = { ...el, offset } as Opening;
      if (!openingFits(project, host, next)) valid = false;
      if (overlapsOthers(project, next, sel)) valid = false;
      out.set(id, next);
      continue;
    }
    out.set(id, translateElement(el, delta));
  }
  // Keep joined neighbours attached to moved walls.
  for (const id of sel) {
    const w = els[id];
    if (w.type !== 'wall') continue;
    const n = wallNormal(w);
    const perpMove = scale(n, dot(delta, n));
    const reach = Math.max(Math.abs(wallFaceOffsets(w).left), Math.abs(wallFaceOffsets(w).right)) + JOIN_TOLERANCE;
    for (const o of Object.values(els)) {
      if (o.type !== 'wall' || o.id === w.id || sel.has(o.id) || o.levelId !== w.levelId || o.locked) continue;
      const cur = (out.get(o.id) as Wall | undefined) ?? o;
      let start = cur.start;
      let end = cur.end;
      const follow = (p: Vec2): Vec2 | null => {
        if (distance(p, w.start) <= JOIN_TOLERANCE || distance(p, w.end) <= JOIN_TOLERANCE) return mv(p, delta);
        const c = closestOnSegment(p, w.start, w.end);
        if (c.t > 0 && c.t < 1 && c.distance <= reach) return add(p, perpMove);
        return null;
      };
      const s = follow(o.start);
      const e = follow(o.end);
      if (s) start = s;
      if (e) end = e;
      if (s || e) out.set(o.id, { ...cur, start, end });
    }
  }
  return { elements: [...out.values()], valid };
}

function overlapsOthers(project: Pick<Project, 'elements'>, op: Opening, moving: Set<string>): boolean {
  const a = op.offset - op.width / 2;
  const b = op.offset + op.width / 2;
  return Object.values(project.elements).some((o) => {
    if ((o.type !== 'door' && o.type !== 'window') || o.hostId !== op.hostId || o.id === op.id || moving.has(o.id)) return false;
    return a < o.offset + o.width / 2 - 1e-6 && o.offset - o.width / 2 < b - 1e-6;
  });
}

/** Rotate furniture / columns / stairs / blocks in place by `deg` (CCW). Others are ignored. */
export function rotateElements(project: Pick<Project, 'elements'>, ids: readonly string[], deg: number): Element[] {
  const out: Element[] = [];
  const norm = (d: number) => ((Math.round(d * 1000) / 1000) % 360 + 360) % 360;
  for (const id of ids) {
    const el = project.elements[id];
    if (!el || el.locked) continue;
    if (el.type === 'furniture' || el.type === 'column' || el.type === 'stair') out.push({ ...el, rotation: norm(el.rotation + deg) });
    else if (el.type === 'block') {
      const half = { x: el.size.x / 2, y: el.size.y / 2 };
      const c = add({ x: el.position.x, y: el.position.y }, rotate(half, el.rotation));
      const r = norm(el.rotation + deg);
      const p = sub(c, rotate(half, r));
      out.push({ ...el, rotation: r, position: { ...el.position, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 } });
    }
  }
  return out;
}

/**
 * Elements to render for a drag preview of `changed`: the changed elements plus the hosts of moved
 * openings and the openings riding on moved walls (their geometry depends on each other).
 */
export function previewSet(project: Pick<Project, 'elements'>, changed: Element[]): Element[] {
  const byId = new Map(changed.map((e) => [e.id, e]));
  for (const e of changed) {
    if ((e.type === 'door' || e.type === 'window') && !byId.has(e.hostId)) {
      const host = project.elements[e.hostId];
      if (host) byId.set(host.id, host);
    }
  }
  for (const e of changed) {
    if (e.type !== 'wall') continue;
    for (const o of Object.values(project.elements)) {
      if ((o.type === 'door' || o.type === 'window') && o.hostId === e.id && !byId.has(o.id)) byId.set(o.id, o);
    }
  }
  return [...byId.values()];
}
