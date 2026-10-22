/**
 * Level (storey) list logic used by the Levels panel and level commands. Pure functions.
 */
import { createLevel } from '../core/defaults';
import type { Level, Project } from '../core/types';
import type { DocumentStore } from '../core/store';

/** Levels ordered top → bottom (the panel order). */
export function levelsTopDown(project: Pick<Project, 'levels'>): Level[] {
  return [...project.levels].sort((a, b) => b.elevation - a.elevation);
}

/** Levels ordered bottom → top. */
export function levelsBottomUp(project: Pick<Project, 'levels'>): Level[] {
  return [...project.levels].sort((a, b) => a.elevation - b.elevation);
}

/** Neighbour of `levelId`: dir = +1 → the level above, -1 → below. */
export function adjacentLevelId(project: Pick<Project, 'levels'>, levelId: string, dir: 1 | -1): string | undefined {
  const levels = levelsBottomUp(project);
  const i = levels.findIndex((l) => l.id === levelId);
  if (i < 0) return levels[0]?.id;
  return levels[i + dir]?.id;
}

export function levelElementCounts(project: Pick<Project, 'elements' | 'levels'>): Map<string, number> {
  const out = new Map<string, number>(project.levels.map((l) => [l.id, 0]));
  for (const el of Object.values(project.elements)) out.set(el.levelId, (out.get(el.levelId) ?? 0) + 1);
  return out;
}

export function canRemoveLevel(project: Pick<Project, 'levels'>): boolean {
  return project.levels.length > 1;
}

const ORDINALS = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

/** Conventional storey name for the n-th level above ground (0 = ground) or below (negative). */
export function storeyName(index: number): string {
  if (index < 0) return index === -1 ? 'Basement' : `Basement ${-index}`;
  return index < ORDINALS.length ? `${ORDINALS[index]} Floor` : `Level ${index}`;
}

/** A name not yet used in the project, based on the storey position of `elevation`. */
export function suggestLevelName(project: Pick<Project, 'levels'>, elevation: number): string {
  const names = new Set(project.levels.map((l) => l.name.toLowerCase()));
  const above = project.levels.filter((l) => l.elevation >= 0 && l.elevation < elevation).length;
  const below = project.levels.filter((l) => l.elevation < 0 && l.elevation < elevation).length;
  const index = elevation >= 0 ? above : -(project.levels.filter((l) => l.elevation < 0).length - below + 1);
  let name = storeyName(index);
  if (!names.has(name.toLowerCase())) return name;
  name = `Level ${project.levels.length + 1}`;
  let n = project.levels.length + 1;
  while (names.has(name.toLowerCase())) name = `Level ${++n}`;
  return name;
}

export interface LevelInsertPlan {
  level: Level;
  /** Existing levels that must move up to make room (new elevations). */
  shifts: { id: string; elevation: number }[];
}

/**
 * Plan a new level directly above or below `refId`. The elevation comes from the neighbour:
 * above = ref.elevation + ref.height; below = ref.elevation − height. Inserting between two
 * levels pushes the levels above up so floor-to-floor heights stay consistent.
 */
export function planInsertLevel(
  project: Pick<Project, 'levels' | 'settings'>,
  refId: string,
  where: 'above' | 'below',
  height = project.settings.levelHeight,
): LevelInsertPlan {
  const levels = levelsBottomUp(project);
  const i = Math.max(0, levels.findIndex((l) => l.id === refId));
  const ref = levels[i];
  const h = Math.max(1, height);
  if (!ref) return { level: createLevel({ name: storeyName(0), elevation: 0, height: h }), shifts: [] };
  // "Below" a level that has a level under it = "above" that lower level.
  const base = where === 'below' ? levels[i - 1] : ref;
  if (!base) {
    const elevation = ref.elevation - h;
    return { level: createLevel({ name: suggestLevelName(project, elevation), elevation, height: h }), shifts: [] };
  }
  const elevation = base.elevation + base.height;
  const level = createLevel({ name: suggestLevelName(project, elevation), elevation, height: h });
  const upper = levels.filter((l) => l.elevation > base.elevation);
  const shifts: LevelInsertPlan['shifts'] = [];
  if (upper.length) {
    const delta = elevation + h - upper[0].elevation;
    if (delta > 0) for (const l of upper) shifts.push({ id: l.id, elevation: l.elevation + delta });
  }
  return { level, shifts };
}

/** Insert a level (one undo step); returns the new level. */
export function insertLevel(store: DocumentStore, refId: string, where: 'above' | 'below'): Level {
  const plan = planInsertLevel(store.project, refId, where);
  store.transact(`Add level ${plan.level.name}`, (tx) => {
    // Shift from the top down so elevations never collide mid-way.
    for (const s of [...plan.shifts].sort((a, b) => b.elevation - a.elevation)) tx.updateLevel(s.id, { elevation: s.elevation });
    tx.addLevel(plan.level);
  });
  return plan.level;
}

/** Remove a level and its elements (one undo step). Returns false for the last level. */
export function removeLevel(store: DocumentStore, levelId: string): boolean {
  if (!canRemoveLevel(store.project) || !store.getLevel(levelId)) return false;
  const name = store.getLevel(levelId)!.name;
  store.transact(`Delete level ${name}`, (tx) => tx.removeLevel(levelId));
  return true;
}

/** Level to activate after removing `levelId` (the one below, else above). */
export function fallbackLevelId(project: Pick<Project, 'levels'>, levelId: string): string | undefined {
  return adjacentLevelId(project, levelId, -1) ?? adjacentLevelId(project, levelId, 1);
}
