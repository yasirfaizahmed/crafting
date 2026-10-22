import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { buildProjectGeometry } from '../../geometry';
import { CATALOG, DEFAULT_HOTBAR, getCatalogItem } from '../catalog';
import { createFromCatalog } from '../defaults';
import { centroid, pointInPolygon, polygonArea, signedArea, simplifyPolygon } from '../math2d';
import { parseProject, serializeProject } from '../serialization';
import { formatLength, parseLength } from '../units';

describe('math2d', () => {
  const sq = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  it('computes area, orientation, centroid and containment', () => {
    expect(signedArea(sq)).toBe(100);
    expect(polygonArea([...sq].reverse())).toBe(100);
    expect(centroid(sq)).toEqual({ x: 5, y: 5 });
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
  it('simplifies collinear vertices', () => {
    expect(simplifyPolygon([...sq.slice(0, 1), { x: 5, y: 0 }, ...sq.slice(1)])).toHaveLength(4);
  });
});

describe('units', () => {
  it('parses metric and imperial lengths', () => {
    expect(parseLength('3m')).toBe(3000);
    expect(parseLength('250')).toBe(250);
    expect(parseLength('30cm')).toBe(300);
    expect(parseLength(`10'-6"`)).toBeCloseTo(3200.4);
    expect(parseLength('12', 'imperial')).toBeCloseTo(304.8);
    expect(parseLength('abc')).toBeNull();
  });
  it('formats lengths', () => {
    expect(formatLength(3200)).toBe('3.20 m');
    expect(formatLength(250)).toBe('250 mm');
    expect(formatLength(3200.4, 'imperial')).toBe(`10'-6"`);
  });
});

describe('catalog', () => {
  it('has unique ids and a valid default hotbar', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of DEFAULT_HOTBAR) expect(getCatalogItem(id)).toBeDefined();
  });
  it('creates elements from catalog items', () => {
    const el = createFromCatalog('wall-brick', 'lvl');
    expect(el).toMatchObject({ type: 'wall', thickness: 230, materialId: 'brick-red' });
    const light = createFromCatalog('furn-ceiling-light', 'lvl');
    expect(light).toMatchObject({ type: 'furniture', catalogId: 'ceiling-light', elevation: 2550 });
    expect(createFromCatalog('tool-select', 'lvl')).toBeUndefined();
  });
});

describe('serialization', () => {
  it('round-trips the sample project', () => {
    const p = createSampleProject();
    const back = parseProject(serializeProject(p));
    expect(back.levels).toEqual(p.levels);
    expect(Object.keys(back.elements).sort()).toEqual(Object.keys(p.elements).sort());
  });
  it('rejects garbage', () => {
    expect(() => parseProject('nope')).toThrow();
    expect(() => parseProject('{"levels":[]}')).toThrow();
  });
});

describe('baseline geometry', () => {
  it('builds non-empty finite meshes for the sample house', () => {
    const geo = buildProjectGeometry(createSampleProject());
    expect(geo.length).toBeGreaterThan(20);
    for (const g of geo)
      for (const part of g.parts) {
        expect(part.mesh.indices.length % 3).toBe(0);
        expect(part.mesh.positions.every(Number.isFinite)).toBe(true);
      }
  });
});
