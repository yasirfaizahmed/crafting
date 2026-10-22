import type { Project } from '../core/types';
import type { Drawing } from '../drawing/types';
import type { ExportEnv, ExportOptions } from './types';

/** Render a Drawing to a standalone SVG document string (paper-space mm units). */
export function drawingToSVG(_drawing: Drawing): string {
  throw new Error('SVG export not implemented yet');
}

export async function exportSVG(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('SVG export not implemented yet');
}
