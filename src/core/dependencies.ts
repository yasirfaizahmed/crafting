import type { ChangeSet } from './store';
import type { Element, Project } from './types';
import { wallDependents } from './walls';

/**
 * Expand a ChangeSet to every element id whose GEOMETRY must be rebuilt:
 * changed elements, walls joined to changed walls (at old and new positions), hosts of changed
 * openings and openings of changed walls. Removed ids are included so views can drop them.
 * Returns null when everything should be rebuilt (project reset or level changes).
 */
export function affectedIds(project: Project, change: ChangeSet): Set<string> | null {
  if (change.reset || change.levelsChanged) return null;
  const out = new Set<string>();
  const consider = (el: Element | undefined) => {
    if (!el) return;
    out.add(el.id);
    if (el.type === 'wall') for (const id of wallDependents(project, el)) out.add(id);
    if (el.type === 'door' || el.type === 'window') {
      out.add(el.hostId);
      const host = project.elements[el.hostId];
      if (host?.type === 'wall') for (const id of wallDependents(project, host)) out.add(id);
    }
  };
  for (const id of [...change.added, ...change.updated, ...change.removed]) {
    out.add(id);
    consider(project.elements[id]);
    consider(change.previous[id]);
  }
  return out;
}
