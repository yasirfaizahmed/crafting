/**
 * Raycast picking: element meshes first, then the active level's floor plane, then the ground.
 * Results are converted to plan coordinates (mm) with a plan-space normal for the tools.
 */
import * as THREE from 'three';
import { M_TO_MM } from '../core/coords';
import type { Project, Vec2 } from '../core/types';
import { groundLevel } from './tools/levels';
import type { PickHit } from './tools/types';

/** Maximum pick distance, metres. */
export const PICK_REACH = 600;

export class Picker {
  readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly n = new THREE.Vector3();

  constructor() {
    this.raycaster.far = PICK_REACH;
  }

  /** Aim the ray through normalised device coordinates (−1..1). */
  aim(camera: THREE.Camera, ndcX: number, ndcY: number): THREE.Ray {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.ray;
  }

  /** Pick along the current ray. */
  pick(meshes: THREE.Object3D[], project: Project, activeLevelId: string): PickHit | null {
    const ray = this.raycaster.ray;
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      if (!h.face) continue;
      const id = h.object.userData.elementId as string | undefined;
      const el = id ? project.elements[id] : undefined;
      if (!el) continue;
      this.n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
      if (this.n.dot(ray.direction) > 0) this.n.negate();
      return {
        elementId: el.id,
        point: { x: h.point.x * M_TO_MM, y: -h.point.z * M_TO_MM },
        elevation: h.point.y * M_TO_MM,
        normal: { x: this.n.x, y: -this.n.z, z: this.n.y },
        levelId: el.levelId,
        kind: 'element',
        distance: h.distance,
        materialId: h.object.userData.materialId as string | undefined,
      };
    }
    const active = project.levels.find((l) => l.id === activeLevelId);
    // A storey at ground height is just the ground.
    if (active && active.elevation !== 0) {
      const hit = this.planeHit(active.elevation);
      if (hit) return { point: hit.point, elevation: active.elevation, normal: { x: 0, y: 0, z: 1 }, levelId: active.id, kind: 'floor', distance: hit.distance };
    }
    const ground = groundLevel(project);
    const g = this.planeHit(0);
    if (g) return { point: g.point, elevation: 0, normal: { x: 0, y: 0, z: 1 }, levelId: ground.id, kind: 'ground', distance: g.distance };
    return null;
  }

  /** Intersection of the current ray with the horizontal plane at `elevationMm`, seen from above. */
  planeHit(elevationMm: number): { point: Vec2; distance: number } | null {
    const ray = this.raycaster.ray;
    const y = elevationMm / M_TO_MM;
    if (ray.direction.y > -1e-6 || ray.origin.y <= y) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t <= 0 || t > PICK_REACH) return null;
    return { point: { x: (ray.origin.x + ray.direction.x * t) * M_TO_MM, y: -(ray.origin.z + ray.direction.z * t) * M_TO_MM }, distance: t };
  }

  /** Intersection with a horizontal plane from either side (drag planes). */
  planePoint(elevationMm: number): Vec2 | null {
    const ray = this.raycaster.ray;
    const y = elevationMm / M_TO_MM;
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t <= 0 || t > PICK_REACH * 2) return null;
    return { x: (ray.origin.x + ray.direction.x * t) * M_TO_MM, y: -(ray.origin.z + ray.direction.z * t) * M_TO_MM };
  }
}
