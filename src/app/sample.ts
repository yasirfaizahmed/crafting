/**
 * Demo project: a two-storey house with every element type. Used as the first-run project,
 * in unit tests across modules, and by the E2E smoke test.
 */
import { createElement, createLevel, createProject } from '../core/defaults';
import type { Element, Project, Vec2, Wall } from '../core/types';

function addAll(project: Project, els: Element[]): void {
  for (const el of els) project.elements[el.id] = el;
}

export function createSampleProject(): Project {
  const project = createProject('Sample House');
  project.info.author = 'Crafting';
  project.info.description = 'Two-storey family house demonstrating walls, openings, slabs, stairs, roof and furniture.';
  const ground = project.levels[0];
  const first = createLevel({ name: 'First Floor', elevation: 3000, height: 3000 });
  project.levels.push(first);

  // Ground floor: 12m x 8m outer walls with an interior partition layout.
  const W = 12000;
  const D = 8000;
  const outer = (levelId: string, mat = 'brick-red'): Wall[] => {
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: D },
      { x: 0, y: D },
    ];
    return pts.map((p, i) =>
      createElement('wall', levelId, {
        start: p,
        end: pts[(i + 1) % 4],
        thickness: 250,
        structural: true,
        materialId: mat,
      }),
    );
  };

  const g = outer(ground.id);
  const [gSouth, gEast, gNorth, gWest] = g;
  const gInterior: Wall[] = [
    createElement('wall', ground.id, { start: { x: 5000, y: 0 }, end: { x: 5000, y: D }, thickness: 120 }),
    createElement('wall', ground.id, { start: { x: 5000, y: 4500 }, end: { x: W, y: 4500 }, thickness: 120 }),
    createElement('wall', ground.id, { start: { x: 9000, y: 4500 }, end: { x: 9000, y: D }, thickness: 120 }),
  ];
  addAll(project, [...g, ...gInterior]);

  addAll(project, [
    createElement('door', ground.id, { hostId: gSouth.id, offset: 2500, width: 1000, height: 2200, style: 'single' }),
    createElement('door', ground.id, { hostId: gInterior[0].id, offset: 2000, width: 900 }),
    createElement('door', ground.id, { hostId: gInterior[1].id, offset: 1500, width: 900, hinge: 'right' }),
    createElement('door', ground.id, { hostId: gInterior[2].id, offset: 1500, width: 800 }),
    createElement('door', ground.id, { hostId: gNorth.id, offset: 6500, width: 2400, height: 2200, style: 'sliding' }),
    createElement('window', ground.id, { hostId: gSouth.id, offset: 8500, width: 2400, height: 1500, sill: 800 }),
    createElement('window', ground.id, { hostId: gEast.id, offset: 2200, width: 1500, height: 1200, sill: 900 }),
    createElement('window', ground.id, { hostId: gWest.id, offset: 4000, width: 1800, height: 1200, sill: 900, style: 'sliding' }),
    createElement('window', ground.id, { hostId: gNorth.id, offset: 1500, width: 900, height: 600, sill: 1500, style: 'awning' }),
  ]);

  addAll(project, [
    createElement('slab', ground.id, {
      outline: [
        { x: -125, y: -125 },
        { x: W + 125, y: -125 },
        { x: W + 125, y: D + 125 },
        { x: -125, y: D + 125 },
      ],
      thickness: 300,
      kind: 'foundation',
      materialId: 'concrete',
    }),
    createElement('room', ground.id, {
      name: 'Living / Dining',
      number: '001',
      outline: [
        { x: 5060, y: 125 },
        { x: W - 125, y: 125 },
        { x: W - 125, y: 4440 },
        { x: 5060, y: 4440 },
      ],
    }),
    createElement('room', ground.id, {
      name: 'Kitchen',
      number: '002',
      outline: [
        { x: 5060, y: 4560 },
        { x: 8940, y: 4560 },
        { x: 8940, y: D - 125 },
        { x: 5060, y: D - 125 },
      ],
      floorMaterialId: 'tile-grey',
    }),
    createElement('room', ground.id, {
      name: 'Entry / Study',
      number: '003',
      outline: [
        { x: 125, y: 125 },
        { x: 4940, y: 125 },
        { x: 4940, y: D - 125 },
        { x: 125, y: D - 125 },
      ],
    }),
    createElement('stair', ground.id, { position: { x: 1200, y: 3200 }, rotation: 90, width: 1000, shape: 'straight', materialId: 'wood-oak' }),
    createElement('column', ground.id, { position: { x: 12900, y: -900 }, width: 250, depth: 250, height: 2800 }),
    createElement('furniture', ground.id, { catalogId: 'sofa-3', position: { x: 8000, y: 1000 }, rotation: 0 }),
    createElement('furniture', ground.id, { catalogId: 'coffee-table', position: { x: 8000, y: 2200 }, rotation: 0 }),
    createElement('furniture', ground.id, { catalogId: 'tv-unit', position: { x: 8000, y: 4150 }, rotation: 180 }),
    createElement('furniture', ground.id, { catalogId: 'dining-table-6', position: { x: 10600, y: 2300 }, rotation: 90 }),
    createElement('furniture', ground.id, { catalogId: 'kitchen-base-1200', position: { x: 6300, y: 7575 }, rotation: 180 }),
    createElement('furniture', ground.id, { catalogId: 'stove', position: { x: 7300, y: 7575 }, rotation: 180 }),
    createElement('furniture', ground.id, { catalogId: 'fridge', position: { x: 8350, y: 7525 }, rotation: 180 }),
    createElement('furniture', ground.id, { catalogId: 'desk', position: { x: 3500, y: 7300 }, rotation: 180 }),
    createElement('furniture', ground.id, { catalogId: 'ceiling-light', position: { x: 8500, y: 2200 }, rotation: 0, elevation: 2800 }),
    createElement('furniture', ground.id, { catalogId: 'tree', position: { x: -4000, y: 3000 }, rotation: 0 }),
    createElement('furniture', ground.id, { catalogId: 'car', position: { x: 15000, y: 3000 }, rotation: 0 }),
    createElement('dimension', ground.id, { a: { x: 0, y: 0 }, b: { x: W, y: 0 }, offset: -1500 }),
    createElement('label', ground.id, { position: { x: 6000, y: -2500 }, text: 'SAMPLE HOUSE — GROUND FLOOR', size: 5 }),
  ]);

  // First floor.
  const f = outer(first.id, 'plaster-white');
  const [fSouth, fEast, fNorth, fWest] = f;
  const fInterior: Wall[] = [
    createElement('wall', first.id, { start: { x: 6000, y: 0 }, end: { x: 6000, y: D }, thickness: 120 }),
    createElement('wall', first.id, { start: { x: 0, y: 4500 }, end: { x: 3000, y: 4500 }, thickness: 120 }),
  ];
  addAll(project, [...f, ...fInterior]);
  addAll(project, [
    createElement('slab', first.id, {
      outline: [
        { x: 0, y: 0 },
        { x: W, y: 0 },
        { x: W, y: D },
        { x: 0, y: D },
      ],
      holes: [
        [
          { x: 700, y: 3200 },
          { x: 1700, y: 3200 },
          { x: 1700, y: 8000 - 250 },
          { x: 700, y: 8000 - 250 },
        ],
      ],
      thickness: 250,
      kind: 'floor',
      materialId: 'wood-floor-oak',
    }),
    createElement('window', first.id, { hostId: fSouth.id, offset: 3000, width: 1500, height: 1400 }),
    createElement('window', first.id, { hostId: fSouth.id, offset: 9000, width: 1500, height: 1400 }),
    createElement('window', first.id, { hostId: fEast.id, offset: 4000, width: 1200, height: 1400 }),
    createElement('window', first.id, { hostId: fNorth.id, offset: 3000, width: 2400, height: 2000, sill: 300, style: 'fixed' }),
    createElement('window', first.id, { hostId: fWest.id, offset: 2000, width: 900, height: 1200 }),
    createElement('door', first.id, { hostId: fInterior[0].id, offset: 2000, width: 900 }),
    createElement('furniture', first.id, { catalogId: 'bed-king', position: { x: 9000, y: 6800 }, rotation: 180 }),
    createElement('furniture', first.id, { catalogId: 'nightstand', position: { x: 7700, y: 7500 }, rotation: 180 }),
    createElement('furniture', first.id, { catalogId: 'wardrobe', position: { x: 11300, y: 3000 }, rotation: 90 }),
    createElement('furniture', first.id, { catalogId: 'bathtub', position: { x: 4800, y: 7350 }, rotation: 180 }),
    createElement('furniture', first.id, { catalogId: 'toilet', position: { x: 3600, y: 7400 }, rotation: 180 }),
    createElement('room', first.id, {
      name: 'Master Bedroom',
      number: '101',
      outline: [
        { x: 6060, y: 125 },
        { x: W - 125, y: 125 },
        { x: W - 125, y: D - 125 },
        { x: 6060, y: D - 125 },
      ],
    }),
    createElement('railing', first.id, {
      path: [
        { x: 1700, y: 3200 },
        { x: 700, y: 3200 },
      ],
      height: 1000,
    }),
    createElement('roof', first.id, {
      outline: [
        { x: -125, y: -125 },
        { x: W + 125, y: -125 },
        { x: W + 125, y: D + 125 },
        { x: -125, y: D + 125 },
      ],
      shape: 'gable',
      pitch: 30,
      overhang: 500,
      ridgeAngle: 0,
      materialId: 'roof-tiles-clay',
    }),
    createElement('block', first.id, { position: { x: 5000, y: 3800, z: 3000 }, size: { x: 600, y: 600, z: 1500 }, materialId: 'brick-red' }),
  ]);
  return project;
}
