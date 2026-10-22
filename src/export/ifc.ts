import type { Project } from '../core/types';
import { buildIFC } from './ifc/builder';
import type { ExportEnv, ExportOptions } from './types';

/** Serialise the project to an IFC4 STEP physical file. */
export function projectToIFC(project: Project, options: ExportOptions = {}): string {
  return buildIFC(project, options);
}

export async function exportIFC(project: Project, options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  return new Blob([projectToIFC(project, options)], { type: 'application/x-step' });
}
