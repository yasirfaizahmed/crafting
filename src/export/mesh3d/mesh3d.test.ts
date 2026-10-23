// @vitest-environment jsdom
import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { buildProjectGeometry } from '../../geometry';
import { exportGLB, exportGLTF, exportOBJ, exportSTL } from '../mesh3d';
import { buildExportScene, elementNodeName } from './scene';

const project = createSampleProject();
const env = { activeLevelId: project.levels[0].id };

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

async function bytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

const physical = Object.values(project.elements).filter((e) => !['room', 'dimension', 'label'].includes(e.type) && !e.hidden);
const geometry = buildProjectGeometry(project, (e) => !['room', 'dimension', 'label'].includes(e.type));
const partCount = geometry.reduce((s, g) => s + g.parts.length, 0);
const triCount = geometry.reduce((s, g) => s + g.parts.reduce((t, p) => t + p.mesh.indices.length / 3, 0), 0);
const vertCount = geometry.reduce((s, g) => s + g.parts.reduce((t, p) => t + p.mesh.positions.length / 3, 0), 0);

describe('buildExportScene', () => {
  const scene = buildExportScene(project);

  it('groups elements by level with element metadata', () => {
    expect(scene.name).toBe('Sample House');
    expect(scene.children.map((c) => c.name)).toEqual(project.levels.map((l) => l.name));
    expect(scene.children.map((c) => c.userData.levelId)).toEqual(project.levels.map((l) => l.id));
    const elementNodes = scene.children.flatMap((l) => l.children);
    expect(elementNodes).toHaveLength(physical.length);
    for (const n of elementNodes) {
      const el = project.elements[n.userData.elementId as string];
      expect(el).toBeDefined();
      expect(n.name).toBe(elementNodeName(el));
      expect(n.userData.type).toBe(el.type);
      expect(n.userData.levelId).toBe(el.levelId);
    }
    const wall = elementNodes.find((n) => n.userData.type === 'wall')!;
    expect(wall.name).toMatch(/^Wall /);
    const sofa = elementNodes.find((n) => n.userData.catalogId === 'sofa-3')!;
    expect(sofa.userData.catalogName).toBe('Sofa — 3 Seat');
  });

  it('creates one PBR material per Crafting material', () => {
    const ms = meshes(scene);
    expect(ms).toHaveLength(partCount);
    const mats = new Set(ms.map((m) => m.material as MeshStandardMaterial));
    for (const m of mats) expect(m).toBeInstanceOf(MeshStandardMaterial);
    const glass = [...mats].find((m) => m.userData.materialId === 'glass-clear')!;
    expect(glass.name).toBe('Glass — Clear');
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(0.5);
    const brick = [...mats].find((m) => m.userData.materialId === 'brick-red')!;
    expect(brick.color.getHexString()).toBe('a4502f');
    expect(new Set([...mats].map((m) => m.userData.materialId)).size).toBe(mats.size);
  });

  it('honours level and furniture options', () => {
    const s = buildExportScene(project, { levelIds: [project.levels[1].id], includeFurniture: false });
    expect(s.children).toHaveLength(1);
    expect(s.children[0].children.some((c) => c.userData.type === 'furniture')).toBe(false);
    expect(s.children[0].children.some((c) => c.userData.type === 'roof')).toBe(true);
  });
});

describe('glTF / GLB', () => {
  it('writes a valid GLB container with nodes, meshes and materials', async () => {
    const blob = await exportGLB(project, {}, env);
    expect(blob.type).toBe('model/gltf-binary');
    const buf = await bytes(blob);
    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // 'glTF'
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(buf.byteLength);
    const jsonLen = dv.getUint32(12, true);
    expect(dv.getUint32(16, true)).toBe(0x4e4f534a); // 'JSON'
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    expect(dv.getUint32(20 + jsonLen + 4, true)).toBe(0x004e4942); // 'BIN\0'
    expect(json.asset.version).toBe('2.0');
    expect(json.meshes).toHaveLength(partCount);
    const nodeWithMesh = json.nodes.filter((n: { mesh?: number }) => n.mesh !== undefined);
    expect(nodeWithMesh).toHaveLength(partCount);
    const matIds = new Set(geometry.flatMap((g) => g.parts.map((p) => p.materialId)));
    expect(json.materials).toHaveLength(matIds.size);
    expect(json.materials.some((m: { name: string }) => m.name === 'Brick — Red')).toBe(true);
    const glass = json.materials.find((m: { name: string }) => m.name === 'Glass — Clear');
    expect(glass.alphaMode).toBe('BLEND');
    expect(glass.pbrMetallicRoughness.baseColorFactor[3]).toBeLessThan(0.5);
    const extras = json.nodes.map((n: { extras?: { elementId?: string } }) => n.extras?.elementId).filter(Boolean);
    expect(new Set(extras).size).toBe(physical.length);
    expect(json.nodes.find((n: { name: string }) => n.name === 'Ground Floor').extras.levelId).toBe(project.levels[0].id);
    // The ceiling light became a punctual light.
    expect(json.extensions?.KHR_lights_punctual?.lights?.length).toBeGreaterThanOrEqual(1);
  });

  it('writes self-contained glTF JSON with embedded buffers', async () => {
    const blob = await exportGLTF(project, { levelIds: [project.levels[0].id] }, env);
    expect(blob.type).toBe('model/gltf+json');
    const json = JSON.parse(new TextDecoder().decode(await bytes(blob)));
    expect(json.asset.version).toBe('2.0');
    expect(json.buffers).toHaveLength(1);
    expect(json.buffers[0].uri).toMatch(/^data:application\/octet-stream;base64,/);
    expect(json.scenes[0].nodes.length).toBeGreaterThan(0);
    expect(json.nodes.some((n: { name: string }) => n.name === 'First Floor')).toBe(false);
  });
});

describe('OBJ', () => {
  it('writes every vertex and face with groups and material names', async () => {
    const text = new TextDecoder().decode(await bytes(await exportOBJ(project, {}, env)));
    const lines = text.split('\n');
    expect(lines[0]).toBe('# Crafting OBJ export');
    expect(lines.filter((l) => l.startsWith('v ')).length).toBe(vertCount);
    expect(lines.filter((l) => l.startsWith('f ')).length).toBe(triCount);
    expect(lines.filter((l) => l.startsWith('o ')).length).toBe(partCount);
    const groups = lines.filter((l) => l.startsWith('g '));
    expect(groups.length).toBe(partCount);
    expect(groups.some((g) => g.startsWith('g Ground_Floor Wall_'))).toBe(true);
    expect(groups.some((g) => g.startsWith('g First_Floor Roof_'))).toBe(true);
    expect(lines.some((l) => l === 'usemtl brick-red')).toBe(true);
    // Object names are unique and whitespace-free.
    const names = lines.filter((l) => l.startsWith('o ')).map((l) => l.slice(2));
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^\S+$/);
    // Metres, Y up: walls on the ground floor reach 3 m.
    const ys = lines.filter((l) => l.startsWith('v ')).map((l) => Number(l.split(' ')[2]));
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...ys)).toBeLessThan(20);
  });
});

describe('STL', () => {
  it('writes binary STL in millimetres, Z up', async () => {
    const buf = await bytes(await exportSTL(project, {}, env));
    const dv = new DataView(buf);
    const header = new TextDecoder().decode(new Uint8Array(buf, 0, 80));
    expect(header.startsWith('solid')).toBe(false);
    expect(header).toContain('units: mm');
    const n = dv.getUint32(80, true);
    expect(n).toBe(triCount);
    expect(buf.byteLength).toBe(84 + 50 * n);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < n; t++) {
      for (let v = 0; v < 3; v++) {
        for (let k = 0; k < 3; k++) {
          const x = dv.getFloat32(84 + t * 50 + 12 + v * 12 + k * 4, true);
          min[k] = Math.min(min[k], x);
          max[k] = Math.max(max[k], x);
        }
      }
    }
    // Expected bounds from the geometry module (world m, Y up) mapped to plan mm, Z up.
    const emin = [Infinity, Infinity, Infinity];
    const emax = [-Infinity, -Infinity, -Infinity];
    for (const g of geometry)
      for (const p of g.parts)
        for (let i = 0; i < p.mesh.positions.length; i += 3) {
          const q = [p.mesh.positions[i] * 1000, -p.mesh.positions[i + 2] * 1000, p.mesh.positions[i + 1] * 1000];
          for (let k = 0; k < 3; k++) {
            emin[k] = Math.min(emin[k], q[k]);
            emax[k] = Math.max(emax[k], q[k]);
          }
        }
    for (let k = 0; k < 3; k++) {
      expect(min[k]).toBeCloseTo(emin[k], 0);
      expect(max[k]).toBeCloseTo(emax[k], 0);
    }
    // The foundation slab bottom is 300 mm below the ground floor; the house is ~12 m long.
    expect(min[2]).toBeCloseTo(-300, 0);
    expect(max[0] - min[0]).toBeGreaterThan(12_000);
  });

  it('respects the level filter', async () => {
    const buf = await bytes(await exportSTL(project, { levelIds: [project.levels[1].id], includeFurniture: false }, env));
    const dv = new DataView(buf);
    let minZ = Infinity;
    for (let t = 0; t < dv.getUint32(80, true); t++) for (let v = 0; v < 3; v++) minZ = Math.min(minZ, dv.getFloat32(84 + t * 50 + 12 + v * 12 + 8, true));
    expect(minZ).toBeGreaterThanOrEqual(3000 - 250 - 1);
  });
});
