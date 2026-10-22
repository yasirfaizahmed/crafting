/**
 * Door (A-DOOR) and window (A-GLAZ) plan symbols, drawn in the gap the opening cuts in its host.
 * Openings entirely above the cut plane (high-level windows) are drawn hidden over the solid wall.
 */
import { add, angleDeg, scale, sub } from '../../core/math2d';
import type { Door, Opening, Vec2, Window } from '../../core/types';
import { PEN } from '../layers';
import { exteriorSide, openingFrame, openingIsCut, type OpeningFrame, type PlanContext } from './context';

const LEAF = 40;

export function drawOpenings(ctx: PlanContext): void {
  for (const op of ctx.elements) {
    if (op.type !== 'door' && op.type !== 'window') continue;
    const host = ctx.project.elements[op.hostId];
    if (!host || host.type !== 'wall' || host.levelId !== op.levelId || host.hidden) continue;
    const fr = openingFrame(host, op);
    const cut = openingIsCut(ctx, host, op);
    if (op.type === 'door') drawDoor(ctx, op, fr, cut);
    else drawWindow(ctx, op, fr, cut);
  }
}

/** Plan arc from `from` to `to` around `c`, emitted CCW whichever way the swing goes. */
function swingArc(ctx: PlanContext, c: Vec2, r: number, from: Vec2, to: Vec2, op: Opening): void {
  const a0 = angleDeg(sub(from, c));
  const a1 = angleDeg(sub(to, c));
  const sweep = (((a1 - a0) % 360) + 360) % 360;
  const [s, e] = sweep <= 180 ? [a0, a1] : [a1, a0];
  ctx.b.arc('A-DOOR', c, r, s, e, { lineweight: PEN.fine, elementId: op.id, tag: 'swing' });
}

/** Door leaf rectangle from hinge `h` along `dir` for `len`, `t` thick towards `toward`. */
function leaf(ctx: PlanContext, h: Vec2, dir: Vec2, len: number, toward: Vec2, op: Opening, t = LEAF): void {
  const tip = add(h, scale(dir, len));
  const off = scale(toward, t);
  ctx.b.polyline('A-DOOR', [h, tip, add(tip, off), add(h, off)], true, { elementId: op.id, tag: 'leaf' });
}

function rect(ctx: PlanContext, layer: string, fr: OpeningFrame, s0: number, s1: number, l0: number, l1: number, extra: Record<string, unknown>): void {
  ctx.b.polyline(layer, [fr.at(s0, l0), fr.at(s1, l0), fr.at(s1, l1), fr.at(s0, l1)], true, extra);
}

export function drawDoor(ctx: PlanContext, d: Door, fr: OpeningFrame, cut: boolean): void {
  const { b } = ctx;
  const side = d.flip ? -1 : 1;
  const face = side > 0 ? fr.left : fr.right;
  const swing = scale(fr.normal, side);
  const hingeAtB = d.hinge === 'left';
  const W = d.width;
  const hidden = cut ? {} : { linetype: 'hidden' as const };
  const id = { elementId: d.id };
  switch (d.style) {
    case 'double': {
      const ha = fr.at(fr.a, face);
      const hb = fr.at(fr.b, face);
      const mid = fr.at((fr.a + fr.b) / 2, face);
      leaf(ctx, ha, swing, W / 2, fr.dir, d);
      leaf(ctx, hb, swing, W / 2, scale(fr.dir, -1), d);
      swingArc(ctx, ha, W / 2, add(ha, scale(swing, W / 2)), mid, d);
      swingArc(ctx, hb, W / 2, add(hb, scale(swing, W / 2)), mid, d);
      break;
    }
    case 'sliding': {
      const m = (fr.left + fr.right) / 2;
      const t = fr.left - fr.right;
      const o = (fr.a + fr.b) / 2;
      const off = Math.min(t * 0.2, 45);
      rect(ctx, 'A-DOOR', fr, fr.a, o + 50, m + off - 18, m + off + 18, { ...id, ...hidden, tag: 'panel' });
      rect(ctx, 'A-DOOR', fr, o - 50, fr.b, m - off - 18, m - off + 18, { ...id, ...hidden, tag: 'panel' });
      // Glazing line inside each panel.
      b.line('A-GLAZ', fr.at(fr.a + 40, m + off), fr.at(o + 10, m + off), { ...id, lineweight: PEN.extraFine, tag: 'glass' });
      b.line('A-GLAZ', fr.at(o - 10, m - off), fr.at(fr.b - 40, m - off), { ...id, lineweight: PEN.extraFine, tag: 'glass' });
      break;
    }
    case 'pocket': {
      const m = (fr.left + fr.right) / 2;
      const into = hingeAtB ? 1 : -1;
      const s0 = hingeAtB ? fr.b : fr.a;
      rect(ctx, 'A-DOOR', fr, s0, s0 + into * W, m - 25, m + 25, { ...id, linetype: 'hidden', lineweight: PEN.fine, tag: 'pocket' });
      const open = W * 0.35 * into;
      rect(ctx, 'A-DOOR', fr, fr.a + open, fr.b + open, m - 18, m + 18, { ...id, ...hidden, tag: 'leaf' });
      break;
    }
    case 'garage': {
      const depth = Math.min(d.height, 2600);
      rect(ctx, 'A-DOOR', fr, fr.a, fr.b, face, face + side * 45, { ...id, ...hidden, tag: 'panel' });
      b.polyline('A-DOOR', [fr.at(fr.a, face), fr.at(fr.a, face + side * depth), fr.at(fr.b, face + side * depth), fr.at(fr.b, face)], false, {
        ...id,
        linetype: 'hidden',
        lineweight: PEN.fine,
        tag: 'overhead',
      });
      break;
    }
    case 'opening': {
      // Head above the cut plane: hidden lines along both faces.
      for (const lat of [fr.left, fr.right]) b.line('A-DOOR', fr.at(fr.a, lat), fr.at(fr.b, lat), { ...id, linetype: 'hidden', lineweight: PEN.fine, tag: 'head' });
      break;
    }
    default: {
      const h = fr.at(hingeAtB ? fr.b : fr.a, face);
      const free = fr.at(hingeAtB ? fr.a : fr.b, face);
      const toward = scale(fr.dir, hingeAtB ? -1 : 1);
      leaf(ctx, h, swing, W, toward, d);
      swingArc(ctx, h, W, add(h, scale(swing, W)), free, d);
    }
  }
}

export function drawWindow(ctx: PlanContext, w: Window, fr: OpeningFrame, cut: boolean): void {
  const { b } = ctx;
  const m = (fr.left + fr.right) / 2;
  const t = fr.left - fr.right;
  const fd = Math.min(t * 0.4, 90);
  const id = { elementId: w.id };
  const hidden = cut ? {} : { linetype: 'hidden' as const };
  const o = (fr.a + fr.b) / 2;
  if (cut) {
    // Reveal / sill board lines along both wall faces.
    for (const lat of [fr.left, fr.right]) b.line('A-GLAZ', fr.at(fr.a, lat), fr.at(fr.b, lat), { ...id, tag: 'reveal' });
  }
  if (w.style === 'sliding') {
    rect(ctx, 'A-GLAZ', fr, fr.a, o + 40, m, m + fd / 2, { ...id, ...hidden, tag: 'frame' });
    rect(ctx, 'A-GLAZ', fr, o - 40, fr.b, m - fd / 2, m, { ...id, ...hidden, tag: 'frame' });
    b.line('A-GLAZ', fr.at(fr.a + 30, m + fd / 4), fr.at(o + 10, m + fd / 4), { ...id, ...hidden, lineweight: PEN.extraFine, tag: 'glass' });
    b.line('A-GLAZ', fr.at(o - 10, m - fd / 4), fr.at(fr.b - 30, m - fd / 4), { ...id, ...hidden, lineweight: PEN.extraFine, tag: 'glass' });
  } else {
    rect(ctx, 'A-GLAZ', fr, fr.a, fr.b, m - fd / 2, m + fd / 2, { ...id, ...hidden, tag: 'frame' });
    b.line('A-GLAZ', fr.at(fr.a, m), fr.at(fr.b, m), { ...id, ...hidden, lineweight: PEN.extraFine, tag: 'glass' });
    if (w.style === 'casement' && w.width >= 1200) {
      b.line('A-GLAZ', fr.at(o, m - fd / 2), fr.at(o, m + fd / 2), { ...id, ...hidden, tag: 'mullion' });
    }
  }
  // Projecting external sill.
  const ext = exteriorSide(ctx, fr);
  if (ext !== 0 && cut) {
    const faceLat = ext > 0 ? fr.left : fr.right;
    const out = ext > 0 ? 1 : -1;
    b.polyline('A-GLAZ', [fr.at(fr.a - 30, faceLat), fr.at(fr.a - 30, faceLat + out * 40), fr.at(fr.b + 30, faceLat + out * 40), fr.at(fr.b + 30, faceLat)], false, {
      ...id,
      lineweight: PEN.fine,
      tag: 'sill',
    });
  }
}
