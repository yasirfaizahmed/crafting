import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../app/sample';
import { getMaterial, MATERIALS } from '../core/materials';
import type { Element } from '../core/types';
import { sunDirection } from './environment';
import { describeElement } from './info';
import { chooseLights } from './lights';
import { MaterialLibrary, textureRepeat } from './materials';
import { toBufferGeometry, wantsRaise } from './meshes';
import { canvas2DSupported, drawPattern, hashString, mulberry32, parseHex, PROCEDURAL_PATTERNS } from './textures';

describe('materials', () => {
  it('texture repeat follows the material pattern size (UVs are metres)', () => {
    expect(textureRepeat(getMaterial('brick-red'))).toBeCloseTo(1000 / 450);
    expect(textureRepeat(getMaterial('tile-blue'))).toBe(10);
  });

  it('falls back to flat colours without a 2D canvas and caches materials', () => {
    expect(canvas2DSupported()).toBe(false);
    expect(drawPattern(getMaterial('brick-red'))).toBeNull();
    const lib = new MaterialLibrary();
    const brick = lib.get('brick-red');
    expect(brick.map).toBeNull();
    expect(brick.color.getHexString()).toBe(new THREE.Color('#a4502f').getHexString());
    expect(lib.get('brick-red')).toBe(brick);
    expect(lib.get('brick-red', { highlight: 'hover' })).toBe(lib.get('brick-red', { highlight: 'hover' }));
    expect(lib.get('brick-red', { highlight: 'hover' })).not.toBe(brick);
    lib.dispose();
  });

  it('glass is transparent without depth writes; lights are emissive', () => {
    const lib = new MaterialLibrary({ textures: false });
    const glass = lib.get('glass-clear');
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(glass.opacity).toBeCloseTo(0.28);
    expect(lib.isTransparent('glass-clear')).toBe(true);
    const light = lib.get('light-warm');
    expect(light.emissiveIntensity).toBeGreaterThan(1);
    expect(light.emissive.getHex()).not.toBe(0);
    const x = lib.get('plaster-white', { xray: true });
    expect(x.transparent && !x.depthWrite).toBe(true);
    const r = lib.get('wood-floor-oak', { raised: true });
    expect(r.polygonOffset).toBe(true);
    const g = lib.get('wood-oak', { ghost: true });
    expect(g.transparent).toBe(true);
    expect(lib.size).toBeGreaterThan(5);
    lib.dispose();
  });

  it('every material resolves and every textured pattern has a drawer', () => {
    const lib = new MaterialLibrary({ textures: false });
    for (const m of MATERIALS) expect(lib.get(m.id).name).toBe(m.id);
    for (const m of MATERIALS) if (m.pattern !== 'none') expect(PROCEDURAL_PATTERNS).toContain(m.pattern);
    lib.dispose();
  });

  it('deterministic helpers', () => {
    expect(hashString('brick-red')).toBe(hashString('brick-red'));
    expect(hashString('a')).not.toBe(hashString('b'));
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    const seq = [r1(), r1(), r1()];
    expect([r2(), r2(), r2()]).toEqual(seq);
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(parseHex('#a4502f')).toEqual([164, 80, 47]);
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
  });
});

describe('mesh conversion', () => {
  const quad = () => ({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  it('converts valid meshes with bounds', () => {
    const g = toBufferGeometry(quad())!;
    expect(g.getAttribute('position').count).toBe(4);
    expect(g.getAttribute('uv').count).toBe(4);
    expect(g.boundingBox!.max.x).toBe(1);
  });

  it('rejects empty, non-finite and out-of-range meshes', () => {
    const empty = { positions: new Float32Array(), normals: new Float32Array(), uvs: new Float32Array(), indices: new Uint32Array() };
    expect(toBufferGeometry(empty)).toBeNull();
    const nan = quad();
    nan.positions[4] = NaN;
    const warn = console.warn;
    console.warn = () => {};
    expect(toBufferGeometry(nan)).toBeNull();
    const bad = quad();
    bad.indices[5] = 9;
    expect(toBufferGeometry(bad)).toBeNull();
    console.warn = warn;
    const noNormals = { ...quad(), normals: new Float32Array() };
    expect(toBufferGeometry(noNormals)!.getAttribute('normal')).toBeDefined();
  });

  it('raises finish parts and floor slabs (coplanar with structure)', () => {
    const p = createSampleProject();
    const floor = Object.values(p.elements).find((e) => e.type === 'slab' && e.kind === 'floor')!;
    const foundation = Object.values(p.elements).find((e) => e.type === 'slab' && e.kind === 'foundation')!;
    expect(wantsRaise(floor, 'body')).toBe(true);
    expect(wantsRaise(foundation, 'body')).toBe(false);
    expect(wantsRaise(foundation, 'finish')).toBe(true);
  });
});

describe('environment and lights', () => {
  it('sun direction follows compass azimuth and altitude', () => {
    const south = sunDirection(180, 0);
    expect(south.x).toBeCloseTo(0, 6);
    expect(south.z).toBeCloseTo(1, 6); // plan south (−y) = world +z
    const east = sunDirection(90, 0);
    expect(east.x).toBeCloseTo(1, 6);
    const noon = sunDirection(0, 90);
    expect(noon.y).toBeCloseTo(1, 6);
    // North angle rotates the compass relative to the plan.
    const rotated = sunDirection(0, 0, 90);
    expect(rotated.x).toBeCloseTo(-1, 6);
  });

  it('chooses at most N lights, active level first then nearest', () => {
    const mk = (id: string, levelId: string, x: number) => ({ elementId: id, levelId, def: { position: [x, 2, 0] as [number, number, number], color: '#fff', intensity: 1, distance: 5 } });
    const lights = [mk('a', 'L2', 1), mk('b', 'L1', 50), mk('c', 'L1', 5), mk('d', 'L2', 0.5)];
    const chosen = chooseLights(lights, 'L1', { x: 0, y: 2, z: 0 }, 3);
    expect(chosen.map((l) => l.elementId)).toEqual(['c', 'b', 'd']);
  });
});

describe('hover info', () => {
  it('describes elements with key dimensions', () => {
    const p = createSampleProject();
    const find = (pred: (e: Element) => boolean) => Object.values(p.elements).find(pred)!;
    const wall = describeElement(p, find((e) => e.type === 'wall' && e.thickness === 250));
    expect(wall.title).toBe('Wall');
    expect(wall.details[0]).toBe('12.00 m long · 250 mm thick');
    expect(wall.details).toContain('Ground Floor');
    const stair = describeElement(p, find((e) => e.type === 'stair'));
    expect(stair.details[0]).toContain('18 risers');
    const sofa = describeElement(p, find((e) => e.type === 'furniture' && e.catalogId === 'sofa-3'));
    expect(sofa.title).toBe('Sofa — 3 Seat');
    expect(sofa.details[0]).toBe('2.20 m × 900 mm × 850 mm');
    const win = describeElement(p, find((e) => e.type === 'window'), 'imperial');
    expect(win.details.some((d) => d.includes("'"))).toBe(true);
  });
});
