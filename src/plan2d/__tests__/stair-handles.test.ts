import { describe, expect, it } from 'vitest';
import { createElement } from '../../core/defaults';
import { add, scale } from '../../core/math2d';
import { computeStairLayout, landingFrame } from '../../core/stairs';
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

  it('offers a handle on every landing edge, and a slide handle on quarter landings', () => {
    const k = kinds(stair({ shape: 'open-well' }));
    for (const i of [0, 1]) expect(k).toEqual(expect.arrayContaining([`stair-depth:${i}`, `stair-left:${i}`, `stair-right:${i}`, `stair-beyond:${i}`]));
    const u = kinds(stair({ shape: 'u-shape' }));
    expect(u).toEqual(expect.arrayContaining(['stair-left:0', 'stair-right:0', 'stair-gap:0']));
    expect(u).not.toContain('stair-beyond:0');
  });

  it('stretches a landing outwards on its free side without moving any flight', () => {
    // Open well turning left: up +x, across +y, back down −x. The outer side of landing 0 is its right (−y).
    const s = stair({ shape: 'open-well', turn: 'left' });
    const hr = handlesFor(s, ctx).find((h) => h.kind === 'stair-right' && h.index === 0)!;
    const out = stretchStair(hr, s, add(hr.p, { x: 0, y: -350 }), H)!;
    expect(out.runs!.landings[0].extendRight).toBe(350);
    const before = computeStairLayout(s, H);
    const after = computeStairLayout(out, H);
    expect(after.flights!.map((f) => f.start)).toEqual(before.flights!.map((f) => f.start));
    const minY = (poly: { y: number }[]) => Math.min(...poly.map((p) => p.y));
    expect(minY(after.landings[0].polygon)).toBeCloseTo(minY(before.landings[0].polygon) - 350, 6);
    expect(stairStretchLabel(hr, out, H, (v) => `${Math.round(v)}`)).toBe('Landing 1000 × 1350 · +350 right');
    // Dragging back inside the flight clamps to flush.
    expect(stretchStair(hr, out, add(hr.p, { x: 0, y: 600 }), H)!.runs!.landings[0].extendRight).toBe(0);
  });

  it('stretching the side the next flight leaves from moves that flight (and the rest) out', () => {
    const s = stair({ shape: 'open-well', turn: 'left' });
    const hl = handlesFor(s, ctx).find((h) => h.kind === 'stair-left' && h.index === 0)!;
    const out = stretchStair(hl, s, add(hl.p, { x: 0, y: 400 }), H)!;
    expect(out.runs!.landings[0].extendLeft).toBe(400);
    const b = computeStairLayout(s, H).flights!;
    const a = computeStairLayout(out, H).flights!;
    expect(a[0].start).toEqual(b[0].start);
    expect(a[1].start.y).toBeCloseTo(b[1].start.y + 400, 6);
    expect(a[2].start.y).toBeCloseTo(b[2].start.y + 400, 6);
  });

  it('the slide handle moves a quarter landing’s next flight along the edge; the platform keeps its size', () => {
    const s = stair({ shape: 'l-shape', turn: 'left' });
    const d = handlesFor(s, ctx).find((h) => h.kind === 'stair-depth')!;
    const deep = stretchStair(d, s, add(d.p, { x: 500, y: 0 }), H)!; // the far edge drags the next flight along
    expect(deep.runs!.landings[0].depth).toBe(1500);
    const slide = handlesFor(deep, ctx).find((h) => h.kind === 'stair-beyond')!;
    const slid = stretchStair(slide, deep, add(slide.p, { x: -300, y: 0 }), H)!;
    expect(slid.runs!.landings[0].beyond).toBe(300);
    const l0 = computeStairLayout(deep, H);
    const l1 = computeStairLayout(slid, H);
    expect(l1.landings[0].polygon).toEqual(l0.landings[0].polygon);
    expect(l1.flights![1].start.x).toBeCloseTo(l0.flights![1].start.x - 300, 6);
    expect(stairStretchLabel(slide, slid, H, (v) => `${Math.round(v)}`)).toBe('Past next flight 300');
    // Never slides back past the arriving flight.
    expect(stretchStair(slide, deep, add(slide.p, { x: -5000, y: 0 }), H)!.runs!.landings[0].beyond).toBe(500);
  });

  it('places every landing handle on its edge', () => {
    const s = stair({ shape: 'u-shape', turn: 'right', runs: undefined });
    const l = computeStairLayout(s, H);
    const box = l.landings[0].polygon;
    const onEdge = (p: { x: number; y: number }) => {
      const xs = box.map((q) => q.x);
      const ys = box.map((q) => q.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const inside = p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6 && p.y >= y0 - 1e-6 && p.y <= y1 + 1e-6;
      return inside && [p.x - x0, x1 - p.x, p.y - y0, y1 - p.y].some((d) => Math.abs(d) < 1e-6);
    };
    for (const h of handlesFor(s, ctx).filter((h) => ['stair-depth', 'stair-left', 'stair-right'].includes(h.kind))) expect(onEdge(h.p)).toBe(true);
    expect(landingFrame(l.runs!.landings[0], 1000, 1000).depth).toBe(1000);
  });
});
