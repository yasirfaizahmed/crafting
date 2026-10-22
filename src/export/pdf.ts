import type { Project } from '../core/types';
import type { ExportEnv, ExportOptions } from './types';

export async function exportPDF(_project: Project, _options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  throw new Error('PDF export not implemented yet');
}
