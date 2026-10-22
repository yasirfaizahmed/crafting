import { describe, expect, it } from 'vitest';
import type { DoorStyle, Opening, Project, WindowStyle } from '../../core/types';
import { buildElementGeometry, createGeometryContext } from '../index';
import { expectValidParts, expectWithin, openEdges, planBounds, testProject, volumeOf } from './helpers';

function build(project: Project, op: Opening) {
  return buildElementGeometry(createGeometryContext(project), op).parts;
}

/** A 6 m wall along +x (thickness 200, centre-justified) with a closed room on its left (+y) side. */
function host() {
  const t = testProject();
  const wall = t.add('wall', { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thickness: 200 });
  t.add('wall', { start: { x: 6000, y: 0 }, end: { x: 6000, y: 4000 } });
  t.add('wall', { start: { x: 6000, y: 4000 }, end: { x: 0, y: 4000 } });
  t.add('wall', { start: { x: 0, y: 4000 }, end: { x: 0, y: 0 } });
  return { ...t, wall };
}

const DOOR_STYLES: DoorStyle[] = ['single', 'double', 'sliding', 'pocket', 'garage'];
const WINDOW_STYLES: WindowStyle[] = ['casement', 'sliding', 'fixed', 'awning', 'double-hung'];

describe('doors', () => {
  for (const style of DOOR_STYLES) {
    it(`${style}: frame + leaf parts inside the opening (casings on the faces)`, () => {
      const { project, add, wall } = host();
      const width = style === 'garage' ? 2400 : 1200;
      const d = add('door', { hostId: wall.id, offset: 3000, width, height: 2100, sill: 0, style });
      const parts = build(project, d);
      expectValidParts(parts);
      expect(openEdges(parts)).toBe(0);
      expect(volumeOf(parts)).toBeGreaterThan(0);
      expect(parts.some((p) => p.role === 'frame')).toBe(true);
      if (style === 'sliding') expect(parts.filter((p) => p.role === 'glass').every((p) => p.materialId === 'glass-clear')).toBe(true);
      expect(parts.some((p) => p.role === (style === 'sliding' ? 'glass' : 'panel'))).toBe(true);
      // Casings (≤ 65 mm) and handles (≤ 100 mm) stay close to the opening.
      expectWithin(planBounds(parts), { minX: 3000 - width / 2 - 65, maxX: 3000 + width / 2 + 65, minY: -100 - 100, maxY: 100 + 100, minZ: 0, maxZ: 2100 + 65 }, 1);
    });
  }

  it("'opening' style is just the hole", () => {
    const { project, add, wall } = host();
    const d = add('door', { hostId: wall.id, offset: 3000, width: 900, height: 2100, style: 'opening' });
    expect(build(project, d)).toEqual([]);
  });

  it('frame material follows frameMaterialId and leaves use the door material', () => {
    const { project, add, wall } = host();
    const d = add('door', { hostId: wall.id, offset: 3000, width: 900, height: 2100, style: 'single', frameMaterialId: 'wood-walnut', materialId: 'paint-navy' });
    const parts = build(project, d);
    expect(parts.find((p) => p.role === 'frame')?.materialId).toBe('wood-walnut');
    expect(parts.find((p) => p.role === 'panel')?.materialId).toBe('paint-navy');
  });

  it('respects hinge and flip (the leaf moves to the swing side, hinges to the hinge side)', () => {
    const { project, add, wall } = host();
    const mk = (hinge: 'left' | 'right', flip: boolean) =>
      build(project, add('door', { hostId: wall.id, offset: 3000, width: 900, height: 2100, style: 'single', hinge, flip }));
    const leafY = (parts: ReturnType<typeof mk>) => {
      const b = planBounds(parts.filter((p) => p.role === 'panel'));
      return (b.minY + b.maxY) / 2;
    };
    const handleX = (parts: ReturnType<typeof mk>) => {
      const b = planBounds(parts.filter((p) => p.role === 'detail'));
      return (b.minX + b.maxX) / 2;
    };
    const a = mk('left', false);
    const b = mk('left', true);
    const c = mk('right', false);
    expect(leafY(a)).toBeGreaterThan(0);
    expect(leafY(b)).toBeLessThan(0);
    // Hardware (handles + knuckles) is mirrored when the hinge side changes.
    expect(Math.sign(handleX(a) - 3000)).toBe(-Math.sign(handleX(c) - 3000));
  });

  it('double doors have two leaves with a handle each', () => {
    const { project, add, wall } = host();
    const parts = build(project, add('door', { hostId: wall.id, offset: 3000, width: 1600, height: 2100, style: 'double' }));
    const leaf = planBounds(parts.filter((p) => p.role === 'panel'));
    expect(leaf.minX).toBeLessThan(2300);
    expect(leaf.maxX).toBeGreaterThan(3700);
    const panel = parts.find((p) => p.role === 'panel')!;
    // Two leaves → two disjoint groups of vertices on either side of the centre line.
    const xs = Array.from({ length: panel.mesh.positions.length / 3 }, (_, i) => panel.mesh.positions[i * 3] * 1000);
    expect(xs.some((x) => x < 2999)).toBe(true);
    expect(xs.some((x) => x > 3001)).toBe(true);
    expect(xs.every((x) => Math.abs(x - 3000) > 0.5)).toBe(true);
  });

  it('garage door has horizontal sections and sits inside the wall', () => {
    const { project, add, wall } = host();
    const parts = build(project, add('door', { hostId: wall.id, offset: 3000, width: 2400, height: 2100, style: 'garage' }));
    const panel = parts.find((p) => p.role === 'panel')!;
    const zs = new Set(Array.from({ length: panel.mesh.positions.length / 3 }, (_, i) => Math.round(panel.mesh.positions[i * 3 + 1] * 1000)));
    expect(zs.size).toBeGreaterThan(6);
    const b = planBounds([panel]);
    expect(b.minY).toBeGreaterThanOrEqual(-100 - 1e-3);
    expect(b.maxY).toBeLessThanOrEqual(100 + 1e-3);
  });

  it('is clipped to its host and returns nothing without a valid host', () => {
    const { project, add, wall } = host();
    const clipped = build(project, add('door', { hostId: wall.id, offset: 200, width: 900, height: 2100 }));
    expect(planBounds(clipped).minX).toBeGreaterThanOrEqual(-1);
    expect(build(project, add('door', { hostId: 'nope', offset: 200, width: 900, height: 2100 }))).toEqual([]);
    const tall = build(project, add('door', { hostId: wall.id, offset: 4500, width: 900, height: 5000 }));
    expect(planBounds(tall).maxZ).toBeLessThanOrEqual(3000 + 1);
  });
});

describe('windows', () => {
  for (const style of WINDOW_STYLES) {
    it(`${style}: frame, sash(es) and glass inside the opening`, () => {
      const { project, add, wall } = host();
      const w = add('window', { hostId: wall.id, offset: 3000, width: 1500, height: 1200, sill: 900, style });
      const parts = build(project, w);
      expectValidParts(parts);
      expect(openEdges(parts)).toBe(0);
      expect(volumeOf(parts)).toBeGreaterThan(0);
      const glass = parts.filter((p) => p.role === 'glass');
      expect(glass.length).toBeGreaterThan(0);
      expect(glass.every((p) => p.materialId === 'glass-clear')).toBe(true);
      expect(parts.find((p) => p.role === 'frame')?.materialId).toBe('paint-white');
      // Glass stays inside the clear opening.
      expectWithin(planBounds(glass), { minX: 2250, maxX: 3750, minY: -100, maxY: 100, minZ: 900, maxZ: 2100 }, 1);
      // Sills project ≤ 40 mm beyond the wall faces and the horns ≤ 40 mm past the jambs.
      expectWithin(planBounds(parts), { minX: 2250 - 40, maxX: 3750 + 40, minY: -140, maxY: 140, minZ: 900, maxZ: 2100 }, 1);
    });
  }

  it('uses frameMaterialId and a glass material override', () => {
    const { project, add, wall } = host();
    const w = add('window', { hostId: wall.id, offset: 3000, width: 1200, height: 1200, sill: 900, frameMaterialId: 'aluminium', materialId: 'glass-tinted' });
    const parts = build(project, w);
    expect(parts.find((p) => p.role === 'frame')?.materialId).toBe('aluminium');
    expect(parts.filter((p) => p.role === 'glass').every((p) => p.materialId === 'glass-tinted')).toBe(true);
  });

  it('puts the interior sill board on the room side', () => {
    const { project, add, wall } = host();
    const parts = build(project, add('window', { hostId: wall.id, offset: 3000, width: 1200, height: 1200, sill: 900, style: 'fixed' }));
    const b = planBounds(parts);
    // Interior (+y, towards the room) board projects 25 mm, exterior sill 40 mm.
    expect(b.maxY).toBeCloseTo(125, 0);
    expect(b.minY).toBeCloseTo(-140, 0);
  });

  it('wide casements get mullions and several sashes', () => {
    const { project, add, wall } = host();
    const parts = build(project, add('window', { hostId: wall.id, offset: 3000, width: 2400, height: 1200, sill: 900, style: 'casement' }));
    const glass = parts.find((p) => p.role === 'glass')!;
    // Each sash pane is a closed box (8 corners → 24 vertices with flat normals).
    expect(glass.mesh.positions.length / 3 / 24).toBeGreaterThanOrEqual(3);
  });
});
