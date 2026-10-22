/**
 * Light fixtures → a capped pool of PointLights (the active storey first, then nearest to the
 * camera). Fixtures beyond the cap still glow through their emissive materials.
 */
import * as THREE from 'three';
import type { SceneLight } from './model';

export const MAX_POINT_LIGHTS = 12;
/** Catalog intensities are relative; scale to three.js candela with gentle decay. */
const INTENSITY_SCALE = 2.2;

/** Pick up to `max` lights: active level first, then by distance to `eye` (world metres). */
export function chooseLights(lights: SceneLight[], activeLevelId: string, eye: { x: number; y: number; z: number }, max = MAX_POINT_LIGHTS): SceneLight[] {
  const d2 = (l: SceneLight) => {
    const [x, y, z] = l.def.position;
    return (x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2;
  };
  return [...lights]
    .sort((a, b) => {
      const pa = a.levelId === activeLevelId ? 0 : 1;
      const pb = b.levelId === activeLevelId ? 0 : 1;
      return pa - pb || d2(a) - d2(b);
    })
    .slice(0, max);
}

export class FixtureLights {
  readonly group = new THREE.Group();
  private pool: THREE.PointLight[] = [];

  constructor() {
    this.group.name = 'fixture-lights';
  }

  get count(): number {
    return this.pool.length;
  }

  update(lights: SceneLight[], activeLevelId: string, eye: THREE.Vector3): void {
    const chosen = chooseLights(lights, activeLevelId, eye);
    while (this.pool.length > chosen.length) {
      const l = this.pool.pop()!;
      this.group.remove(l);
      l.dispose();
    }
    while (this.pool.length < chosen.length) {
      const l = new THREE.PointLight('#ffffff', 1, 5, 1.6);
      l.castShadow = false;
      this.pool.push(l);
      this.group.add(l);
    }
    chosen.forEach((s, i) => {
      const l = this.pool[i];
      l.position.set(...s.def.position);
      l.color.set(s.def.color);
      l.intensity = s.def.intensity * INTENSITY_SCALE;
      l.distance = s.def.distance;
    });
  }

  dispose(): void {
    for (const l of this.pool) l.dispose();
    this.pool = [];
    this.group.clear();
  }
}
