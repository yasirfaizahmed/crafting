import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { getFurniture } from '../../core/catalog';
import { polygonArea } from '../../core/math2d';
import { computeStairLayout } from '../../core/stairs';
import type { Element, Project } from '../../core/types';
import { getLevel, wallBaseElevation, wallHeight } from '../../core/walls';
import { FURNITURE_HEIGHT_ALLOWANCE, buildElementGeometry, buildProjectGeometry, createGeometryContext, roofPlanes } from '../index';
import { expectValidParts, expectWithin, openEdges, planBounds, volumeOf, type PlanBounds } from './helpers';

const ANNOTATIONS = new Set(['room', 'dimension', 'label']);

function bboxOf(pts: { x: number; y: number }[]): Pick<PlanBounds, 'minX' | 'maxX' | 'minY' | 'maxY'> {
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

const grow = (b: PlanBounds, d: number, dz = d): PlanBounds => ({
  minX: b.minX - d,
  maxX: b.maxX + d,
  minY: b.minY - d,
  maxY: b.maxY + d,
  minZ: b.minZ - dz,
  maxZ: b.maxZ + dz,
});

/** Conservative world-space box (plan mm + absolute elevation) every element must stay inside. */
function expectedBounds(project: Project, el: Element): PlanBounds | null {
  const lvl = getLevel(project, el.levelId)!;
  const z0 = lvl.elevation;
  switch (el.type) {
    case 'wall': {
      const t = el.thickness * 4;
      return grow({ ...bboxOf([el.start, el.end]), minZ: wallBaseElevation(project, el), maxZ: wallBaseElevation(project, el) + wallHeight(project, el) }, t, 0);
    }
    case 'door':
    case 'window': {
      const host = project.elements[el.hostId];
      if (host?.type !== 'wall') return null;
      const base = wallBaseElevation(project, host) + el.sill;
      return grow({ ...bboxOf([host.start, host.end]), minZ: base, maxZ: base + el.height }, host.thickness + 200, 120);
    }
    case 'slab':
      return { ...bboxOf(el.outline), minZ: z0 + el.topOffset - el.thickness, maxZ: z0 + el.topOffset };
    case 'roof': {
      const rp = roofPlanes(project, el)!;
      const below = el.overhang * Math.tan((el.pitch * Math.PI) / 180) + 1;
      return { ...bboxOf(rp.outline), minZ: rp.eaveElevation - below - 1000, maxZ: rp.ridgeElevation };
    }
    case 'stair': {
      const layout = computeStairLayout(el, lvl.height);
      return grow({ ...bboxOf(layout.footprint.flat()), minZ: z0, maxZ: z0 + layout.rise + 1100 }, 60, 0);
    }
    case 'column':
      return grow({ ...bboxOf([el.position]), minZ: z0 + el.baseOffset, maxZ: z0 + el.baseOffset + (el.height ?? lvl.height) }, Math.hypot(el.width, el.depth) / 2, 0);
    case 'furniture': {
      const def = getFurniture(el.catalogId)!;
      const r = Math.hypot(el.width ?? def.width, el.depth ?? def.depth) / 2;
      const h = (el.height ?? def.height) + (FURNITURE_HEIGHT_ALLOWANCE[el.catalogId] ?? 0);
      return grow({ ...bboxOf([el.position]), minZ: z0 + el.elevation, maxZ: z0 + el.elevation + h }, r, 0);
    }
    case 'railing':
      return grow({ ...bboxOf(el.path), minZ: z0 + el.baseOffset, maxZ: z0 + el.baseOffset + el.height }, 60, 0);
    case 'block': {
      const r = Math.hypot(el.size.x, el.size.y);
      return grow({ ...bboxOf([el.position]), minZ: z0 + el.position.z, maxZ: z0 + el.position.z + el.size.z }, r, 0);
    }
    default:
      return null;
  }
}

describe('sample house geometry', () => {
  const project = createSampleProject();
  const ctx = createGeometryContext(project);
  const elements = Object.values(project.elements);

  it('builds valid, non-empty geometry for every element (and none for annotations)', () => {
    for (const el of elements) {
      const g = buildElementGeometry(ctx, el);
      expect(g.elementId).toBe(el.id);
      if (ANNOTATIONS.has(el.type)) {
        expect(g.parts).toEqual([]);
        expect(g.lights).toEqual([]);
        continue;
      }
      expect(g.parts.length, `${el.type} ${el.id}`).toBeGreaterThan(0);
      expectValidParts(g.parts);
      for (const l of g.lights) expect(l.position.every(Number.isFinite)).toBe(true);
    }
  });

  it('keeps every element inside its expected bounding box', () => {
    for (const el of elements) {
      const e = expectedBounds(project, el);
      if (!e) continue;
      const parts = buildElementGeometry(ctx, el).parts;
      expectWithin(planBounds(parts), e, 1);
    }
  });

  it('produces closed, outward-wound solids with positive volume', () => {
    for (const el of elements) {
      const parts = buildElementGeometry(ctx, el).parts;
      if (!parts.length) continue;
      expect(openEdges(parts), `${el.type} ${el.id}`).toBe(0);
      expect(volumeOf(parts), `${el.type} ${el.id}`).toBeGreaterThan(0);
    }
  });

  it('matches slab volume = outline area × thickness for the sample slabs', () => {
    for (const el of elements) {
      if (el.type !== 'slab') continue;
      const area = polygonArea(el.outline) - (el.holes ?? []).reduce((s, h) => s + polygonArea(h), 0);
      const v = volumeOf(buildElementGeometry(ctx, el).parts);
      expect(Math.abs(v - area * el.thickness)).toBeLessThan(area * el.thickness * 1e-4);
    }
  });

  it('emits a light for every lighting fixture', () => {
    for (const el of elements) {
      if (el.type !== 'furniture' || !getFurniture(el.catalogId)?.light) continue;
      const g = buildElementGeometry(ctx, el);
      expect(g.lights).toHaveLength(1);
      expect(g.parts.some((p) => p.role === 'light')).toBe(true);
    }
  });

  it('is deterministic', () => {
    const a = buildProjectGeometry(project);
    const b = buildProjectGeometry(createSampleProject());
    expect(a.length).toBe(b.length);
    // Ids differ between sample instances; compare the meshes in insertion order.
    for (let i = 0; i < a.length; i++) {
      expect(a[i].parts.length).toBe(b[i].parts.length);
      for (let k = 0; k < a[i].parts.length; k++) {
        expect(a[i].parts[k].materialId).toBe(b[i].parts[k].materialId);
        expect(Array.from(a[i].parts[k].mesh.positions)).toEqual(Array.from(b[i].parts[k].mesh.positions));
      }
    }
  });

  it('filters elements and skips annotation-only ones in buildProjectGeometry', () => {
    const all = buildProjectGeometry(project);
    expect(all.length).toBe(elements.filter((e) => !ANNOTATIONS.has(e.type)).length);
    const walls = buildProjectGeometry(project, (e) => e.type === 'wall');
    expect(walls.length).toBe(elements.filter((e) => e.type === 'wall').length);
  });

  it('renders nothing for hidden elements', () => {
    const wall = elements.find((e) => e.type === 'wall')!;
    expect(buildElementGeometry(ctx, { ...wall, hidden: true }).parts).toEqual([]);
  });

  it('builds the whole sample house in under 50 ms', () => {
    for (let i = 0; i < 3; i++) buildProjectGeometry(project);
    let best = Infinity;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      buildProjectGeometry(project);
      best = Math.min(best, performance.now() - t0);
    }
    expect(best).toBeLessThan(50);
  });
});
