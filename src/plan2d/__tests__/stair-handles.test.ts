import { describe, expect, it } from 'vitest';
import { createElement } from '../../core/defaults';
import { add, scale } from '../../core/math2d';
import { computeStairLayout } from '../../core/stairs';
import type { Stair } from '../../core/types';
import { applyHandle, handlesFor, stairStretchLabel, stretchStair } from '../handles';

const H = 3000;
const ctx = { elements: {}, px: (n: number) => n, levelHeight: H };
const stair = (props: Partial<Stair>): Stair => createElement('stair', 'lvl', { position: { x: 0, y: 0 }, rotation: 0, width: 1000, tread: 280, ...props });
const kinds = (s: Stair) => handlesFor(s, ctx).map((h) => `${h.kind}:${h.index ?? 0}`);

describe('stair stretch handles', () => {
  it('offers end and width handles per flight, depth per landing and gap per U-turn', () => {
    expect(kinds(stair({ shape: 'l-shape' }))).toEqual(expect.arrayContaining(['stair-end:0', 'stair-end:1', 'stair-width:0', 'stair-width:1', 'stair-depth:0', 'rotate:0']));
    expect(kinds(stair({ shape: 'u-shape' }))).toContain('stair-gap:0');
    expect(kinds(stair({ shape: 'spiral' })).every((k) => !k.startsWith('stair-'))).toBe(true);
  });

  it('dragging a flight end adds or removes whole steps; the riser height follows', () => {
    const s = stair({ shape: 'l-shape' });
    const end0 = handlesFor(s, ctx).find((h) => h.kind === 'stair-end' && h.index === 0)!;
    const longer = stretchStair(end0, s, add(end0.p, { x: 2 * 280 + 30, y: 0 }), H)!;
    const before = computeStairLayout(s, H);
    const after = computeStairLayout(longer, H);
    expect(after.runs!.flights[0].treads).toBe(before.runs!.flights[0].treads + 2);
    expect(after.riserCount).toBe(before.riserCount + 2);
    expect(stairStretchLabel(end0, longer, H, (v) => `${Math.round(v)}`)).toMatch(/steps · \d+ risers ×/);
    // Pulling it back before the start keeps at least one step in the first flight.
    expect(stretchStair(end0, s, { x: -5000, y: 0 }, H)!.runs!.flights[0].treads).toBe(1);
  });

  it('dragging a flight side sets that flight’s width only', () => {
    const s = stair({ shape: 'l-shape' });
    const w1 = handlesFor(s, ctx).find((h) => h.kind === 'stair-width' && h.index === 1)!;
    const f1 = computeStairLayout(s, H).flights![1];
    const left = { x: -f1.direction.y, y: f1.direction.x };
    const out = stretchStair(w1, s, add(w1.p, scale(left, 200)), H)!;
    expect(out.runs!.flights[1].width).toBe(1400);
    expect(out.runs!.flights[0].width).toBeUndefined();
  });

  it('dragging a landing edge sets its depth, and a U-turn well its gap', () => {
    const l = stair({ shape: 'l-shape' });
    const d = handlesFor(l, ctx).find((h) => h.kind === 'stair-depth')!;
    expect(stretchStair(d, l, add(d.p, { x: 400, y: 0 }), H)!.runs!.landings[0].depth).toBe(1400);
    const u = stair({ shape: 'u-shape', turn: 'left' });
    const g = handlesFor(u, ctx).find((h) => h.kind === 'stair-gap')!;
    expect(stretchStair(g, u, add(g.p, { x: 0, y: 250 }), H)!.runs!.landings[0].gap).toBe(350);
    // applyHandle routes through the same code with the editor's level height.
    const patch = applyHandle(g, u, add(g.p, { x: 0, y: 250 }), { elements: {}, freeAngle: false, levelHeight: H });
    expect((patch.get(u.id) as Stair).runs!.landings[0].gap).toBe(350);
  });
});
