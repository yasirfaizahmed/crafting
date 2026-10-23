import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement, createLevel, createProject } from '../../core/defaults';
import { dot, polygonArea, sub } from '../../core/math2d';
import { computeStairLayout } from '../../core/stairs';
import type { Door, Element, Opening, Project, Stair, Wall } from '../../core/types';
import { formatArea } from '../../core/units';
import { openingInterval, wallDirection, wallFaceOffsets, wallNormal } from '../../core/walls';
import { DrawingBuilder } from '../builder';
import { generatePlanDrawing } from '../plan';
import { exteriorChains } from '../plan/annotation';
import type { DimensionEntity, Drawing, DrawingEntity, TextEntity } from '../types';

const sample = createSampleProject();
const [ground, first] = sample.levels;
const g = generatePlanDrawing(sample, ground.id);
const f = generatePlanDrawing(sample, first.id);

const on = (d: Drawing, layer: string) => d.entities.filter((e) => e.layer === layer);
const onLevel = <T extends Element['type']>(p: Project, levelId: string, type: T) =>
  Object.values(p.elements).filter((e) => e.levelId === levelId && e.type === type) as Extract<Element, { type: T }>[];

/** All straight segments of an entity (polylines exploded). */
function segments(e: DrawingEntity): [{ x: number; y: number }, { x: number; y: number }][] {
  if (e.kind === 'line') return [[e.a, e.b]];
  if (e.kind === 'polyline') {
    const out: [{ x: number; y: number }, { x: number; y: number }][] = [];
    for (let i = 0; i + 1 < e.points.length; i++) out.push([e.points[i], e.points[i + 1]]);
    if (e.closed) out.push([e.points[e.points.length - 1], e.points[0]]);
    return out;
  }
  return [];
}

describe('generatePlanDrawing — sample house', () => {
  it('uses the AIA layers with entities on every expected layer', () => {
    for (const layer of ['A-WALL', 'A-WALL-PATT', 'A-DOOR', 'A-GLAZ', 'A-FLOR', 'A-FLOR-STRS', 'S-COLS', 'I-FURN', 'A-AREA-IDEN', 'A-ANNO-DIMS', 'A-ANNO-TEXT', 'A-ANNO-SYMB'])
      expect(on(g, layer).length, layer).toBeGreaterThan(0);
    expect(on(f, 'A-ROOF').length).toBeGreaterThan(0);
    expect(on(f, 'A-GENM').length).toBeGreaterThan(0);
    const names = new Set(g.layers.map((l) => l.name));
    for (const e of [...g.entities, ...f.entities]) expect(names.has(e.layer), e.layer).toBe(true);
    expect(g.scale).toBe(100);
    expect(g.title).toContain('Ground Floor');
  });

  it('draws one swing arc per swinging door leaf', () => {
    for (const [d, level] of [
      [g, ground],
      [f, first],
    ] as const) {
      const doors = onLevel(sample, level.id, 'door');
      const expected = doors.reduce((n, door) => n + (door.style === 'single' ? 1 : door.style === 'double' ? 2 : 0), 0);
      const arcs = on(d, 'A-DOOR').filter((e) => e.kind === 'arc');
      expect(arcs).toHaveLength(expected);
      for (const door of doors.filter((x) => x.style === 'single'))
        expect(arcs.filter((a) => a.elementId === door.id)).toHaveLength(1);
    }
  });

  it('draws a window symbol (frame + glass) for every window', () => {
    for (const w of onLevel(sample, ground.id, 'window')) {
      const ents = on(g, 'A-GLAZ').filter((e) => e.elementId === w.id);
      expect(ents.some((e) => e.tag === 'frame')).toBe(true);
      expect(ents.some((e) => e.tag === 'glass')).toBe(true);
    }
    // The high awning window (sill 1500 > cut 1200) is drawn hidden over a solid wall.
    const awning = onLevel(sample, ground.id, 'window').find((w) => w.style === 'awning')!;
    expect(on(g, 'A-GLAZ').filter((e) => e.elementId === awning.id && e.tag === 'frame').every((e) => e.linetype === 'hidden')).toBe(true);
  });

  it('draws as many treads as computeStairLayout, with a break line and UP label', () => {
    const stair = onLevel(sample, ground.id, 'stair')[0];
    const layout = computeStairLayout(stair, ground.height);
    const tags = new Set(on(g, 'A-FLOR-STRS').filter((e) => e.elementId === stair.id && e.tag?.startsWith('tread-')).map((e) => e.tag));
    expect(tags.size).toBe(layout.treads.length);
    expect(on(g, 'A-FLOR-STRS').some((e) => e.tag === 'break')).toBe(true);
    // Treads above the cut plane are hidden.
    expect(on(g, 'A-FLOR-STRS').some((e) => e.tag?.startsWith('tread-') && e.linetype === 'hidden')).toBe(true);
    expect(on(g, 'A-ANNO-TEXT').some((e) => e.kind === 'text' && e.text === 'UP')).toBe(true);
    // The upper floor shows the stair arriving from below.
    expect(on(f, 'A-ANNO-TEXT').some((e) => e.kind === 'text' && e.text === 'DN')).toBe(true);
    expect(new Set(on(f, 'A-FLOR-STRS').filter((e) => e.tag?.startsWith('tread-')).map((e) => e.tag)).size).toBe(layout.treads.length);
  });

  it('tags rooms with name, number and the correct area', () => {
    for (const r of onLevel(sample, ground.id, 'room')) {
      const texts = on(g, 'A-AREA-IDEN').filter((e): e is TextEntity => e.kind === 'text' && e.elementId === r.id);
      expect(texts.find((t) => t.tag === 'room-area')?.text).toBe(formatArea(polygonArea(r.outline)));
      expect(texts.find((t) => t.tag === 'room-name')?.text).toBe(r.name.toUpperCase());
      expect(texts.find((t) => t.tag === 'room-number')?.text).toBe(r.number);
    }
  });

  it('builds exterior dimension chains on all four sides that sum to the overall length', () => {
    const dims = on(g, 'A-ANNO-DIMS').filter((e): e is DimensionEntity => e.kind === 'dimension' && !!e.tag?.startsWith('chain-'));
    const chains = new Map<string, DimensionEntity[]>();
    for (const d of dims) chains.set(d.tag!, [...(chains.get(d.tag!) ?? []), d]);
    for (const side of ['south', 'north', 'east', 'west']) {
      const overall = chains.get(`chain-${side}-overall`);
      expect(overall, side).toHaveLength(1);
      const len = (d: DimensionEntity) => Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      const total = len(overall![0]);
      expect(total).toBeCloseTo(side === 'south' || side === 'north' ? 12250 : 8250, 6);
      for (const [tag, list] of chains) if (tag.startsWith(`chain-${side}-`)) expect(list.reduce((s, d) => s + len(d), 0), tag).toBeCloseTo(total, 6);
    }
    // South openings chain: corner, door jambs, window jambs, corner.
    const south = exteriorChains({ ...ctxFor(sample, ground.id) }).find((c) => c.side === 'south' && c.kind === 'openings')!;
    expect(south.positions).toEqual([-125, 2000, 3000, 7300, 9700, 12125]);
  });

  it('leaves gaps in cut walls at openings (no A-WALL line crosses an opening)', () => {
    const walls = on(g, 'A-WALL');
    for (const op of onLevel(sample, ground.id, 'door').concat(onLevel(sample, ground.id, 'window') as unknown as Door[]) as Opening[]) {
      const host = sample.elements[op.hostId] as Wall;
      if (op.sill > 1200 || op.sill + op.height < 1200) continue;
      const [a, b] = openingInterval(op);
      const dir = wallDirection(host);
      const n = wallNormal(host);
      const faces = wallFaceOffsets(host);
      const inside = (p: { x: number; y: number }) => {
        const s = dot(sub(p, host.start), dir);
        const l = dot(sub(p, host.start), n);
        return s > a + 1 && s < b - 1 && l > faces.right + 1 && l < faces.left - 1;
      };
      for (const e of walls)
        for (const [p, q] of segments(e))
          for (let t = 0; t <= 1; t += 0.05) expect(inside({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }), `${op.id} ${JSON.stringify([p, q, a, b, host.start, host.end])}`).toBe(false);
    }
  });

  it('hatches cut walls by material and fills columns', () => {
    const poche = on(g, 'A-WALL-PATT').filter((e) => e.kind === 'fill');
    expect(poche.some((e) => e.kind === 'fill' && e.hatch === 'brick')).toBe(true);
    expect(poche.some((e) => e.kind === 'fill' && !e.hatch)).toBe(true);
    expect(on(g, 'S-COLS').some((e) => e.kind === 'fill' && e.fill === '#000000')).toBe(true);
  });

  it('has finite bounds that contain every entity point', () => {
    for (const d of [g, f]) {
      expect(Number.isFinite(d.bounds.minX + d.bounds.maxX + d.bounds.minY + d.bounds.maxY)).toBe(true);
      for (const e of d.entities)
        for (const [p] of segments(e)) {
          expect(p.x).toBeGreaterThanOrEqual(d.bounds.minX - 1e-6);
          expect(p.y).toBeLessThanOrEqual(d.bounds.maxY + 1e-6);
        }
    }
  });

  it('honours the options', () => {
    const bare = generatePlanDrawing(sample, ground.id, { includeFurniture: false, includeDimensions: false, includeRoomTags: false, includeTitle: false, includeNorthArrow: false });
    expect(on(bare, 'I-FURN')).toHaveLength(0);
    expect(on(bare, 'A-ANNO-DIMS')).toHaveLength(0);
    expect(on(bare, 'A-AREA-IDEN')).toHaveLength(0);
    expect(on(bare, 'A-ANNO-SYMB')).toHaveLength(0);
    const below = generatePlanDrawing(sample, first.id, { includeLevelBelow: true });
    expect(on(below, 'A-ANNO-REFR').length).toBeGreaterThan(0);
    const s50 = generatePlanDrawing(sample, ground.id, { scale: 50 });
    expect(s50.scale).toBe(50);
    // Annotation shrinks in model space at a larger scale.
    expect(s50.bounds.maxX - s50.bounds.minX).toBeLessThan(g.bounds.maxX - g.bounds.minX);
    const noAuto = generatePlanDrawing(sample, ground.id, { autoDimensions: false });
    expect(on(noAuto, 'A-ANNO-DIMS').filter((e) => e.tag?.startsWith('chain-'))).toHaveLength(0);
  });
});

function ctxFor(p: Project, levelId: string) {
  // Minimal context for the pure chain computation.
  const d = generatePlanDrawing(p, levelId);
  void d;
  return {
    project: p,
    level: p.levels.find((l) => l.id === levelId)!,
    b: new DrawingBuilder(100),
    scale: 100,
    cut: 1200,
    elements: Object.values(p.elements).filter((e) => e.levelId === levelId),
    footprints: new Map(),
    outer: [
      [
        { x: -125, y: -125 },
        { x: 12125, y: -125 },
        { x: 12125, y: 8125 },
        { x: -125, y: 8125 },
      ],
    ],
  };
}

describe('generatePlanDrawing — robustness', () => {
  it('handles an empty level and an unknown level id', () => {
    const p = createProject();
    const d = generatePlanDrawing(p, p.levels[0].id);
    expect(d.entities.filter((e) => e.layer !== 'A-ANNO-SYMB')).toHaveLength(0);
    expect(() => generatePlanDrawing(p, 'nope')).not.toThrow();
  });

  it('draws every door style, stair shape and element type without errors', () => {
    const p = createProject();
    const L = p.levels[0];
    p.levels.push(createLevel({ name: 'Upper', elevation: 3000 }));
    const pts = [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 8000 },
      { x: 0, y: 8000 },
    ];
    const walls = pts.map((pt, i) => createElement('wall', L.id, { start: pt, end: pts[(i + 1) % 4], thickness: 300, materialId: ['concrete', 'insulation', 'wood-oak', 'stone-granite'][i] }));
    const add = (e: Element) => (p.elements[e.id] = e);
    walls.forEach(add);
    add(createElement('wall', L.id, { start: { x: 2000, y: 3000 }, end: { x: 6000, y: 3000 }, thickness: 60, materialId: 'glass-clear' }));
    add(createElement('wall', L.id, { start: { x: 2000, y: 5000 }, end: { x: 6000, y: 5000 }, thickness: 200, height: 900 }));
    const styles = ['single', 'double', 'sliding', 'pocket', 'garage', 'opening'] as const;
    styles.forEach((style, i) => add(createElement('door', L.id, { hostId: walls[0].id, offset: 800 + i * 1500, width: 1000, style, flip: i % 2 === 1, hinge: i % 2 ? 'left' : 'right' })));
    (['casement', 'sliding', 'fixed', 'awning', 'double-hung'] as const).forEach((style, i) =>
      add(createElement('window', L.id, { hostId: walls[2].id, offset: 1000 + i * 1800, width: 1200, style })),
    );
    (['straight', 'l-shape', 'u-shape', 'spiral', 'open-well'] as const).forEach((shape, i) =>
      add(createElement('stair', L.id, { position: { x: 1500 + i * 2200, y: 1500 }, rotation: 90, shape, width: 900 }) as Stair),
    );
    add(createElement('column', L.id, { position: { x: 5000, y: 6000 }, shape: 'round' }));
    add(createElement('column', L.id, { position: { x: 8000, y: 6000 }, materialId: 'timber-frame' }));
    add(createElement('beam', L.id, { start: { x: 5000, y: 6000 }, end: { x: 8000, y: 6000 } }));
    for (const shape of ['flat', 'gable', 'hip', 'shed', 'pyramid'] as const) add(createElement('roof', L.id, { outline: pts, shape }));
    add(createElement('block', L.id, { position: { x: 7000, y: 7000, z: 0 }, size: { x: 500, y: 500, z: 2000 }, shape: 'cylinder' }));
    add(createElement('railing', L.id, { path: [{ x: 100, y: 100 }, { x: 900, y: 100 }] }));
    for (const id of ['sofa-3', 'bed-king', 'toilet', 'washbasin', 'bathtub', 'shower', 'stove', 'fridge', 'tree', 'car', 'ceiling-light', 'wardrobe', 'rug', 'plant-pot', 'armchair', 'dining-table-round', 'kitchen-sink', 'desk'])
      add(createElement('furniture', L.id, { catalogId: id, position: { x: 5000, y: 4000 }, rotation: 30, mirrored: true }));
    add(createElement('slab', L.id, { outline: pts, holes: [[{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }]] }));
    const d = generatePlanDrawing(p, L.id, { includeGrid: true });
    expect(d.entities.length).toBeGreaterThan(100);
    expect(on(d, 'S-GRID').length).toBeGreaterThan(0);
    expect(on(d, 'A-DOOR').filter((e) => e.kind === 'arc')).toHaveLength(3);
    for (const e of d.entities)
      for (const [a, b] of segments(e)) expect(Number.isFinite(a.x + a.y + b.x + b.y)).toBe(true);
    expect(() => generatePlanDrawing(p, p.levels[1].id, { includeLevelBelow: true })).not.toThrow();
  });
});
