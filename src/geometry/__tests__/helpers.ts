import { expect } from 'vitest';
import { createElement, createProject } from '../../core/defaults';
import type { Element, ElementOfType, ElementType, Project } from '../../core/types';
import type { GeometryPart, MeshData } from '../types';

/** Signed volume (mm³) of a closed, outward-wound mesh (divergence theorem). */
export function signedVolume(m: MeshData): number {
  const p = m.positions;
  let v = 0;
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.indices[i] * 3;
    const b = m.indices[i + 1] * 3;
    const c = m.indices[i + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return (v / 6) * 1e9;
}

export const volumeOf = (parts: GeometryPart[]): number => parts.reduce((s, p) => s + signedVolume(p.mesh), 0);

/** Structural mesh checks: finite data, indices in range, unit normals, matching attribute sizes. */
export function expectValidMesh(m: MeshData): void {
  const n = m.positions.length / 3;
  expect(m.positions.length % 3).toBe(0);
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.uvs.length).toBe(n * 2);
  expect(m.indices.length % 3).toBe(0);
  expect(m.indices.length).toBeGreaterThan(0);
  let bad = 0;
  for (let i = 0; i < m.positions.length; i++) if (!Number.isFinite(m.positions[i])) bad++;
  for (let i = 0; i < m.uvs.length; i++) if (!Number.isFinite(m.uvs[i])) bad++;
  for (let i = 0; i < m.indices.length; i++) if (m.indices[i] >= n) bad++;
  for (let i = 0; i < m.normals.length; i += 3) {
    const l = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
    if (!(Math.abs(l - 1) < 1e-3)) bad++;
  }
  expect(bad).toBe(0);
}

export function expectValidParts(parts: GeometryPart[]): void {
  for (const p of parts) {
    expectValidMesh(p.mesh);
    expect(typeof p.materialId).toBe('string');
  }
}

export interface PlanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Bounds of parts in PLAN millimetres (x east, y north, z elevation). */
export function planBounds(parts: GeometryPart[]): PlanBounds {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * 1000;
      const z = p[i + 1] * 1000;
      const y = -p[i + 2] * 1000;
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
  }
  return b;
}

export function expectWithin(b: PlanBounds, e: PlanBounds, tol = 1): void {
  expect(b.minX).toBeGreaterThanOrEqual(e.minX - tol);
  expect(b.maxX).toBeLessThanOrEqual(e.maxX + tol);
  expect(b.minY).toBeGreaterThanOrEqual(e.minY - tol);
  expect(b.maxY).toBeLessThanOrEqual(e.maxY + tol);
  expect(b.minZ).toBeGreaterThanOrEqual(e.minZ - tol);
  expect(b.maxZ).toBeLessThanOrEqual(e.maxZ + tol);
}

/**
 * Number of directed edges without an opposite partner after welding vertices: 0 for a watertight,
 * consistently wound (edge-manifold) surface. Positions are welded on a 0.01 mm grid.
 */
export function openEdges(parts: GeometryPart[]): number {
  const tol = 2e-5; // metres
  const cells = new Map<string, { x: number; y: number; z: number; id: number }[]>();
  let next = 0;
  const id = (x: number, y: number, z: number) => {
    const cx = Math.floor(x / tol);
    const cy = Math.floor(y / tol);
    const cz = Math.floor(z / tol);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          for (const v of cells.get(`${cx + i},${cy + j},${cz + k}`) ?? [])
            if (Math.abs(v.x - x) <= tol && Math.abs(v.y - y) <= tol && Math.abs(v.z - z) <= tol) return v.id;
        }
    const key = `${cx},${cy},${cz}`;
    const v = { x, y, z, id: next++ };
    const list = cells.get(key);
    if (list) list.push(v);
    else cells.set(key, [v]);
    return v.id;
  };
  const count = new Map<string, number>();
  for (const part of parts) {
    const m = part.mesh;
    const vid = Array.from({ length: m.positions.length / 3 }, (_, i) => id(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]));
    for (let t = 0; t < m.indices.length; t += 3) {
      const tri = [vid[m.indices[t]], vid[m.indices[t + 1]], vid[m.indices[t + 2]]];
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
      for (let e = 0; e < 3; e++) {
        const a = tri[e];
        const b = tri[(e + 1) % 3];
        const k = `${a}>${b}`;
        const r = `${b}>${a}`;
        const rc = count.get(r) ?? 0;
        if (rc > 0) count.set(r, rc - 1);
        else count.set(k, (count.get(k) ?? 0) + 1);
      }
    }
  }
  let open = 0;
  for (const c of count.values()) open += c;
  return open;
}

/** Fresh single-level project (elevation 0, height 3000) plus helpers to add elements. */
export function testProject(): { project: Project; levelId: string; add: <T extends ElementType>(type: T, props: Partial<Omit<ElementOfType<T>, 'type' | 'id'>>) => ElementOfType<T> } {
  const project = createProject('Test');
  const levelId = project.levels[0].id;
  const add = <T extends ElementType>(type: T, props: Partial<Omit<ElementOfType<T>, 'type' | 'id'>>): ElementOfType<T> => {
    const el = createElement(type, levelId, props);
    project.elements[el.id] = el as Element;
    return el;
  };
  return { project, levelId, add };
}
