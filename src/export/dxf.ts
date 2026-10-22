import type { Project } from '../core/types';
import type { Drawing } from '../drawing/types';
import type { ExportEnv, ExportOptions } from './types';

/** Serialise drawings to an ASCII DXF document (model space, mm). */
export function drawingsToDXF(_drawings: Drawing[]): string {
  throw new Error('DXF export not implemented yet');
}

export async function exportDXF(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('DXF export not implemented yet');
}
