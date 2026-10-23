/**
 * Element → 3D geometry. Public API of the geometry module:
 *
 *   const gctx = createGeometryContext(project);
 *   const geo  = buildElementGeometry(gctx, element);   // ElementGeometry (world metres, Y up)
 *
 * Every element type returns parts tagged with a materialId and role. Annotation-only types
 * (dimension, label, room) return no parts. Meshes are flat-shaded, wound counter-clockwise seen
 * from outside, with UVs in metres; builders are deterministic and pure (they run in Node too).
 *
 * One file per element family: walls.ts, openings.ts (doors/windows), slabs.ts, roofs.ts,
 * stairs.ts, structure.ts (columns/beams), railings.ts, blocks.ts, furniture/*.ts. They share the
 * modelling DSL in model.ts and the 2D helpers in poly2d.ts.
 */
import { getMaterial, hasMaterial } from '../core/materials';
import type { Element, Project } from '../core/types';
import { computeWallFootprints, type WallFootprint } from '../core/walls';
import { buildBlock } from './blocks';
import { buildFurniture } from './furniture';
import { buildDoor, buildWindow } from './openings';
import { buildRailing } from './railings';
import { buildRoof } from './roofs';
import { buildSlab } from './slabs';
import { buildStair } from './stairs';
import { buildBeam, buildColumn } from './structure';
import type { ElementGeometry, GeometryContext, GeometryPart } from './types';
import { buildWall } from './walls';

export * from './types';
export { MeshBuilder, meshBounds, emptyMesh } from './mesh';
export { roofPlanes, type RoofLine, type RoofLineKind, type RoofPlane, type RoofPlanes } from './roofs';
export { FURNITURE_HEIGHT_ALLOWANCE, FURNITURE_MODELS } from './furniture';

export function createGeometryContext(project: Project): GeometryContext {
  const cache = new Map<string, Map<string, WallFootprint>>();
  return {
    project,
    footprints(levelId) {
      let fp = cache.get(levelId);
      if (!fp) {
        fp = computeWallFootprints(project, levelId);
        cache.set(levelId, fp);
      }
      return fp;
    },
  };
}

/** Drop parts that are empty or carry non-finite data (defensive: a bad element must not break a scene). */
function sanitize(parts: GeometryPart[]): GeometryPart[] {
  return parts.filter((p) => {
    const m = p.mesh;
    if (!m.indices.length) return false;
    for (let i = 0; i < m.positions.length; i++) if (!Number.isFinite(m.positions[i])) return false;
    for (let i = 0; i < m.uvs.length; i++) if (!Number.isFinite(m.uvs[i])) return false;
    return true;
  });
}

/** Material for the glowing parts of a switched-off light fixture. */
const LIGHT_OFF = 'light-off';

export function buildElementGeometry(ctx: GeometryContext, el: Element): ElementGeometry {
  const out: ElementGeometry = { elementId: el.id, parts: [], lights: [] };
  if (el.hidden) return out;
  try {
    switch (el.type) {
      case 'wall':
        out.parts = buildWall(ctx, el);
        break;
      case 'door':
        out.parts = buildDoor(ctx, el);
        break;
      case 'window':
        out.parts = buildWindow(ctx, el);
        break;
      case 'slab':
        out.parts = buildSlab(ctx, el);
        break;
      case 'roof':
        out.parts = buildRoof(ctx, el);
        break;
      case 'stair':
        out.parts = buildStair(ctx, el);
        break;
      case 'column':
        out.parts = buildColumn(ctx, el);
        break;
      case 'beam':
        out.parts = buildBeam(ctx, el);
        break;
      case 'furniture': {
        const f = buildFurniture(ctx, el);
        out.parts = f.parts;
        out.lights = f.lights.filter((l) => l.position.every(Number.isFinite));
        if (el.lightOn === false) out.lights = [];
        break;
      }
      case 'block':
        out.parts = buildBlock(ctx, el);
        break;
      case 'railing':
        out.parts = buildRailing(ctx, el);
        break;
      case 'room':
      case 'dimension':
      case 'label':
        break;
    }
  } catch (err) {
    // Malformed element data: render nothing for it rather than breaking the whole scene.
    if (typeof console !== 'undefined') console.warn(`[geometry] failed to build ${el.type} ${el.id}`, err);
    out.parts = [];
    out.lights = [];
  }
  out.parts = sanitize(out.parts);
  const overrides = el.partMaterials;
  if (overrides) out.parts = out.parts.map((p) => (overrides[partKey(p)] && hasMaterial(overrides[partKey(p)]) ? { ...p, materialId: overrides[partKey(p)] } : p));
  // A switched-off fixture: glowing parts lose their glow.
  if (el.type === 'furniture' && el.lightOn === false) out.parts = out.parts.map((p) => (p.role === 'light' && getMaterial(p.materialId).emissive ? { ...p, materialId: LIGHT_OFF } : p));
  return out;
}

/** Key of a part for per-part material overrides (Element.partMaterials): its name, else its role. */
export function partKey(p: Pick<GeometryPart, 'name' | 'role'>): string {
  return p.name ?? p.role;
}

/** Build geometry for every element (optionally filtered), sharing one context. */
export function buildProjectGeometry(project: Project, filter?: (el: Element) => boolean): ElementGeometry[] {
  const ctx = createGeometryContext(project);
  const out: ElementGeometry[] = [];
  for (const el of Object.values(project.elements)) {
    if (filter && !filter(el)) continue;
    const g = buildElementGeometry(ctx, el);
    if (g.parts.length || g.lights.length) out.push(g);
  }
  return out;
}
