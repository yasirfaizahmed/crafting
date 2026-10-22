/**
 * Export registry. Each format's implementation lives in its own file; the UI lists EXPORTERS
 * and calls runExport().
 */
import { serializeProject } from '../core/serialization';
import type { Project } from '../core/types';
import { exportDXF } from './dxf';
import { exportIFC } from './ifc';
import { exportGLB, exportGLTF, exportOBJ, exportSTL } from './mesh3d';
import { exportPDF } from './pdf';
import { exportPlanPNG } from './plan-png';
import { exportSVG } from './svg';
import type { ExportEnv, ExportFormat, ExportOptions, Exporter } from './types';

export * from './types';

export const EXPORTERS: Exporter[] = [
  {
    format: 'craft',
    label: 'Crafting Project',
    extension: 'craft',
    mime: 'application/json',
    description: 'Native editable project file',
    kind: 'project',
    run: async (p) => new Blob([serializeProject(p)], { type: 'application/json' }),
  },
  { format: 'ifc', label: 'IFC 4 (BIM)', extension: 'ifc', mime: 'application/x-step', description: 'Open BIM model for Revit, ArchiCAD, BIMcollab, Solibri…', kind: 'bim', run: exportIFC },
  { format: 'glb', label: 'glTF Binary (.glb)', extension: 'glb', mime: 'model/gltf-binary', description: '3D model with materials for Blender, web viewers, AR', kind: '3d', run: exportGLB },
  { format: 'gltf', label: 'glTF (.gltf)', extension: 'gltf', mime: 'model/gltf+json', description: '3D model (JSON, embedded buffers)', kind: '3d', run: exportGLTF },
  { format: 'obj', label: 'Wavefront OBJ', extension: 'obj', mime: 'model/obj', description: 'Universal mesh format (geometry + groups)', kind: '3d', run: exportOBJ },
  { format: 'stl', label: 'STL (3D printing)', extension: 'stl', mime: 'model/stl', description: 'Binary STL for slicers / 3D printing', kind: '3d', run: exportSTL },
  { format: 'dxf', label: 'DXF (CAD)', extension: 'dxf', mime: 'image/vnd.dxf', description: '2D plans with layers for AutoCAD, LibreCAD, DraftSight', kind: '2d', run: exportDXF },
  { format: 'pdf', label: 'PDF Drawing Set', extension: 'pdf', mime: 'application/pdf', description: 'Printable sheets with title block, to scale', kind: '2d', run: exportPDF },
  { format: 'svg', label: 'SVG Drawing', extension: 'svg', mime: 'image/svg+xml', description: 'Scalable vector plan', kind: '2d', run: exportSVG },
  { format: 'png-plan', label: 'PNG — Floor Plan', extension: 'png', mime: 'image/png', description: 'Raster floor plan image', kind: 'image', run: exportPlanPNG },
  {
    format: 'png-3d',
    label: 'PNG — 3D View',
    extension: 'png',
    mime: 'image/png',
    description: 'Screenshot of the current 3D view',
    kind: 'image',
    run: async (_p, o, env) => {
      if (!env.viewport) throw new Error('3D view is not available');
      return env.viewport.captureImage({ width: o.width, height: o.height });
    },
  },
];

export function getExporter(format: ExportFormat): Exporter {
  const e = EXPORTERS.find((x) => x.format === format);
  if (!e) throw new Error(`Unknown export format ${format}`);
  return e;
}

export function exportFilename(project: Project, exporter: Exporter, suffix = ''): string {
  const base = (project.info.name || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project';
  return `${base}${suffix}.${exporter.extension}`;
}

export async function runExport(
  format: ExportFormat,
  project: Project,
  options: ExportOptions,
  env: ExportEnv,
): Promise<{ blob: Blob; filename: string }> {
  const exporter = getExporter(format);
  const blob = await exporter.run(project, options, env);
  return { blob, filename: exportFilename(project, exporter) };
}
