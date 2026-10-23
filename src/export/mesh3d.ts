import type { Project } from '../core/types';
import { projectToGLB, projectToGLTF, projectToOBJ, projectToSTL } from './mesh3d/formats';
import type { ExportEnv, ExportOptions } from './types';

export { buildExportScene, disposeExportScene, elementNodeName, type ExportSceneOptions } from './mesh3d/scene';
export { projectToGLB, projectToGLTF, projectToOBJ, projectToSTL } from './mesh3d/formats';

export async function exportGLB(project: Project, options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  return new Blob([await projectToGLB(project, options)], { type: 'model/gltf-binary' });
}

export async function exportGLTF(project: Project, options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  return new Blob([JSON.stringify(await projectToGLTF(project, options))], { type: 'model/gltf+json' });
}

export async function exportOBJ(project: Project, options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  return new Blob([projectToOBJ(project, options)], { type: 'model/obj' });
}

export async function exportSTL(project: Project, options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  return new Blob([projectToSTL(project, options)], { type: 'model/stl' });
}
