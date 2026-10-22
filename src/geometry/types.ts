import type { Element, Project } from '../core/types';
import type { WallFootprint } from '../core/walls';

/**
 * Renderer-agnostic triangle mesh in WORLD space: metres, Y up (see core/coords.ts).
 * UVs are in METRES of real surface distance; the 3D view scales textures by the material's
 * patternSize, so 1 uv unit = 1 m.
 */
export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

export type PartRole = 'body' | 'finish' | 'frame' | 'glass' | 'panel' | 'light' | 'detail';

export interface GeometryPart {
  mesh: MeshData;
  materialId: string;
  role: PartRole;
  name?: string;
}

export interface LightDef {
  /** World metres. */
  position: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
}

export interface ElementGeometry {
  elementId: string;
  parts: GeometryPart[];
  lights: LightDef[];
}

/** Per-rebuild cache shared across elements (wall footprints are per level). */
export interface GeometryContext {
  project: Project;
  footprints(levelId: string): Map<string, WallFootprint>;
}

export type ElementGeometryBuilder = (ctx: GeometryContext, el: Element) => ElementGeometry;
