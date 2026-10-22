import type { PaperSize } from '../drawing/types';
import type { Project } from '../core/types';
import type { ViewportHandle } from '../view3d/types';

export type ExportFormat = 'craft' | 'ifc' | 'glb' | 'gltf' | 'obj' | 'stl' | 'dxf' | 'svg' | 'pdf' | 'png-plan' | 'png-3d';

export interface ExportOptions {
  /** Levels to include. 2D formats default to the active level; 3D/IFC default to all levels. */
  levelIds?: string[];
  /** Drawing scale denominator for 2D outputs (100 = 1:100). */
  scale?: number;
  paper?: PaperSize;
  orientation?: 'landscape' | 'portrait';
  includeFurniture?: boolean;
  includeAnnotations?: boolean;
  /** Raster outputs: output size in px. */
  width?: number;
  height?: number;
  /** 2D raster resolution in dots per inch on paper. */
  dpi?: number;
}

export interface ExportEnv {
  activeLevelId: string;
  /** Present in the browser app; required for 'png-3d'. */
  viewport?: ViewportHandle;
}

export interface Exporter {
  format: ExportFormat;
  label: string;
  extension: string;
  mime: string;
  /** Short description for the export dialog. */
  description: string;
  kind: '3d' | '2d' | 'bim' | 'project' | 'image';
  run(project: Project, options: ExportOptions, env: ExportEnv): Promise<Blob>;
}
