/**
 * Minecraft-style blocks: box, cylinder, wedge (ramp rising toward local +x) and sphere, inscribed
 * in the block's size, placed at its min corner and rotated about that corner.
 */
import { getMaterial, materialFor } from '../core/materials';
import type { Block } from '../core/types';
import { levelElevation } from './cache';
import { Model, placement } from './model';
import type { GeometryContext, GeometryPart } from './types';

export const BLOCK_ROUND_SEGMENTS = 24;
export const BLOCK_SPHERE_RINGS = 12;

export function buildBlock(ctx: GeometryContext, b: Block): GeometryPart[] {
  const { x: sx, y: sy, z: sz } = b.size;
  if (!(sx > 0) || !(sy > 0) || !(sz > 0)) return [];
  const mat = materialFor(b).id;
  const role = getMaterial(mat).category === 'glass' ? 'glass' : 'body';
  const m = new Model(placement(b.position.x, b.position.y, levelElevation(ctx, b.levelId) + b.position.z, b.rotation), mat, role);
  switch (b.shape) {
    case 'cylinder':
      m.cylinder(sx / 2, sy / 2, 0, sz, sx / 2, BLOCK_ROUND_SEGMENTS, sx / 2, sy / 2);
      break;
    case 'wedge':
      m.prismY(
        [
          [0, 0],
          [sx, 0],
          [sx, sz],
        ],
        0,
        sy,
      );
      break;
    case 'sphere':
      m.sphere(sx / 2, sy / 2, sz / 2, sx / 2, sy / 2, sz / 2, BLOCK_ROUND_SEGMENTS, BLOCK_SPHERE_RINGS);
      break;
    default:
      m.box(0, 0, 0, sx, sy, sz);
  }
  return m.parts();
}
