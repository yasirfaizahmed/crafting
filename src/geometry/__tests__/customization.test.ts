import { describe, expect, it } from 'vitest';
import { getMaterial } from '../../core/materials';
import type { Door, Element, Project, Railing, Window } from '../../core/types';
import { buildElementGeometry, createGeometryContext, partKey } from '../index';
import type { GeometryPart } from '../types';
import { expectValidParts, planBounds, testProject } from './helpers';

const build = (project: Project, el: Element): GeometryPart[] => buildElementGeometry(createGeometryContext(project), el).parts;
const tris = (parts: GeometryPart[], key?: string) => parts.filter((p) => !key || partKey(p) === key).reduce((a, p) => a + p.mesh.indices.length / 3, 0);

function withWall() {
  const t = testProject();
  const wall = t.add('wall', { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thickness: 200 });
  return { ...t, wall };
}

describe('doors', () => {
  it('opens the leaf by `openAngle`, towards the swing side', () => {
    const { project, add, wall } = withWall();
    const closed = add('door', { hostId: wall.id, offset: 3000, width: 900 }) as Door;
    const open = { ...closed, openAngle: 90 };
    const leaf = (d: Door) => planBounds(build(project, d).filter((p) => p.role === 'panel'));
    expect(leaf(closed).maxY - leaf(closed).minY).toBeLessThan(200);
    // Open 90°: the leaf now sticks out of the wall by about its width.
    expect(leaf(open).maxY - leaf(open).minY).toBeGreaterThan(700);
    expectValidParts(build(project, open));
  });

  it('builds flush, glazed and half-glazed leaves', () => {
    const { project, add, wall } = withWall();
    const d = add('door', { hostId: wall.id, offset: 3000, width: 900 }) as Door;
    expect(build(project, { ...d, leaf: 'flush' }).some((p) => p.role === 'glass')).toBe(false);
    expect(tris(build(project, { ...d, leaf: 'flush' }), 'panel')).toBeLessThan(tris(build(project, d), 'panel'));
    for (const leaf of ['glazed', 'half-glazed'] as const) {
      const parts = build(project, { ...d, leaf });
      expectValidParts(parts);
      expect(parts.some((p) => p.role === 'glass')).toBe(true);
    }
  });
});

describe('windows', () => {
  it('follows panes, glazing bars, frame width and setback', () => {
    const { project, add, wall } = withWall();
    const w = add('window', { hostId: wall.id, offset: 3000, width: 2400, height: 1200, style: 'fixed' }) as Window;
    const glassCount = (win: Window) => build(project, win).filter((p) => p.role === 'glass').reduce((a, p) => a + p.mesh.indices.length / 36, 0);
    expect(glassCount({ ...w, panes: 4 })).toBeGreaterThan(glassCount({ ...w, panes: 1 }));
    const bars = build(project, { ...w, glazingBars: { x: 2, y: 1 } });
    expectValidParts(bars);
    expect(bars.some((p) => p.name === 'glazing-bars')).toBe(true);
    // The glass sits in the middle of the frame (sills run through the whole wall, so measure the glass).
    const glassY = (win: Window) => planBounds(build(project, win).filter((p) => p.role === 'glass'));
    // Wall runs along +x at y = 0, 200 thick: outer and inner setbacks move the frame to opposite faces.
    const out = glassY({ ...w, setback: 'outside' });
    const inn = glassY({ ...w, setback: 'inside' });
    expect(Math.abs((out.minY + out.maxY) / 2 - (inn.minY + inn.maxY) / 2)).toBeGreaterThan(90);
    expect(tris(build(project, { ...w, frameWidth: 120 }), 'frame')).toBeGreaterThan(0);
  });
});

describe('railings and part materials', () => {
  it('uses the baluster and post spacing settings', () => {
    const { project, add } = testProject();
    const r = add('railing', { path: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], style: 'bars' }) as Railing;
    expect(tris(build(project, { ...r, balusterSpacing: 60 }))).toBeGreaterThan(tris(build(project, { ...r, balusterSpacing: 250 })));
    expect(tris(build(project, { ...r, postSpacing: 400 }))).toBeGreaterThan(tris(build(project, { ...r, postSpacing: 2000 })));
  });

  it('overrides the material of individual parts', () => {
    const { project, add, wall } = withWall() as ReturnType<typeof withWall>;
    const d = add('door', { hostId: wall.id, offset: 3000, width: 900 }) as Door;
    const parts = build(project, { ...d, partMaterials: { frame: 'paint-charcoal', detail: 'copper', panel: 'nope' } });
    expect(parts.filter((p) => p.role === 'frame').every((p) => p.materialId === 'paint-charcoal')).toBe(true);
    expect(parts.filter((p) => p.role === 'detail').every((p) => p.materialId === 'copper')).toBe(true);
    // Unknown materials are ignored.
    expect(parts.filter((p) => p.role === 'panel').every((p) => p.materialId !== 'nope')).toBe(true);
  });
});

describe('light fixtures', () => {
  it('switch off: no light source and no glowing parts; on again restores both', () => {
    const { project, add } = testProject();
    for (const catalogId of ['ceiling-light', 'pendant-light', 'floor-lamp', 'wall-light']) {
      const on = add('furniture', { catalogId, position: { x: 0, y: 0 } });
      const lit = buildElementGeometry(createGeometryContext(project), on);
      expect(lit.lights).toHaveLength(1);
      expect(lit.parts.some((p) => p.role === 'light' && getMaterial(p.materialId).emissive)).toBe(true);
      const off = buildElementGeometry(createGeometryContext(project), { ...on, lightOn: false } as Element);
      expect(off.lights).toHaveLength(0);
      expect(off.parts.some((p) => getMaterial(p.materialId).emissive)).toBe(false);
      expect(off.parts.length).toBe(lit.parts.length);
      expectValidParts(off.parts);
    }
  });

  it('a part painted with an emissive material also goes dark when switched off', () => {
    const { project, add } = testProject();
    const lamp = add('furniture', { catalogId: 'floor-lamp', position: { x: 0, y: 0 }, partMaterials: { shade: 'light-warm' }, lightOn: false });
    expect(build(project, lamp).some((p) => getMaterial(p.materialId).emissive)).toBe(false);
  });
});
