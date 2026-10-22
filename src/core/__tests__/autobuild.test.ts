import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import {
  addFloorAbove,
  DEFAULT_GENERATE_OPTIONS,
  defaultFloorMaterial,
  exteriorWallIds,
  generate3D,
  interiorPoint,
  isAutogen,
  nextRoomName,
  orientedBounds,
  outerFootprints,
} from '../autobuild';
import { createElement, createProject } from '../defaults';
import { pointInPolygon, polygonArea } from '../math2d';
import { DocumentStore } from '../store';
import type { Element, Project, Roof, Room, Slab, Vec2 } from '../types';

function rectProject(w = 6000, d = 4000): Project {
  const p = createProject();
  const pts: Vec2[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
  pts.forEach((pt, i) => {
    const wall = createElement('wall', p.levels[0].id, { start: pt, end: pts[(i + 1) % 4], thickness: 200 });
    p.elements[wall.id] = wall;
  });
  return p;
}

const ofType = <T extends Element['type']>(store: DocumentStore, type: T) => store.elements.filter((e) => e.type === type) as Extract<Element, { type: T }>[];
const autogen = (store: DocumentStore) => store.elements.filter(isAutogen);

describe('generate3D on a freshly drawn rectangle', () => {
  it('creates a room, a floor, a foundation and a gable roof in one undo step', () => {
    const store = new DocumentStore(rectProject());
    const before = store.elements.length;
    const s = generate3D(store, DEFAULT_GENERATE_OPTIONS);
    expect(s).toMatchObject({ rooms: 1, floors: 1, foundations: 1, roofs: 1, ceilings: 0, replaced: 0 });
    expect(s.message).toMatch(/1 room/);

    const [room] = ofType(store, 'room');
    expect(room.name).toBe('Room 1');
    expect(room.number).toBe('001');
    expect(polygonArea(room.outline)).toBeCloseTo(5800 * 3800, -3);

    const slabs = ofType(store, 'slab');
    const foundation = slabs.find((x) => x.kind === 'foundation')!;
    expect(polygonArea(foundation.outline)).toBeCloseTo(6200 * 4200, -3);
    const floor = slabs.find((x) => x.kind === 'floor')!;
    expect(floor.materialId).toBe('wood-floor-oak');
    // Laid as a finish over the foundation, proud of it so faces never coincide.
    expect(floor.topOffset).toBeGreaterThan(foundation.topOffset);

    const [roof] = ofType(store, 'roof');
    expect(roof.shape).toBe('gable');
    expect(roof.ridgeAngle).toBe(0); // ridge along the 6 m side
    expect(polygonArea(roof.outline)).toBeCloseTo(6200 * 4200, -3);

    expect(store.undoLabel).toBe('Generate 3D from blueprint');
    store.undo();
    expect(store.elements.length).toBe(before);
    store.redo();
    expect(store.elements.length).toBe(before + 4);
  });

  it('is idempotent: re-running replaces generated elements instead of duplicating', () => {
    const store = new DocumentStore(rectProject());
    generate3D(store, DEFAULT_GENERATE_OPTIONS);
    const count = store.elements.length;
    const s2 = generate3D(store, DEFAULT_GENERATE_OPTIONS);
    expect(s2.replaced).toBe(4);
    expect(store.elements.length).toBe(count);
    expect(autogen(store)).toHaveLength(4);
    // Undo the second run only.
    store.undo();
    expect(store.elements.length).toBe(count);
    expect(autogen(store)).toHaveLength(4);
  });

  it('keeps user edits of generated rooms when regenerating', () => {
    const store = new DocumentStore(rectProject());
    generate3D(store, DEFAULT_GENERATE_OPTIONS);
    const [room] = ofType(store, 'room');
    store.update<Room>(room.id, { name: 'Kitchen' });
    generate3D(store, DEFAULT_GENERATE_OPTIONS);
    const [again] = ofType(store, 'room');
    expect(again.name).toBe('Kitchen');
    const floor = ofType(store, 'slab').find((x) => x.kind === 'floor')!;
    expect(floor.materialId).toBe('tile-grey');
  });

  it('honours options: ceilings, no foundation, flat roof, custom pitch, roof none', () => {
    const store = new DocumentStore(rectProject(8000, 12000));
    const s = generate3D(store, { rooms: true, floors: true, ceilings: true, foundation: false, roof: 'hip', roofPitch: 22 });
    expect(s).toMatchObject({ foundations: 0, ceilings: 1, roofs: 1 });
    const ceiling = ofType(store, 'slab').find((x) => x.kind === 'ceiling')!;
    expect(ceiling.topOffset).toBe(store.project.levels[0].height);
    const floor = ofType(store, 'slab').find((x) => x.kind === 'floor')!;
    expect(floor.topOffset).toBe(0);
    expect(floor.thickness).toBeGreaterThan(100);
    const [roof] = ofType(store, 'roof');
    expect(roof.pitch).toBe(22);
    expect(roof.ridgeAngle).toBe(90); // the long side runs north-south

    generate3D(store, { ...DEFAULT_GENERATE_OPTIONS, roof: 'none' });
    expect(ofType(store, 'roof')).toHaveLength(0);
    generate3D(store, { ...DEFAULT_GENERATE_OPTIONS, roof: 'flat' });
    expect(ofType(store, 'roof')[0].pitch).toBe(0);
  });

  it('reports nothing to generate on an empty project', () => {
    const store = new DocumentStore(createProject());
    const s = generate3D(store, DEFAULT_GENERATE_OPTIONS);
    expect(s.message).toMatch(/Nothing/);
    expect(store.canUndo).toBe(false);
  });
});

describe('generate3D on the sample house', () => {
  it('only fills in what is missing', () => {
    const store = new DocumentStore(createSampleProject());
    const roofsBefore = ofType(store, 'roof').length;
    const s = generate3D(store, DEFAULT_GENERATE_OPTIONS);
    // Ground: 4 enclosed areas, 3 already have rooms. First floor: 2 areas, 1 has a room.
    expect(s.rooms).toBe(2);
    expect(s.floors).toBe(6);
    // The sample already has a foundation and a roof.
    expect(s.foundations).toBe(0);
    expect(s.roofs).toBe(0);
    expect(ofType(store, 'roof')).toHaveLength(roofsBefore);
    const names = ofType(store, 'room').map((r) => r.name);
    expect(names).toContain('Room 1');
    expect(names).toContain('Room 2');

    const kitchen = ofType(store, 'room').find((r) => r.name === 'Kitchen')!;
    const kitchenFloor = ofType(store, 'slab').find((x) => x.props?.roomId === kitchen.id)!;
    expect(kitchenFloor.materialId).toBe('tile-grey');
    // First floor rooms sit on the user's structural slab → thin finishes.
    const first = store.project.levels[1].id;
    for (const f of ofType(store, 'slab').filter((x) => x.levelId === first && isAutogen(x))) {
      expect(f.thickness).toBeLessThan(50);
      expect(f.topOffset).toBeGreaterThan(0);
    }
    // Idempotent on the sample too.
    const n = store.elements.length;
    generate3D(store, DEFAULT_GENERATE_OPTIONS);
    expect(store.elements.length).toBe(n);
  });

  it('places ceilings below the floor structure of the level above', () => {
    const store = new DocumentStore(createSampleProject());
    generate3D(store, { ...DEFAULT_GENERATE_OPTIONS, ceilings: true, levelIds: [store.project.levels[0].id] });
    const ceilings = ofType(store, 'slab').filter((x) => x.kind === 'ceiling');
    expect(ceilings).toHaveLength(4);
    // Upper slab: top 0 (at 3000), 250 thick → ceilings top at 2750.
    for (const c of ceilings) expect(c.topOffset).toBe(2750);
  });

  it('processes only the requested levels', () => {
    const store = new DocumentStore(createSampleProject());
    const s = generate3D(store, { ...DEFAULT_GENERATE_OPTIONS, levelIds: [store.project.levels[1].id] });
    expect(s.levels).toBe(1);
    expect(s.rooms).toBe(1);
    expect(autogen(store).every((e) => e.levelId === store.project.levels[1].id)).toBe(true);
  });
});

describe('addFloorAbove', () => {
  it('copies the exterior walls and their windows to a new level', () => {
    const store = new DocumentStore(createSampleProject());
    const [ground, first] = store.project.levels;
    const res = addFloorAbove(store, first.id, { copy: 'exterior' });
    const level = store.getLevel(res.levelId)!;
    expect(level.elevation).toBe(first.elevation + first.height);
    expect(level.name).toBe('Second Floor');
    expect(res.walls).toBe(4);
    expect(res.openings).toBe(5); // the first floor's 5 exterior windows
    const walls = store.elementsOnLevel(level.id).filter((e) => e.type === 'wall');
    expect(walls).toHaveLength(4);
    expect(store.undoLabel).toBe('Add floor above');
    store.undo();
    expect(store.getLevel(res.levelId)).toBeUndefined();
    expect(store.project.levels).toHaveLength(2);
    expect(ground.id).toBe(store.project.levels[0].id);
  });

  it('inserts between levels, pushing the upper levels up', () => {
    const store = new DocumentStore(createSampleProject());
    const [ground, first] = store.project.levels;
    const res = addFloorAbove(store, ground.id, { copy: 'all' });
    expect(store.project.levels.map((l) => l.id)).toEqual([ground.id, res.levelId, first.id]);
    expect(store.getLevel(first.id)!.elevation).toBe(6000);
    expect(res.walls).toBe(7);
    expect(res.openings).toBe(9);
  });

  it('adds an empty level with copy none', () => {
    const store = new DocumentStore(rectProject());
    const res = addFloorAbove(store, store.project.levels[0].id, { copy: 'none' });
    expect(store.elementsOnLevel(res.levelId)).toHaveLength(0);
    expect(store.getLevel(res.levelId)!.name).toBe('First Floor');
  });

  it('identifies exterior walls only', () => {
    const sp = createSampleProject();
    expect(exteriorWallIds(sp, sp.levels[0].id)).toHaveLength(4);
  });
});

describe('helpers', () => {
  it('derives floor materials from room names', () => {
    expect(defaultFloorMaterial('Kitchen')).toMatch(/^tile/);
    expect(defaultFloorMaterial('Main Bathroom')).toMatch(/^tile/);
    expect(defaultFloorMaterial('Bedroom 2')).toBe('wood-floor-oak');
  });

  it('finds interior points of concave polygons', () => {
    const u: Vec2[] = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 3000 },
      { x: 2000, y: 3000 },
      { x: 2000, y: 1000 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    expect(pointInPolygon(interiorPoint(u), u)).toBe(true);
  });

  it('computes oriented bounds of rotated rectangles', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const r = [
      { x: 0, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 3000 },
      { x: 0, y: 3000 },
    ].map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
    const ob = orientedBounds(r);
    expect(ob.angle).toBeCloseTo(30, 4);
    expect(ob.length).toBeCloseTo(8000, 3);
    expect(ob.width).toBeCloseTo(3000, 3);
  });

  it('names rooms sequentially and finds footprints', () => {
    const p = rectProject();
    expect(nextRoomName(p)).toBe('Room 1');
    const r = createElement('room', p.levels[0].id, { name: 'Room 7', outline: [] });
    p.elements[r.id] = r;
    expect(nextRoomName(p)).toBe('Room 8');
    expect(outerFootprints(p, p.levels[0].id)).toHaveLength(1);
  });

  it('keeps slabs and roofs well formed', () => {
    const store = new DocumentStore(rectProject());
    generate3D(store, { ...DEFAULT_GENERATE_OPTIONS, ceilings: true });
    for (const s of ofType(store, 'slab') as Slab[]) {
      expect(s.outline.length).toBeGreaterThanOrEqual(3);
      expect(s.thickness).toBeGreaterThan(0);
    }
    const roof = ofType(store, 'roof')[0] as Roof;
    expect(roof.overhang).toBeGreaterThan(0);
  });
});
