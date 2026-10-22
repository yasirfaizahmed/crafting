import { createProject, SCHEMA_VERSION } from './defaults';
import type { Element, Project } from './types';

export const FILE_EXTENSION = '.craft';
export const FILE_MIME = 'application/vnd.crafting.project+json';

export interface CraftFile {
  format: 'crafting-project';
  schemaVersion: number;
  savedAt: string;
  project: Project;
}

export function serializeProject(project: Project, pretty = false): string {
  const file: CraftFile = {
    format: 'crafting-project',
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    project,
  };
  return JSON.stringify(file, null, pretty ? 2 : undefined);
}

export class ProjectParseError extends Error {}

/** Parse a .craft file (or a bare Project JSON) with validation and forward migration. */
export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectParseError('File is not valid JSON');
  }
  const obj = raw as Partial<CraftFile> & Partial<Project>;
  const project = (obj.format === 'crafting-project' ? obj.project : obj) as Partial<Project> | undefined;
  if (!project || typeof project !== 'object') throw new ProjectParseError('Not a Crafting project');
  if (!Array.isArray(project.levels) || project.levels.length === 0) throw new ProjectParseError('Project has no levels');
  if (!project.elements || typeof project.elements !== 'object') throw new ProjectParseError('Project has no elements');
  const version = project.schemaVersion ?? 1;
  if (version > SCHEMA_VERSION) throw new ProjectParseError(`File was made by a newer version (schema ${version})`);
  return migrate(project as Project);
}

function migrate(p: Project): Project {
  const base = createProject(p.info?.name ?? 'Untitled Project');
  const levelIds = new Set(p.levels.map((l) => l.id));
  const elements: Record<string, Element> = {};
  for (const [id, el] of Object.entries(p.elements)) {
    if (!el || typeof el !== 'object' || !('type' in el)) continue;
    if (!levelIds.has(el.levelId)) continue;
    elements[id] = { ...el, id };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: p.id ?? base.id,
    info: { ...base.info, ...(p.info ?? {}) },
    settings: { ...base.settings, ...(p.settings ?? {}) },
    levels: [...p.levels].sort((a, b) => a.elevation - b.elevation),
    elements,
  };
}
