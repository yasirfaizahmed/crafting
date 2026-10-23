/**
 * Export scene graph shared by the glTF/GLB, OBJ and STL exporters:
 *
 *   Group "<project>"            userData: project info, units
 *     Group "<level name>"       userData: levelId, elevation, height (mm)
 *       Mesh | Group "<Type> <name|id>"   userData: elementId, type, levelId, props…
 *         Mesh "<…> — <part>"   (multi-material elements)
 *
 * World units are metres, Y up (see core/coords.ts) — the native glTF convention.
 */
import { BufferAttribute, BufferGeometry, Color, DoubleSide, FrontSide, Group, Mesh, MeshStandardMaterial, PointLight, type Object3D } from 'three';
import { getFurniture } from '../../core/catalog';
import { getMaterial } from '../../core/materials';
import type { Element, ElementType, Project } from '../../core/types';
import { buildElementGeometry, createGeometryContext, type GeometryPart, type MeshData } from '../../geometry';
import type { ExportOptions } from '../types';

export interface ExportSceneOptions extends ExportOptions {
  /** Material naming: human-readable names (glTF) or ids (OBJ `usemtl`). Default 'name'. */
  materialNames?: 'name' | 'id';
  /** Add point lights for light fixtures (glTF KHR_lights_punctual). Default false. */
  lights?: boolean;
}

const TYPE_LABEL: Record<ElementType, string> = {
  wall: 'Wall',
  door: 'Door',
  window: 'Window',
  slab: 'Slab',
  roof: 'Roof',
  stair: 'Stair',
  column: 'Column',
  beam: 'Beam',
  furniture: 'Furniture',
  room: 'Room',
  block: 'Block',
  railing: 'Railing',
  dimension: 'Dimension',
  label: 'Label',
};

/** Element types that never produce 3D output. */
const NON_PHYSICAL = new Set<ElementType>(['room', 'dimension', 'label']);

export function elementNodeName(el: Element): string {
  return `${TYPE_LABEL[el.type]} ${el.name || el.id}`;
}

function toBufferGeometry(m: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.positions, 3));
  if (m.normals.length === m.positions.length) g.setAttribute('normal', new BufferAttribute(m.normals, 3));
  if (m.uvs.length * 3 === m.positions.length * 2) g.setAttribute('uv', new BufferAttribute(m.uvs, 2));
  g.setIndex(new BufferAttribute(m.indices, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Caches one MeshStandardMaterial per Crafting material id. */
export class ExportMaterials {
  private cache = new Map<string, MeshStandardMaterial>();

  constructor(private naming: 'name' | 'id' = 'name') {}

  get(materialId: string): MeshStandardMaterial {
    const def = getMaterial(materialId);
    let mat = this.cache.get(def.id);
    if (!mat) {
      const transparent = def.opacity < 1;
      mat = new MeshStandardMaterial({
        name: this.naming === 'id' ? def.id : def.name,
        color: new Color(def.color),
        roughness: def.roughness,
        metalness: def.metalness,
        opacity: def.opacity,
        transparent,
        depthWrite: !transparent,
        side: transparent ? DoubleSide : FrontSide,
      });
      if (def.emissive) {
        mat.emissive = new Color(def.emissive);
        mat.emissiveIntensity = 1;
      }
      mat.userData = { materialId: def.id, category: def.category };
      this.cache.set(def.id, mat);
    }
    return mat;
  }

  get all(): MeshStandardMaterial[] {
    return [...this.cache.values()];
  }
}

function elementUserData(el: Element, levelName: string): Record<string, unknown> {
  const data: Record<string, unknown> = { elementId: el.id, type: el.type, levelId: el.levelId, level: levelName };
  if (el.name) data.name = el.name;
  if (el.materialId) data.materialId = el.materialId;
  if (el.type === 'furniture') {
    data.catalogId = el.catalogId;
    const def = getFurniture(el.catalogId);
    if (def) data.catalogName = def.name;
  }
  if (el.props && Object.keys(el.props).length) data.props = { ...el.props };
  return data;
}

function partMesh(part: GeometryPart, materials: ExportMaterials, name: string): Mesh {
  const mesh = new Mesh(toBufferGeometry(part.mesh), materials.get(part.materialId));
  mesh.name = name;
  mesh.userData = { role: part.role, materialId: part.materialId, ...(part.name ? { part: part.name } : {}) };
  return mesh;
}

/** Build the export scene graph (levels → elements → parts). */
export function buildExportScene(project: Project, options: ExportSceneOptions = {}): Group {
  const root = new Group();
  root.name = project.info.name || 'Project';
  root.userData = {
    generator: 'Crafting',
    projectId: project.id,
    name: project.info.name,
    author: project.info.author,
    description: project.info.description,
    address: project.info.address,
    units: 'metre',
    upAxis: 'Y',
  };
  const materials = new ExportMaterials(options.materialNames ?? 'name');
  const gctx = createGeometryContext(project);
  const includeFurniture = options.includeFurniture ?? true;
  const levels = project.levels.filter((l) => !options.levelIds || options.levelIds.includes(l.id));
  const elements = Object.values(project.elements);

  for (const level of levels) {
    const lg = new Group();
    lg.name = level.name;
    lg.userData = { levelId: level.id, elevation: level.elevation, height: level.height };
    for (const el of elements) {
      if (el.levelId !== level.id || el.hidden || NON_PHYSICAL.has(el.type)) continue;
      if (el.type === 'furniture' && !includeFurniture) continue;
      const geo = buildElementGeometry(gctx, el);
      const parts = geo.parts.filter((p) => p.mesh.indices.length >= 3 && p.mesh.positions.length >= 9);
      const name = elementNodeName(el);
      let node: Object3D | null = null;
      if (parts.length === 1) {
        node = partMesh(parts[0], materials, name);
      } else if (parts.length > 1) {
        const g = new Group();
        g.name = name;
        parts.forEach((p, i) => g.add(partMesh(p, materials, `${name} — ${p.name ?? p.role}${parts.length > 1 ? ` ${i + 1}` : ''}`)));
        node = g;
      }
      if (options.lights && geo.lights.length) {
        if (!node) {
          node = new Group();
          node.name = name;
        }
        for (const l of geo.lights) {
          const light = new PointLight(new Color(l.color), l.intensity, l.distance, 2);
          light.name = `${name} — light`;
          // Lights are in world space; the element node sits at the origin.
          light.position.set(...l.position);
          node.add(light);
        }
      }
      if (!node) continue;
      node.userData = { ...elementUserData(el, level.name), ...node.userData };
      lg.add(node);
    }
    root.add(lg);
  }
  root.updateMatrixWorld(true);
  return root;
}

/** Free GPU-side resources of an export scene (geometries; materials are shared per scene). */
export function disposeExportScene(root: Object3D): void {
  const mats = new Set<MeshStandardMaterial>();
  root.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      mats.add(o.material as MeshStandardMaterial);
    }
  });
  mats.forEach((m) => m.dispose());
}
