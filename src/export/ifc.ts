import type { Project } from '../core/types';
import type { ExportEnv, ExportOptions } from './types';

/** Serialise the project to an IFC4 STEP physical file. */
export function projectToIFC(_project: Project, _options: ExportOptions = {}): string {
  throw new Error('IFC export not implemented yet');
}

export async function exportIFC(project: Project, options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  return new Blob([projectToIFC(project, options)], { type: 'application/x-step' });
}
