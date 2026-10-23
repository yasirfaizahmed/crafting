/**
 * Edit handles for selected elements and how dragging them changes the model (pure).
 */
import { add, dirFromDeg, distance, dot, midpoint, normalize, perp, scale, sub } from '../core/math2d';
import { computeStairLayout, editableRuns } from '../core/stairs';
import type { Element, Opening, Stair, StairRuns, Vec2 } from '../core/types';
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
    case 'stair':
      return [...stairHandles(el, ctx), ...rotateHandle(el, ctx)];
    case 'furniture':
    case 'column':
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

function rotateHandle(el: Element, ctx: HandleContext): Handle[] {
  const rr = rotateRadius(el);
  if (!rr) return [];
  const dir = dirFromDeg(rotation(el) + 90);
  return [H(el, 'rotate', add(rr.center, scale(dir, rr.r + ctx.px(26))), 'circle', 0, 'grab')];
}

/** Stretch handles of a straight-run stair: flight ends, flight sides, landing far edges, U-turn wells. */
function stairHandles(st: Stair, ctx: HandleContext): Handle[] {
  const layout = computeStairLayout(st, ctx.levelHeight);
  if (!layout.runs || !layout.flights) return [];
  const out: Handle[] = [];
  layout.flights.forEach((f, i) => {
    const run = f.treadIndices.length * f.going;
    const left = perp(f.direction);
    const end = add(f.start, scale(f.direction, run));
    out.push(H(st, 'stair-end', end, 'diamond', i, 'move'));
    if (run > ctx.px(24)) out.push(H(st, 'stair-width', add(add(f.start, scale(f.direction, run / 2)), scale(left, f.width / 2)), 'square', i, 'ew-resize'));
    const l = layout.runs!.landings[i];
    if (!l) return;
    out.push(H(st, 'stair-depth', add(end, scale(f.direction, l.depth)), 'square', i, 'ns-resize'));
    if (l.turn !== 'none' && l.angle === 180) {
      const s = l.turn === 'left' ? 1 : -1;
      out.push(H(st, 'stair-gap', add(end, scale(left, s * (f.width / 2 + l.gap))), 'diamond', i, 'ew-resize'));
    }
  });
  return out;
}

/** The stair after dragging one of its stretch handles to `target` (null when nothing changes). */
export function stretchStair(h: Handle, st: Stair, target: Vec2, levelHeight: number): Stair | null {
  const layout = computeStairLayout(st, levelHeight);
  const runs = editableRuns(st, levelHeight);
  const i = h.index ?? 0;
  const f = layout.flights?.[i];
  if (!runs || !f) return null;
  const left = perp(f.direction);
  const end = add(f.start, scale(f.direction, f.treadIndices.length * f.going));
  const r10 = (v: number) => Math.round(v / 10) * 10;
  const next: StairRuns = { flights: runs.flights.map((x) => ({ ...x })), landings: runs.landings.map((x) => ({ ...x })) };
  switch (h.kind) {
    case 'stair-end': {
      const steps = Math.max(i === 0 ? 1 : 0, Math.round(dot(sub(target, f.start), f.direction) / f.going));
      if (steps === next.flights[i].treads) return null;
      next.flights[i].treads = steps;
      break;
    }
    case 'stair-width': {
      const mid = add(f.start, scale(f.direction, (f.treadIndices.length * f.going) / 2));
      next.flights[i].width = Math.max(300, r10(2 * Math.abs(dot(sub(target, mid), left))));
      break;
    }
    case 'stair-depth': {
      if (!next.landings[i]) return null;
      next.landings[i].depth = Math.max(300, r10(dot(sub(target, end), f.direction)));
      break;
    }
    case 'stair-gap': {
      const l = layout.runs?.landings[i];
      if (!l || !next.landings[i]) return null;
      const s = l.turn === 'left' ? 1 : -1;
      next.landings[i].gap = Math.max(0, r10(s * dot(sub(target, end), left) - f.width / 2));
      break;
    }
    default:
      return null;
  }
  return { ...st, runs: next };
}

/** Live readout while stretching a stair. */
export function stairStretchLabel(h: Handle, st: Stair, levelHeight: number, fmt: (mm: number) => string): string {
  const l = computeStairLayout(st, levelHeight);
  const i = h.index ?? 0;
  const r = l.runs;
  switch (h.kind) {
    case 'stair-end':
      return `${r?.flights[i]?.treads ?? 0} steps · ${l.riserCount} risers × ${fmt(l.riserHeight)}`;
    case 'stair-width':
      return `Width ${fmt(r?.flights[i]?.width ?? st.width)}`;
    case 'stair-depth':
      return `Landing ${fmt(r?.landings[i]?.depth ?? 0)}`;
    case 'stair-gap':
      return `Well ${fmt(r?.landings[i]?.gap ?? 0)}`;
    default:
      return '';
  }
}

/**
 * Apply a handle drag. `base` is the element as it was when the drag started; `target` the
 * (snapped) pointer position. Returns the resulting patch.
 */
export function applyHandle(h: Handle, base: Element, target: Vec2, ctx: { elements: Record<string, Element>; freeAngle: boolean; levelHeight?: number }): Patch {
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
    case 'stair-end':
    case 'stair-width':
    case 'stair-depth':
    case 'stair-gap': {
      if (base.type !== 'stair') break;
      const st = stretchStair(h, base, target, ctx.levelHeight ?? 3000);
      if (st) set(st);
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
