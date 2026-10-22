/** MeshData (geometry module) → THREE.BufferGeometry, with validation so bad data never reaches WebGL. */
import * as THREE from 'three';
import type { Element } from '../core/types';
import type { MeshData, PartRole } from '../geometry';

let warned = false;

function allFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

/** Convert a mesh; returns null for empty or invalid data (non-finite positions, bad indices). */
export function toBufferGeometry(m: MeshData): THREE.BufferGeometry | null {
  const vCount = m.positions.length / 3;
  if (!vCount || !m.indices.length || m.positions.length % 3 !== 0 || !allFinite(m.positions)) {
    if (vCount && !warned) {
      warned = true;
      console.warn('view3d: skipped a mesh with invalid positions');
    }
    return null;
  }
  for (let i = 0; i < m.indices.length; i++) {
    if (m.indices[i] >= vCount) {
      if (!warned) {
        warned = true;
        console.warn('view3d: skipped a mesh with out-of-range indices');
      }
      return null;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  if (m.normals.length === m.positions.length && allFinite(m.normals)) g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  if (m.uvs.length === vCount * 2 && allFinite(m.uvs)) g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Faces that coincide with structural surfaces get a polygon offset so they win the depth test. */
export function wantsRaise(el: Element, role: PartRole): boolean {
  if (role === 'finish') return true;
  return el.type === 'slab' && (el.kind === 'floor' || el.kind === 'terrace');
}
