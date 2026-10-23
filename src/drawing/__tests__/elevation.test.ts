import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createProject } from '../../core/defaults';
import { convexHull, defaultSectionCut, generateAxonometricDrawing, generateElevationDrawing, generateSectionDrawing, hullsOverlap, orderFaces } from '../elevation';
import type { Drawing } from '../types';

const sample = createSampleProject();

function layerBounds(d: Drawing, layer: string, tag?: string) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const e of d.entities) {
    if (e.layer !== layer || (tag && e.tag !== tag) || e.kind !== 'fill') continue;
    for (const p of e.outline) {
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  return b;
}

describe('elevations', () => {
  it('projects the model with correct extents for each side', () => {
    const south = generateElevationDrawing(sample, 'south');
    expect(south.entities.filter((e) => e.layer === 'A-ELEV' && e.tag === 'face').length).toBeGreaterThan(5);
    let b = layerBounds(south, 'A-ELEV', 'face');
    // Foundation from x = −125, porch column to x = 13 025; foundation bottom −300, block top +7 500.
    expect(b.minX).toBeCloseTo(-125, 0);
    expect(b.maxX).toBeCloseTo(13025, 0);
    expect(b.minY).toBeCloseTo(-300, 0);
    expect(b.maxY).toBeCloseTo(7500, 0);
    b = layerBounds(generateElevationDrawing(sample, 'north'), 'A-ELEV', 'face');
    expect(b.minX).toBeCloseTo(-13025, 0);
    expect(b.maxX).toBeCloseTo(125, 0);
    b = layerBounds(generateElevationDrawing(sample, 'east'), 'A-ELEV', 'face');
    expect(b.minX).toBeCloseTo(-1025, 0);
    expect(b.maxX).toBeCloseTo(8125, 0);
    b = layerBounds(generateElevationDrawing(sample, 'west'), 'A-ELEV', 'face');
    expect(b.minX).toBeCloseTo(-8125, 0);
    expect(b.maxX).toBeCloseTo(1025, 0);
  });

  it('adds ground line, level datums and a title', () => {
    const d = generateElevationDrawing(sample, 'south');
    expect(d.entities.some((e) => e.layer === 'A-ELEV-OTLN' && e.tag === 'ground-line')).toBe(true);
    const texts = d.entities.flatMap((e) => (e.kind === 'text' ? [e.text] : []));
    expect(texts).toContain('±0.000');
    expect(texts).toContain('+3.000');
    expect(texts).toContain('FIRST FLOOR');
    expect(texts).toContain('SOUTH ELEVATION');
    expect(d.title).toBe('South elevation');
    expect(Number.isFinite(d.bounds.minX + d.bounds.maxX)).toBe(true);
    const bare = generateElevationDrawing(sample, 'south', { includeTitle: false, includeLevels: false });
    expect(bare.entities.some((e) => e.kind === 'text')).toBe(false);
  });

  it('cuts sections with poché and drops geometry in front of the cut', () => {
    const cut = { a: { x: -2000, y: 5800 }, b: { x: 14000, y: 5800 }, name: 'B' };
    const s = generateSectionDrawing(sample, cut);
    const poche = s.entities.filter((e) => e.layer === 'A-SECT-PATT');
    // West, east and two interior walls on the ground floor, two walls + middle wall upstairs, slabs, roof…
    expect(poche.length).toBeGreaterThanOrEqual(8);
    expect(s.entities.filter((e) => e.layer === 'A-SECT-MCUT').length).toBeGreaterThanOrEqual(poche.length);
    expect(poche.some((e) => e.kind === 'fill' && e.hatch === 'brick')).toBe(true);
    expect(s.entities.some((e) => e.kind === 'text' && e.text === 'SECTION B-B')).toBe(true);
    // The porch column (y = −900) lies in front of the cut and must not appear.
    const colId = Object.values(sample.elements).find((e) => e.type === 'column')!.id;
    expect(s.entities.some((e) => e.elementId === colId)).toBe(false);
    expect(defaultSectionCut(sample).a.x).toBeLessThan(0);
  });

  it('renders an axonometric view and copes with empty projects', () => {
    expect(generateAxonometricDrawing(sample).entities.length).toBeGreaterThan(20);
    const empty = createProject();
    expect(() => generateElevationDrawing(empty, 'east')).not.toThrow();
    expect(() => generateSectionDrawing(empty, defaultSectionCut(empty))).not.toThrow();
  });
});

describe('visibility ordering', () => {
  const sq = (z: number, x0: number) => {
    const pts = [
      { x: x0, y: 0, z },
      { x: x0 + 10, y: 0, z },
      { x: x0 + 10, y: 10, z },
      { x: x0, y: 10, z },
    ];
    const hull = convexHull(pts.map((p) => ({ x: p.x, y: p.y })));
    return { pts, hull, n: { x: 0, y: 0, z: 1 }, d: z, box: { minX: x0, minY: 0, maxX: x0 + 10, maxY: 10 } };
  };

  it('puts faces behind another face first even when centroid depth says otherwise', () => {
    // Viewer looks down −z: higher z is nearer. Depths are deliberately wrong.
    const far = { ...sq(0, 0), depth: -100, id: 'far' };
    const near = { ...sq(5, 2), depth: 100, id: 'near' };
    expect(orderFaces([near, far]).map((f) => f.id)).toEqual(['far', 'near']);
  });

  it('detects convex overlap', () => {
    const a = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]);
    const b = convexHull([{ x: 6, y: 6 }, { x: 16, y: 6 }, { x: 6, y: 16 }]);
    const c = convexHull([{ x: 4, y: 4 }, { x: 14, y: 4 }, { x: 4, y: 14 }]);
    expect(hullsOverlap(a, b)).toBe(false);
    expect(hullsOverlap(a, c)).toBe(true);
  });
});
