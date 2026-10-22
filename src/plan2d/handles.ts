/**
 * Edit handles for selected elements and how dragging them changes the model (pure).
 */
import { add, dirFromDeg, distance, dot, midpoint, normalize, perp, scale, sub } from '../core/math2d';
import type { Element, Opening, Vec2 } from '../core/types';
import { projectOntoWall, wallLength } from '../core/walls';
import { dragWallEndpoint, type Patch, withVertex } from './edit-ops';
import type { Handle } from './editor-types';
import { blockOutline, dimensionLine, furnitureSize, labelBox, openingFrame } from './shapes';
import { normDeg, snapAngleDeg } from './tools/common';

export interface HandleContext {
  elements: Record<string, Element>;
  /** Screen px → model mm. */
  px(n: number): number;
  levelHeight: number;
}

const H = (el: Element, kind: Handle['kind'], p: Vec2, shape: Handle['shape'], index?: number, cursor?: string): Handle => ({
  id: `${el.id}:${kind}:${index ?? 0}`,
  elementId: el.id,
  kind,
  p,
  shape,
  index,
  cursor,
});

/** Reference radius used to place rotate handles outside the element. */
function rotateRadius(el: Element): { center: Vec2; r: number } | null {
  switch (el.type) {
    case 'furniture':
      return { center: el.position, r: furnitureSize(el).d / 2 };
    case 'column':
      return { center: el.position, r: Math.max(el.width, el.depth) / 2 };
    case 'stair':
      return { center: el.position, r: el.width / 2 };
    case 'label': {
      const b = labelBox(el);
      return { center: el.position, r: distance(b[0], b[3]) / 2 };
    }
    case 'block':
      return { center: el.position, r: el.size.y };
    default:
      return null;
  }
}

function rotation(el: Element): number {
  return 'rotation' in el && typeof el.rotation === 'number' ? el.rotation : 0;
}

export function handlesFor(el: Element, ctx: HandleContext): Handle[] {
  if (el.locked) return [];
  switch (el.type) {
    case 'wall':
      return [H(el, 'wall-start', el.start, 'square', 0, 'move'), H(el, 'wall-end', el.end, 'square', 1, 'move')];
    case 'beam':
      return [H(el, 'point-a', el.start, 'square', 0, 'move'), H(el, 'point-b', el.end, 'square', 1, 'move')];
    case 'dimension': {
      const l = dimensionLine(el);
      return [H(el, 'point-a', el.a, 'square', 0, 'move'), H(el, 'point-b', el.b, 'square', 1, 'move'), H(el, 'offset', midpoint(l.a, l.b), 'diamond', 0, 'ns-resize')];
    }
    case 'door':
    case 'window': {
      const host = ctx.elements[el.hostId];
      if (!host || host.type !== 'wall') return [];
      const fr = openingFrame(host, el);
      const mid = (fr.left + fr.right) / 2;
      return [H(el, 'opening-a', fr.at(fr.a, mid), 'diamond', 0, 'ew-resize'), H(el, 'opening-b', fr.at(fr.b, mid), 'diamond', 1, 'ew-resize')];
    }
    case 'room':
    case 'slab':
    case 'roof':
    case 'railing': {
      const pts = el.type === 'railing' ? el.path : el.outline;
      const closed = el.type !== 'railing';
      const out = pts.map((p, i) => H(el, 'vertex', p, 'square', i, 'move'));
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (distance(a, b) > ctx.px(30)) out.push(H(el, 'insert', midpoint(a, b), 'diamond', i, 'copy'));
      }
      return out;
    }
    case 'furniture':
    case 'column':
    case 'stair':
    case 'label':
    case 'block': {
      const rr = rotateRadius(el);
      if (!rr) return [];
      let center = rr.center;
      if (el.type === 'block') {
        const o = blockOutline(el);
        center = scale(add(o[0], o[2]), 0.5);
      }
      const dir = dirFromDeg(rotation(el) + 90);
      return [H(el, 'rotate', add(center, scale(dir, rr.r + ctx.px(26))), 'circle', 0, 'grab')];
    }
    default:
      return [];
  }
}

/**
 * Apply a handle drag. `base` is the element as it was when the drag started; `target` the
 * (snapped) pointer position. Returns the resulting patch.
 */
export function applyHandle(h: Handle, base: Element, target: Vec2, ctx: { elements: Record<string, Element>; freeAngle: boolean }): Patch {
  const patch: Patch = new Map();
  const set = (el: Element) => patch.set(el.id, el);
  switch (h.kind) {
    case 'wall-start':
    case 'wall-end':
      return dragWallEndpoint(ctx.elements, base.id, h.kind === 'wall-start' ? 'start' : 'end', target);
    case 'vertex':
      set(withVertex(base, h.index ?? 0, target));
      break;
    case 'point-a':
    case 'point-b': {
      const a = h.kind === 'point-a';
      if (base.type === 'beam') set({ ...base, [a ? 'start' : 'end']: { ...target } });
      else if (base.type === 'dimension') set({ ...base, [a ? 'a' : 'b']: { ...target } });
      break;
    }
    case 'offset': {
      if (base.type !== 'dimension') break;
      const n = perp(normalize(sub(base.b, base.a)));
      set({ ...base, offset: Math.round(dot(sub(target, base.a), n)) });
      break;
    }
    case 'rotate': {
      if (!('rotation' in base)) break;
      let center: Vec2 = 'position' in base ? { x: base.position.x, y: base.position.y } : { x: 0, y: 0 };
      if (base.type === 'block') {
        const o = blockOutline(base);
        center = scale(add(o[0], o[2]), 0.5);
      }
      const v = sub(target, center);
      if (Math.hypot(v.x, v.y) < 1e-6) break;
      let deg = (Math.atan2(v.y, v.x) * 180) / Math.PI - 90;
      deg = ctx.freeAngle ? Math.round(deg) : snapAngleDeg(deg, 15);
      const next = normDeg(deg);
      if (base.type === 'block') {
        // Keep the block centred while it turns about its corner reference.
        const half = { x: base.size.x / 2, y: base.size.y / 2 };
        const r = (p: Vec2, a: number) => {
          const c = Math.cos((a * Math.PI) / 180);
          const s = Math.sin((a * Math.PI) / 180);
          return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
        };
        const pos = sub(center, r(half, next));
        set({ ...base, rotation: next, position: { ...base.position, x: pos.x, y: pos.y } });
      } else set({ ...base, rotation: next } as Element);
      break;
    }
    case 'opening-a':
    case 'opening-b': {
      if (base.type !== 'door' && base.type !== 'window') break;
      const host = ctx.elements[base.hostId];
      if (!host || host.type !== 'wall') break;
      const op = base as Opening;
      const len = wallLength(host);
      const along = Math.round(Math.min(Math.max(projectOntoWall(host, target).offset, 0), len) / 10) * 10;
      let a = op.offset - op.width / 2;
      let b = op.offset + op.width / 2;
      if (h.kind === 'opening-a') a = Math.min(along, b - 300);
      else b = Math.max(along, a + 300);
      set({ ...op, offset: (a + b) / 2, width: b - a });
      break;
    }
    default:
      break;
  }
  return patch;
}
