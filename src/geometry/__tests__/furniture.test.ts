import { describe, expect, it } from 'vitest';
import { FURNITURE, getFurniture } from '../../core/catalog';
import { getMaterial } from '../../core/materials';
import type { Furniture, Project } from '../../core/types';
import { FURNITURE_HEIGHT_ALLOWANCE, FURNITURE_MODELS, buildElementGeometry, createGeometryContext } from '../index';
import { expectValidParts, expectWithin, openEdges, planBounds, testProject, volumeOf } from './helpers';

function build(project: Project, el: Furniture) {
  return buildElementGeometry(createGeometryContext(project), el);
}

describe('furniture', () => {
  it('has a dedicated model for every catalog id', () => {
    for (const def of FURNITURE) expect(FURNITURE_MODELS[def.id], def.id).toBeTypeOf('function');
  });

  for (const def of FURNITURE) {
    it(`${def.id}: closed parts inside its ${def.width} × ${def.depth} × ${def.height} box`, () => {
      const { project, add } = testProject();
      const el = add('furniture', { catalogId: def.id, position: { x: 0, y: 0 }, rotation: 0, elevation: 0 });
      const g = build(project, el);
      expect(g.parts.length).toBeGreaterThan(0);
      expectValidParts(g.parts);
      expect(openEdges(g.parts)).toBe(0);
      expect(volumeOf(g.parts)).toBeGreaterThan(0);
      const allow = FURNITURE_HEIGHT_ALLOWANCE[def.id] ?? 0;
      const b = planBounds(g.parts);
      expectWithin(b, { minX: -def.width / 2, maxX: def.width / 2, minY: -def.depth / 2, maxY: def.depth / 2, minZ: 0, maxZ: def.height + allow }, 1);
      // The model fills its box reasonably (no tiny model in a big footprint).
      expect(b.maxX - b.minX).toBeGreaterThan(def.width * 0.6);
      expect(b.maxY - b.minY).toBeGreaterThan(def.depth * 0.6);
      expect(b.maxZ - b.minZ).toBeGreaterThan(def.height * 0.6);
      // Primary material is used; every part references a known material.
      expect(g.parts.some((p) => p.materialId === def.materialId)).toBe(true);
      for (const p of g.parts) expect(getMaterial(p.materialId).id).toBe(p.materialId);
      if (def.light) {
        expect(g.lights).toHaveLength(1);
        expect(g.lights[0]).toMatchObject(def.light);
        expect(g.parts.some((p) => p.role === 'light')).toBe(true);
      } else expect(g.lights).toEqual([]);
    });
  }

  it('uses the secondary material where the catalog defines one', () => {
    const { project, add } = testProject();
    for (const def of FURNITURE.filter((d) => d.secondaryMaterialId)) {
      const g = build(project, add('furniture', { catalogId: def.id, position: { x: 0, y: 0 }, rotation: 0, elevation: 0 }));
      expect(g.parts.some((p) => p.materialId === def.secondaryMaterialId), def.id).toBe(true);
    }
  });

  it('scales to width/depth/height overrides', () => {
    const { project, add } = testProject();
    for (const id of ['sofa-3', 'bed-double', 'dining-table-6', 'wardrobe', 'kitchen-base', 'bathtub', 'tree']) {
      const el = add('furniture', { catalogId: id, position: { x: 0, y: 0 }, rotation: 0, elevation: 0, width: 1234, depth: 987, height: 1500 });
      const b = planBounds(build(project, el).parts);
      expectWithin(b, { minX: -617, maxX: 617, minY: -493.5, maxY: 493.5, minZ: 0, maxZ: 1500 + (FURNITURE_HEIGHT_ALLOWANCE[id] ?? 0) }, 1);
      expect(b.maxX - b.minX).toBeGreaterThan(1234 * 0.6);
      expect(b.maxZ).toBeGreaterThan(1500 * 0.6);
    }
  });

  it('rotates, mirrors and lifts the model (front at local −y)', () => {
    const { project, add } = testProject();
    project.levels[0].elevation = 3000;
    const def = getFurniture('sofa-3')!;
    const r0 = add('furniture', { catalogId: 'sofa-3', position: { x: 1000, y: 2000 }, rotation: 0, elevation: 0 });
    const r90 = add('furniture', { catalogId: 'sofa-3', position: { x: 1000, y: 2000 }, rotation: 90, elevation: 400 });
    const b0 = planBounds(build(project, r0).parts);
    const b90 = planBounds(build(project, r90).parts);
    expect(b0.maxX - b0.minX).toBeCloseTo(def.width, 0);
    expect(b90.maxY - b90.minY).toBeCloseTo(def.width, 0);
    expect(b90.maxX - b90.minX).toBeCloseTo(def.depth, 0);
    expect(b0.minZ).toBeCloseTo(3000, 3);
    expect(b90.minZ).toBeCloseTo(3400, 3);
    // The backrest (tallest part of the sofa) is at the back: +y at rotation 0, −x at rotation 90.
    const highest = (el: Furniture) => {
      const parts = build(project, el).parts;
      let best = { z: -Infinity, x: 0, y: 0 };
      for (const p of parts) {
        const pos = p.mesh.positions;
        for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] * 1000 > best.z) best = { z: pos[i + 1] * 1000, x: pos[i] * 1000, y: -pos[i + 2] * 1000 };
      }
      return best;
    };
    expect(highest(r0).y).toBeGreaterThan(2000);
    expect(highest(r90).x).toBeLessThan(1000);
    // Mirroring keeps solids outward-wound and stays inside the same footprint.
    const m = add('furniture', { catalogId: 'sofa-l', position: { x: 0, y: 0 }, rotation: 30, elevation: 0, mirrored: true });
    const parts = build(project, m).parts;
    expect(openEdges(parts)).toBe(0);
    expect(volumeOf(parts)).toBeCloseTo(volumeOf(build(project, { ...m, mirrored: false }).parts), -3);
  });

  it('places fixture lights at the lamp, in world metres', () => {
    const { project, add } = testProject();
    const el = add('furniture', { catalogId: 'pendant-light', position: { x: 2000, y: -1000 }, rotation: 0, elevation: 2200 });
    const [light] = build(project, el).lights;
    expect(light.position[0]).toBeCloseTo(2, 3);
    expect(light.position[2]).toBeCloseTo(1, 3);
    expect(light.position[1]).toBeGreaterThan(2.0);
    expect(light.position[1]).toBeLessThan(2.8);
  });

  it('falls back to a generic model for unknown catalog ids and uses material overrides', () => {
    const { project, add } = testProject();
    const g = build(project, add('furniture', { catalogId: 'no-such-thing', position: { x: 0, y: 0 }, rotation: 0, elevation: 0 }));
    expect(g.parts.length).toBeGreaterThan(0);
    expect(openEdges(g.parts)).toBe(0);
    const o = build(project, add('furniture', { catalogId: 'armchair', position: { x: 0, y: 0 }, rotation: 0, elevation: 0, materialId: 'fabric-blue' }));
    expect(o.parts.some((p) => p.materialId === 'fabric-blue')).toBe(true);
    expect(o.parts.some((p) => p.materialId === 'leather-brown')).toBe(false);
  });
});
