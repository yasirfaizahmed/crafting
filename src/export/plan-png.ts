import type { Project } from '../core/types';
import type { ExportEnv, ExportOptions } from './types';

/** Rasterise the plan drawing (browser only). */
export async function exportPlanPNG(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('Plan PNG export not implemented yet');
}
