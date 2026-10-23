import { describe, expect, it } from 'vitest';
import { createElement } from '../../core/defaults';
import type { Block, Column, Furniture } from '../../core/types';
import { handlesFor, resizeElement, sizeLabel } from '../handles';
import { furnitureOutline } from '../shapes';

const ctx = { elements: {}, px: (n: number) => n, levelHeight: 3000 };

describe('edge resize handles', () => {
  it('furniture: dragging the +x edge widens it while the −x edge stays', () => {
    const sofa = createElement('furniture', 'l', { catalogId: 'sofa-3', position: { x: 1000, y: 1000 }, rotation: 0 }) as Furniture;
    expect(handlesFor(sofa, ctx).filter((h) => h.kind === 'size')).toHaveLength(4);
    const before = furnitureOutline(sofa);
    const wider = resizeElement(sofa, 0, { x: 1000 + 1100 + 300, y: 1000 }) as Furniture;
    expect(wider.width).toBe(2200 + 300);
    const after = furnitureOutline(wider);
    expect(Math.min(...after.map((p) => p.x))).toBeCloseTo(Math.min(...before.map((p) => p.x)), 6);
    expect(sizeLabel(wider, (v) => String(v))).toBe('2500 × 900');
  });

  it('works in the element’s own (rotated) frame and never collapses', () => {
    const bed = createElement('furniture', 'l', { catalogId: 'bed-double', position: { x: 0, y: 0 }, rotation: 90 }) as Furniture;
    // Local +y (depth) points to world −x when rotated 90°.
    const deeper = resizeElement(bed, 2, { x: -1025 - 200, y: 0 }) as Furniture;
    expect(deeper.depth).toBe(2050 + 200);
    expect((resizeElement(bed, 0, { x: 0, y: -5000 }) as Furniture).width).toBe(50);
  });

  it('columns: rectangular edges, a single diameter handle for round ones', () => {
    const col = createElement('column', 'l', { position: { x: 0, y: 0 }, width: 300, depth: 300 }) as Column;
    expect((resizeElement(col, 2, { x: 0, y: 250 }) as Column).depth).toBe(400);
    const round = createElement('column', 'l', { position: { x: 0, y: 0 }, width: 350, depth: 350, shape: 'round' }) as Column;
    expect(handlesFor(round, ctx).filter((h) => h.kind === 'size')).toHaveLength(1);
    const big = resizeElement(round, 0, { x: 400, y: 0 }) as Column;
    expect([big.width, big.depth]).toEqual([580, 580]);
  });

  it('blocks: the min corner moves when dragging a −x / −y edge', () => {
    const b = createElement('block', 'l', { position: { x: 0, y: 0, z: 0 }, size: { x: 500, y: 500, z: 500 } }) as Block;
    const out = resizeElement(b, 1, { x: -300, y: 250 }) as Block;
    expect(out.position).toEqual({ x: -300, y: 0, z: 0 });
    expect(out.size).toEqual({ x: 800, y: 500, z: 500 });
  });
});
