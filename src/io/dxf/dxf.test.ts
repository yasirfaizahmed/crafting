import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/defaults';
import { detectRooms } from '../../core/rooms';
import type { Project, Vec2, Wall } from '../../core/types';
import { importDXF, listDXFLayers } from '../index';
import { inspectDXF } from './index';
import { bulgePoints, collectSegments, parseDxf } from './reader';
import { linesToWalls } from './walls';

// --- tiny DXF writer for fixtures ------------------------------------------------------------

type Ent = string[];
const pair = (code: number, value: string | number) => `${code}\n${value}`;

function dxf(entities: Ent[], opts: { insunits?: number; measurement?: number; layers?: string[]; blocks?: string[] } = {}): string {
  const out: string[] = [];
  out.push(pair(0, 'SECTION'), pair(2, 'HEADER'), pair(9, '$ACADVER'), pair(1, 'AC1015'));
  if (opts.insunits !== undefined) out.push(pair(9, '$INSUNITS'), pair(70, opts.insunits));
  if (opts.measurement !== undefined) out.push(pair(9, '$MEASUREMENT'), pair(70, opts.measurement));
  out.push(pair(0, 'ENDSEC'));
  if (opts.layers) {
    out.push(pair(0, 'SECTION'), pair(2, 'TABLES'), pair(0, 'TABLE'), pair(2, 'LAYER'), pair(70, opts.layers.length));
    for (const l of opts.layers) out.push(pair(0, 'LAYER'), pair(2, l), pair(70, 0), pair(62, 7), pair(6, 'CONTINUOUS'));
    out.push(pair(0, 'ENDTAB'), pair(0, 'ENDSEC'));
  }
  if (opts.blocks) out.push(pair(0, 'SECTION'), pair(2, 'BLOCKS'), ...opts.blocks, pair(0, 'ENDSEC'));
  out.push(pair(0, 'SECTION'), pair(2, 'ENTITIES'), ...entities.flat(), pair(0, 'ENDSEC'), pair(0, 'EOF'));
  return out.join('\r\n') + '\r\n';
}

const line = (a: Vec2, b: Vec2, layer = 'A-WALL'): Ent => [pair(0, 'LINE'), pair(8, layer), pair(10, a.x), pair(20, a.y), pair(30, 0), pair(11, b.x), pair(21, b.y), pair(31, 0)];

const lwpoly = (pts: Vec2[], closed: boolean, layer = 'A-WALL', bulges: number[] = []): Ent => [
  pair(0, 'LWPOLYLINE'),
  pair(8, layer),
  pair(90, pts.length),
  pair(70, closed ? 1 : 0),
  ...pts.flatMap((p, i) => [pair(10, p.x), pair(20, p.y), ...(bulges[i] ? [pair(42, bulges[i])] : [])]),
];

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const rectLines = (r: Vec2[], layer?: string): Ent[] => r.map((p, i) => line(p, r[(i + 1) % r.length], layer));

const opts = (extra: Partial<Parameters<typeof importDXF>[1]> = {}) => ({ levelId: 'lvl', wallThickness: 200, detectDoubleLines: true, ...extra });

function walls(text: string, o = opts()): Wall[] {
  return importDXF(text, o) as Wall[];
}

function endpointsMeet(ws: Wall[], tol = 0.5): boolean {
  // Every wall end coincides with the end of another wall (closed ring).
  return ws.every((w) =>
    [w.start, w.end].every((p) => ws.some((o) => o !== w && [o.start, o.end].some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol))),
  );
}

function projectWith(ws: Wall[], levelId: string): Project {
  const p = createProject();
  p.levels[0].id = levelId;
  for (const w of ws) p.elements[w.id] = w;
  return p;
}

const near = (p: Vec2, x: number, y: number) => Math.hypot(p.x - x, p.y - y) < 0.5;

describe('DXF reader', () => {
  it('lists layers with linework counts from the table and entities', () => {
    const text = dxf([...rectLines(rect(0, 0, 1000, 1000), 'A-WALL'), line({ x: 0, y: 0 }, { x: 5, y: 5 }, 'A-DOOR'), lwpoly(rect(0, 0, 10, 10), true, 'A-WALL')], {
      layers: ['0', 'A-WALL', 'A-DOOR', 'A-ANNO-TEXT'],
    });
    const layers = listDXFLayers(text);
    expect(layers[0]).toEqual({ name: 'A-WALL', entityCount: 5 });
    expect(layers.find((l) => l.name === 'A-DOOR')?.entityCount).toBe(1);
    expect(layers.find((l) => l.name === 'A-ANNO-TEXT')?.entityCount).toBe(0);
    expect(layers.map((l) => l.name).sort()).toEqual(['0', 'A-ANNO-TEXT', 'A-DOOR', 'A-WALL']);
  });

  it('returns no layers for garbage input', () => {
    expect(listDXFLayers('')).toEqual([]);
    expect(listDXFLayers('hello\nworld\n')).toEqual([]);
    expect(importDXF('not a dxf', opts())).toEqual([]);
  });

  it('approximates bulges and arcs by chords on the circle', () => {
    // Semicircle (bulge 1) from (0,0) to (2000,0), counter-clockwise → below the chord.
    const pts = bulgePoints({ x: 0, y: 0 }, { x: 2000, y: 0 }, 1);
    expect(pts.length).toBe(18);
    for (const p of pts) expect(Math.hypot(p.x - 1000, p.y)).toBeCloseTo(1000, 6);
    expect(Math.min(...pts.map((p) => p.y))).toBeCloseTo(-1000, 0);
    const arc = dxf([[pair(0, 'ARC'), pair(8, 'W'), pair(10, 0), pair(20, 0), pair(40, 5000), pair(50, 0), pair(51, 90)]]);
    const segs = collectSegments(parseDxf(arc));
    expect(segs).toHaveLength(9);
    expect(near(segs[0].a, 5000, 0)).toBe(true);
    expect(near(segs[8].b, 0, 5000)).toBe(true);
  });

  it('reads POLYLINE/VERTEX sequences and expands INSERTs with transforms', () => {
    const poly: Ent = [
      pair(0, 'POLYLINE'),
      pair(8, 'P'),
      pair(66, 1),
      pair(70, 1),
      ...rect(0, 0, 3000, 2000).flatMap((p) => [pair(0, 'VERTEX'), pair(8, 'P'), pair(10, p.x), pair(20, p.y)]),
      pair(0, 'SEQEND'),
    ];
    const block = [pair(0, 'BLOCK'), pair(8, '0'), pair(2, 'WALLSEG'), pair(70, 0), pair(10, 0), pair(20, 0), ...line({ x: 0, y: 0 }, { x: 1000, y: 0 }, '0'), pair(0, 'ENDBLK')];
    const insert: Ent = [pair(0, 'INSERT'), pair(8, 'B'), pair(2, 'WALLSEG'), pair(10, 100), pair(20, 200), pair(41, 2), pair(42, 2), pair(50, 90)];
    const doc = parseDxf(dxf([poly, insert], { blocks: block }));
    const segs = collectSegments(doc);
    expect(segs.filter((s) => s.layer === 'P')).toHaveLength(4);
    const ins = segs.find((s) => s.layer === 'B')!;
    expect(near(ins.a, 100, 200)).toBe(true);
    expect(near(ins.b, 100, 2200)).toBe(true);
    // Layer filter applies to the inherited layer.
    expect(collectSegments(doc, (l) => l === 'B')).toHaveLength(1);
  });

  it('detects units from $INSUNITS, $MEASUREMENT or the drawing size', () => {
    expect(inspectDXF(dxf([line({ x: 0, y: 0 }, { x: 1, y: 0 })], { insunits: 6 })).units).toMatchObject({ unitScale: 1000, source: 'header' });
    expect(inspectDXF(dxf([line({ x: 0, y: 0 }, { x: 1, y: 0 })], { insunits: 1 })).units.unitScale).toBe(25.4);
    expect(inspectDXF(dxf([line({ x: 0, y: 0 }, { x: 1, y: 0 })], { insunits: 0, measurement: 0 })).units).toMatchObject({ unitScale: 25.4, source: 'measurement' });
    expect(inspectDXF(dxf([line({ x: 0, y: 0 }, { x: 12, y: 0 })])).units).toMatchObject({ unitScale: 1000, source: 'guess' });
    expect(inspectDXF(dxf([line({ x: 0, y: 0 }, { x: 12000, y: 0 })])).units).toMatchObject({ unitScale: 1, source: 'guess' });
  });
});

describe('DXF → walls', () => {
  const outer = rect(0, 0, 12000, 8000);
  const inner = rect(250, 250, 11750, 7750);

  it('turns a rectangle of double lines into 4 joined walls of the right thickness', () => {
    const ws = walls(dxf([...rectLines(outer), ...rectLines(inner)], { insunits: 4 }));
    expect(ws).toHaveLength(4);
    for (const w of ws) {
      expect(w.type).toBe('wall');
      expect(w.levelId).toBe('lvl');
      expect(w.thickness).toBeCloseTo(250, 6);
      expect(w.props?.source).toBe('DXF');
    }
    expect(endpointsMeet(ws)).toBe(true);
    const corners = ws.flatMap((w) => [w.start, w.end]);
    for (const [x, y] of [
      [125, 125],
      [11875, 125],
      [11875, 7875],
      [125, 7875],
    ])
      expect(corners.some((p) => near(p, x, y))).toBe(true);
    // The walls enclose one room whose clear outline is the inner rectangle.
    const rooms = detectRooms(projectWith(ws, 'lvl'), 'lvl');
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(11500 * 7500, -2);
  });

  it('handles closed LWPOLYLINE rectangles (single and double)', () => {
    const single = walls(dxf([lwpoly(outer, true)], { insunits: 4 }), opts({ detectDoubleLines: false, wallThickness: 150 }));
    expect(single).toHaveLength(4);
    for (const w of single) expect(w.thickness).toBe(150);
    expect(endpointsMeet(single)).toBe(true);
    const double = walls(dxf([lwpoly(outer, true), lwpoly(inner, true)], { insunits: 4 }));
    expect(double).toHaveLength(4);
    for (const w of double) expect(w.thickness).toBeCloseTo(250, 6);
    expect(endpointsMeet(double)).toBe(true);
  });

  it('scales mixed units: metres, centimetres and an explicit override', () => {
    const m = (r: Vec2[]) => r.map((p) => ({ x: p.x / 1000, y: p.y / 1000 }));
    const inM = walls(dxf([...rectLines(m(outer)), ...rectLines(m(inner))], { insunits: 6 }));
    expect(inM).toHaveLength(4);
    for (const w of inM) expect(w.thickness).toBeCloseTo(250, 3);
    expect(Math.max(...inM.flatMap((w) => [w.start.x, w.end.x]))).toBeCloseTo(11875, 1);
    const cm = (r: Vec2[]) => r.map((p) => ({ x: p.x / 10, y: p.y / 10 }));
    const inCm = walls(dxf([...rectLines(cm(outer)), ...rectLines(cm(inner))], { insunits: 5 }));
    expect(inCm).toHaveLength(4);
    for (const w of inCm) expect(w.thickness).toBeCloseTo(250, 3);
    // unitScale overrides the header (header says metres, data is really mm).
    const forced = walls(dxf([...rectLines(outer), ...rectLines(inner)], { insunits: 6 }), opts({ unitScale: 1 }));
    expect(forced.every((w) => Math.abs(w.thickness - 250) < 1e-6)).toBe(true);
    // Inches.
    const inch = (r: Vec2[]) => r.map((p) => ({ x: p.x / 25.4, y: p.y / 25.4 }));
    const inIn = walls(dxf([...rectLines(inch(outer)), ...rectLines(inch(inner))], { insunits: 1 }));
    for (const w of inIn) expect(w.thickness).toBeCloseTo(250, 3);
  });

  it('keeps a wall continuous through T junctions and joins interior walls to it', () => {
    // Exterior 250 double-line rectangle with an interior 120 wall at x = 5000…5120.
    const ents: Ent[] = [
      ...rectLines(outer),
      line({ x: 250, y: 250 }, { x: 5000, y: 250 }),
      line({ x: 5120, y: 250 }, { x: 11750, y: 250 }),
      line({ x: 11750, y: 250 }, { x: 11750, y: 7750 }),
      line({ x: 11750, y: 7750 }, { x: 5120, y: 7750 }),
      line({ x: 5000, y: 7750 }, { x: 250, y: 7750 }),
      line({ x: 250, y: 7750 }, { x: 250, y: 250 }),
      line({ x: 5000, y: 250 }, { x: 5000, y: 7750 }),
      line({ x: 5120, y: 250 }, { x: 5120, y: 7750 }),
    ];
    const ws = walls(dxf(ents, { insunits: 4 }));
    expect(ws).toHaveLength(5);
    const interior = ws.find((w) => Math.abs(w.thickness - 120) < 1e-6)!;
    expect(interior).toBeDefined();
    expect(Math.min(interior.start.y, interior.end.y)).toBeCloseTo(125, 3);
    expect(Math.max(interior.start.y, interior.end.y)).toBeCloseTo(7875, 3);
    expect(interior.start.x).toBeCloseTo(5060, 3);
    const south = ws.find((w) => Math.abs(w.start.y - 125) < 1 && Math.abs(w.end.y - 125) < 1)!;
    expect(Math.abs(south.end.x - south.start.x)).toBeCloseTo(11750, 3);
    const rooms = detectRooms(projectWith(ws, 'lvl'), 'lvl');
    expect(rooms).toHaveLength(2);
  });

  it('welds sloppy endpoints, merges collinear segments and drops short lines', () => {
    const ents: Ent[] = [
      line({ x: 0, y: 0 }, { x: 3000, y: 0 }),
      line({ x: 3000, y: 0 }, { x: 6000, y: 0 }), // collinear continuation → one wall
      line({ x: 2000, y: 0 }, { x: 4000, y: 0 }), // overlapping duplicate
      line({ x: 6012, y: 9 }, { x: 6000, y: 4000 }), // 15 mm gap at the corner → welded
      line({ x: 100, y: 3000 }, { x: 130, y: 3000 }), // too short
    ];
    const ws = walls(dxf(ents, { insunits: 4 }), opts({ detectDoubleLines: false, minLength: 100 }));
    expect(ws).toHaveLength(2);
    const long = ws.find((w) => Math.abs(w.end.y - w.start.y) < 20)!;
    expect(Math.hypot(long.end.x - long.start.x, long.end.y - long.start.y)).toBeCloseTo(6006, -1);
    expect(endpointsMeet(ws, 1)).toBe(false); // free ends at (0,0) and (6000,4000)
    const corner = ws.flatMap((w) => [w.start, w.end]).filter((p) => p.x > 5900 && p.y < 100);
    expect(corner).toHaveLength(2);
    expect(Math.hypot(corner[0].x - corner[1].x, corner[0].y - corner[1].y)).toBeLessThan(0.5);
  });

  it('pairs lines only within 50–600 mm and leaves door gaps open', () => {
    const ents: Ent[] = [
      // 200 mm wall with a 900 mm door gap in both faces.
      line({ x: 0, y: 0 }, { x: 3000, y: 0 }),
      line({ x: 0, y: 200 }, { x: 3000, y: 200 }),
      line({ x: 3900, y: 0 }, { x: 7000, y: 0 }),
      line({ x: 3900, y: 200 }, { x: 7000, y: 200 }),
      // Jamb caps at the door.
      line({ x: 3000, y: 0 }, { x: 3000, y: 200 }),
      line({ x: 3900, y: 0 }, { x: 3900, y: 200 }),
      // Two lines 1000 mm apart are not a wall: they stay single walls.
      line({ x: 0, y: 5000 }, { x: 4000, y: 5000 }),
      line({ x: 0, y: 6000 }, { x: 4000, y: 6000 }),
    ];
    const ws = walls(dxf(ents, { insunits: 4 }));
    const doubles = ws.filter((w) => Math.abs(w.thickness - 200) < 1e-6 && Math.abs(w.start.y - 100) < 1);
    expect(doubles).toHaveLength(2);
    const xs = doubles.flatMap((w) => [w.start.x, w.end.x]).sort((a, b) => a - b);
    expect(xs).toEqual([0, 3000, 3900, 7000]);
    const singles = ws.filter((w) => w.start.y >= 4999);
    expect(singles).toHaveLength(2);
    for (const w of singles) expect(w.thickness).toBe(200); // options.wallThickness
    // The jamb caps were absorbed (no 200 mm stub walls).
    expect(ws).toHaveLength(4);
  });

  it('filters by layer and recentres far-away drawings', () => {
    const off = 512_345_000;
    const shift = (r: Vec2[]) => r.map((p) => ({ x: p.x + off, y: p.y + off }));
    const ents = [...rectLines(shift(outer), 'A-WALL'), ...rectLines(shift(inner), 'A-WALL'), line({ x: off, y: off }, { x: off + 9000, y: off + 9000 }, 'A-ANNO')];
    const ws = walls(dxf(ents, { insunits: 4 }), opts({ layers: ['A-WALL'] }));
    expect(ws).toHaveLength(4);
    for (const w of ws) for (const p of [w.start, w.end]) expect(Math.abs(p.x) + Math.abs(p.y)).toBeLessThan(30_000);
    expect(ws.every((w) => w.props?.dxfLayer === 'A-WALL')).toBe(true);
  });

  it('linesToWalls works directly on segments', () => {
    const segs = [...outer.map((p, i) => ({ a: p, b: outer[(i + 1) % 4] })), ...inner.map((p, i) => ({ a: p, b: inner[(i + 1) % 4] }))];
    const res = linesToWalls(segs, { wallThickness: 100, detectDoubleLines: true, minLength: 50 });
    expect(res).toHaveLength(4);
    expect(res.every((w) => w.doubleLine)).toBe(true);
  });
});
