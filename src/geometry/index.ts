/**
 * Element → 3D geometry. Public API of the geometry module:
 *
 *   const gctx = createGeometryContext(project);
 *   const geo  = buildElementGeometry(gctx, element);   // ElementGeometry (world metres, Y up)
 *
 * Every element type returns parts tagged with a materialId and role. Annotation-only types
 * (dimension, label, room) return no parts.
 *
 * NOTE: This is the phase-0 baseline (simple prisms). The geometry module owner replaces the
 * per-type builders with full implementations (openings cut into walls, pitched roofs, detailed
 * stairs, parametric furniture…) WITHOUT changing these exported signatures.
 */
import { getFurniture } from '../core/catalog';
import { MM_TO_M } from '../core/coords';
import { add, angleDeg, distance, midpoint, rotate, scale, sub } from '../core/math2d';
import { DEFAULT_MATERIAL_FOR, materialFor } from '../core/materials';
import type { Element, Project } from '../core/types';
import {
  computeWallFootprints,
  getLevel,
  pointAtOffset,
  wallBaseElevation,
  wallCenterOffset,
  wallDirection,
  wallHeight,
  type WallFootprint,
} from '../core/walls';
import { MeshBuilder } from './mesh';
import type { ElementGeometry, GeometryContext, GeometryPart } from './types';

export * from './types';
export { MeshBuilder, meshBounds, emptyMesh } from './mesh';

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

const levelElev = (ctx: GeometryContext, levelId: string) => getLevel(ctx.project, levelId)?.elevation ?? 0;
const levelHeight = (ctx: GeometryContext, levelId: string) => getLevel(ctx.project, levelId)?.height ?? 3000;

function part(mb: MeshBuilder, materialId: string, role: GeometryPart['role'] = 'body', name?: string): GeometryPart[] {
  return mb.isEmpty ? [] : [{ mesh: mb.build(), materialId, role, name }];
}

export function buildElementGeometry(ctx: GeometryContext, el: Element): ElementGeometry {
  const out: ElementGeometry = { elementId: el.id, parts: [], lights: [] };
  if (el.hidden) return out;
  const mat = materialFor(el).id;
  const z0 = levelElev(ctx, el.levelId);
  switch (el.type) {
    case 'wall': {
      const fp = ctx.footprints(el.levelId).get(el.id);
      if (!fp) break;
      const mb = new MeshBuilder();
      const base = wallBaseElevation(ctx.project, el);
      mb.addExtrusion(fp.polygon, base, base + wallHeight(ctx.project, el));
      out.parts = part(mb, mat);
      break;
    }
    case 'door':
    case 'window': {
      const host = ctx.project.elements[el.hostId];
      if (!host || host.type !== 'wall') break;
      const c = pointAtOffset(host, el.offset, wallCenterOffset(host));
      const deg = angleDeg(wallDirection(host));
      const base = wallBaseElevation(ctx.project, host) + el.sill;
      const mb = new MeshBuilder();
      mb.addPlanBox(c, el.width, el.type === 'window' ? 40 : 50, base, el.height, deg);
      out.parts = part(mb, el.type === 'window' ? 'glass-clear' : mat, el.type === 'window' ? 'glass' : 'panel');
      break;
    }
    case 'slab': {
      if (el.outline.length < 3) break;
      const mb = new MeshBuilder();
      const top = z0 + el.topOffset;
      mb.addExtrusion(el.outline, top - el.thickness, top, el.holes ?? []);
      out.parts = part(mb, mat);
      break;
    }
    case 'roof': {
      if (el.outline.length < 3) break;
      const mb = new MeshBuilder();
      const eave = z0 + (el.baseOffset ?? levelHeight(ctx, el.levelId));
      mb.addExtrusion(el.outline, eave, eave + el.thickness);
      out.parts = part(mb, mat);
      break;
    }
    case 'stair': {
      const rise = el.rise ?? levelHeight(ctx, el.levelId);
      const n = Math.max(1, Math.ceil(rise / el.maxRiser));
      const riser = rise / n;
      const dir = { x: Math.cos((el.rotation * Math.PI) / 180), y: Math.sin((el.rotation * Math.PI) / 180) };
      const mb = new MeshBuilder();
      for (let i = 0; i < n; i++) {
        const c = add(el.position, scale(dir, el.tread * (i + 0.5)));
        mb.addPlanBox(c, el.tread, el.width, z0, riser * (i + 1), el.rotation);
      }
      out.parts = part(mb, mat);
      break;
    }
    case 'column': {
      const mb = new MeshBuilder();
      const h = el.height ?? levelHeight(ctx, el.levelId);
      mb.addPlanBox(el.position, el.width, el.depth, z0 + el.baseOffset, h, el.rotation);
      out.parts = part(mb, mat);
      break;
    }
    case 'beam': {
      const len = distance(el.start, el.end);
      if (len < 1) break;
      const top = z0 + (el.topOffset ?? levelHeight(ctx, el.levelId));
      const mb = new MeshBuilder();
      mb.addPlanBox(midpoint(el.start, el.end), len, el.width, top - el.depth, el.depth, angleDeg(sub(el.end, el.start)));
      out.parts = part(mb, mat);
      break;
    }
    case 'furniture': {
      const def = getFurniture(el.catalogId);
      const wdt = el.width ?? def?.width ?? 1000;
      const dep = el.depth ?? def?.depth ?? 1000;
      const hgt = el.height ?? def?.height ?? 1000;
      const mb = new MeshBuilder();
      mb.addPlanBox(el.position, wdt, dep, z0 + el.elevation, hgt, el.rotation);
      out.parts = part(mb, el.materialId ?? def?.materialId ?? DEFAULT_MATERIAL_FOR.furniture);
      if (def?.light) {
        out.lights.push({
          position: [el.position.x * MM_TO_M, (z0 + el.elevation + hgt * 0.5) * MM_TO_M, -el.position.y * MM_TO_M],
          ...def.light,
        });
      }
      break;
    }
    case 'block': {
      const mb = new MeshBuilder();
      const c = add({ x: el.position.x, y: el.position.y }, rotate({ x: el.size.x / 2, y: el.size.y / 2 }, el.rotation));
      mb.addPlanBox(c, el.size.x, el.size.y, z0 + el.position.z, el.size.z, el.rotation);
      out.parts = part(mb, mat);
      break;
    }
    case 'railing': {
      const mb = new MeshBuilder();
      for (let i = 0; i + 1 < el.path.length; i++) {
        const a = el.path[i];
        const b = el.path[i + 1];
        const len = distance(a, b);
        if (len < 1) continue;
        mb.addPlanBox(midpoint(a, b), len, 50, z0 + el.baseOffset + el.height - 50, 50, angleDeg(sub(b, a)));
      }
      out.parts = part(mb, mat);
      break;
    }
    case 'room':
    case 'dimension':
    case 'label':
      break;
  }
  return out;
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
