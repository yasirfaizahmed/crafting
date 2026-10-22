import type { Vec2 } from './types';

/**
 * Plan (mm, x east / y north, z up) ⇄ world (three.js metres, Y up) mapping.
 *
 *   world.x =  plan.x / 1000
 *   world.y =  elevation / 1000
 *   world.z = -plan.y / 1000
 *
 * Keeping north = -Z means a top-down camera with up = -Z shows the plan un-mirrored.
 */
export const MM_TO_M = 0.001;
export const M_TO_MM = 1000;

export type WorldTuple = [number, number, number];

export function planToWorld(p: Vec2, elevationMm = 0): WorldTuple {
  return [p.x * MM_TO_M, elevationMm * MM_TO_M, -p.y * MM_TO_M];
}

export function worldToPlan(x: number, _y: number, z: number): Vec2 {
  return { x: x * M_TO_MM, y: -z * M_TO_MM };
}

export const worldYToElevation = (y: number): number => y * M_TO_MM;

/** Plan rotation (deg, CCW from +x seen from above) → rotation about world +Y (radians). */
export const planRotationToWorldY = (deg: number): number => (deg * Math.PI) / 180;
