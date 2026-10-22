/**
 * Which storey does a 3D placement go on? Pointing at the top of a wall or slab targets the level
 * whose floor is at that height; building on top of the top storey creates a new level above
 * ("infinite world"). The new level is added inside the same transaction as the element.
 */
import { createLevel } from '../../core/defaults';
import type { Element, Level, Project } from '../../core/types';
import type { PickHit, ToolEnv } from './types';

/** Surfaces within this distance (mm) of a level datum snap to that level. */
export const LEVEL_TOLERANCE = 100;

export interface BuildTarget {
  /** Existing level id; undefined when `create` must be added first. */
  levelId?: string;
  /** Elevation of the target level datum, mm. */
  levelElevation: number;
  /** Floor-to-floor height of the target level, mm. */
  levelHeight: number;
  /** Height of the pointed surface above the level datum, mm (0 = on the floor). */
  offset: number;
  /** Level created inside the placement transaction. */
  create?: Level;
}

const ORDINALS = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

/** Conventional storey name for the n-th level above ground (0 = ground). */
export function levelName(index: number): string {
  return index >= 0 && index < ORDINALS.length ? `${ORDINALS[index]} Floor` : `Level ${index}`;
}

export function sortedLevels(project: Pick<Project, 'levels'>): Level[] {
  return [...project.levels].sort((a, b) => a.elevation - b.elevation);
}

/** The level that sits on the ground (elevation closest to 0, preferring levels at or below 0). */
export function groundLevel(project: Pick<Project, 'levels'>): Level {
  const levels = sortedLevels(project);
  let best = levels[0];
  for (const l of levels) if (Math.abs(l.elevation) < Math.abs(best.elevation) - 1e-6) best = l;
  return best;
}

/** Level whose floor-to-floor range contains `elevation` (clamped to the bottom/top level). */
export function levelContaining(project: Pick<Project, 'levels'>, elevation: number): Level {
  const levels = sortedLevels(project);
  let found = levels[0];
  for (const l of levels) if (l.elevation <= elevation + 1e-6) found = l;
  return found;
}

/** A not-yet-existing level directly above the top storey. */
export function levelAboveTop(project: Pick<Project, 'levels' | 'settings'>): Level {
  const levels = sortedLevels(project);
  const top = levels[levels.length - 1];
  return createLevel({
    name: levelName(levels.filter((l) => l.elevation >= 0).length),
    elevation: top.elevation + top.height,
    height: project.settings.levelHeight || top.height,
  });
}

const existing = (l: Level, offset = 0): BuildTarget => ({ levelId: l.id, levelElevation: l.elevation, levelHeight: l.height, offset });

/** Resolve the storey an element placed at `hit` belongs to. */
export function resolveBuildTarget(project: Pick<Project, 'levels' | 'settings'>, hit: PickHit): BuildTarget {
  const hitLevel = project.levels.find((l) => l.id === hit.levelId) ?? groundLevel(project);
  if (hit.kind !== 'element') return existing(hitLevel, Math.max(0, hit.elevation - hitLevel.elevation));
  if (hit.normal.z < 0.7) {
    // Vertical (or downward) faces: build on the floor of the element's own storey.
    return existing(hitLevel, 0);
  }
  const e = hit.elevation;
  const levels = sortedLevels(project);
  const match = levels.find((l) => Math.abs(l.elevation - e) <= LEVEL_TOLERANCE);
  if (match) return existing(match, 0);
  const top = levels[levels.length - 1];
  const topOfTop = top.elevation + top.height;
  if (e >= topOfTop - LEVEL_TOLERANCE) {
    const create = levelAboveTop(project);
    return { levelElevation: create.elevation, levelHeight: create.height, offset: Math.max(0, e - create.elevation), create };
  }
  const l = levelContaining(project, e);
  return existing(l, Math.max(0, e - l.elevation));
}

/** Id of the target level (the new level's id when it will be created). */
export function targetLevelId(t: BuildTarget): string {
  return t.levelId ?? t.create!.id;
}

/** After a commit created the level, later placements in the same gesture reuse it. */
export function settledTarget(t: BuildTarget): BuildTarget {
  return t.create ? { ...t, levelId: t.create.id, create: undefined } : t;
}

/**
 * Add elements in ONE undo step, creating the target level first when needed. Returns the stored
 * elements, or null if the transaction failed.
 */
export function commitPlacement(
  env: Pick<ToolEnv, 'ctx' | 'toast'>,
  label: string,
  target: BuildTarget,
  make: (levelId: string) => Element[],
): Element[] | null {
  const { store, ui } = env.ctx;
  let created: Level | undefined;
  try {
    const els = store.transact(label, (tx) => {
      let levelId = target.levelId;
      if (!levelId || !store.getLevel(levelId)) {
        if (!target.create) throw new Error('No target level');
        if (!store.getLevel(target.create.id)) {
          tx.addLevel(target.create);
          created = target.create;
        }
        levelId = target.create.id;
      }
      return make(levelId).map((el) => tx.add(el));
    });
    if (created) {
      ui.set({ activeLevelId: created.id });
      env.toast(`New level “${created.name}” created at +${(created.elevation / 1000).toFixed(2)} m`, 'info');
    }
    return els;
  } catch (err) {
    console.warn('Placement failed', err);
    env.toast('Could not place here', 'warning');
    return null;
  }
}
