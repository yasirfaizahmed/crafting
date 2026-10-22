import type { Project } from '../core/types';
import type { ExportEnv, ExportOptions } from './types';

export async function exportGLB(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('glTF export not implemented yet');
}

export async function exportGLTF(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('glTF export not implemented yet');
}

export async function exportOBJ(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('OBJ export not implemented yet');
}

export async function exportSTL(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('STL export not implemented yet');
}
