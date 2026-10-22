/** Test helpers: a fake ToolEnv / GhostSink and hit builders (used by *.test.ts only). */
import { createAppContext } from '../../app/context';
import { createSampleProject } from '../../app/sample';
import type { AppContext } from '../../app/state';
import { getCatalogItem } from '../../core/catalog';
import type { Element, Project, Vec2, Vec3 } from '../../core/types';
import type { GhostOptions, GhostSink, PickHit, PlanPoint, PlayerView, ToolEnv } from './types';

export class FakeGhost implements GhostSink {
  shown: Element[] = [];
  valid = true;
  options: GhostOptions | undefined;
  linePoints: PlanPoint[] | null = null;
  markerAt: PlanPoint | null = null;
  labelText: string | null = null;

  show(elements: Element[], valid: boolean, options?: GhostOptions): void {
    this.shown = elements;
    this.valid = valid;
    this.options = options;
  }

  line(points: PlanPoint[] | null): void {
    this.linePoints = points;
  }

  marker(at: PlanPoint | null): void {
    this.markerAt = at;
  }

  label(text: string | null): void {
    this.labelText = text;
  }

  clear(): void {
    this.shown = [];
    this.linePoints = null;
    this.markerAt = null;
    this.labelText = null;
  }
}

export interface FakeEnv {
  env: ToolEnv;
  ghost: FakeGhost;
  toasts: string[];
  effects: string[];
  player: PlayerView;
}

export function sampleContext(project: Project = createSampleProject()): AppContext {
  return createAppContext(project);
}

export function fakeEnv(ctx: AppContext, itemId: string, player: Partial<PlayerView> = {}): FakeEnv {
  const item = getCatalogItem(itemId);
  if (!item) throw new Error(`Unknown catalog item ${itemId}`);
  const ghost = new FakeGhost();
  const toasts: string[] = [];
  const effects: string[] = [];
  let rev = 0;
  ctx.store.subscribe(() => rev++);
  const p: PlayerView = { position: { x: 6000, y: -12000 }, elevation: 1620, yaw: 90, ...player };
  const env: ToolEnv = {
    ctx,
    item,
    ghost,
    player: () => p,
    revision: () => rev,
    hint: (t) => ctx.ui.set({ toolHint: t }),
    toast: (m) => toasts.push(m),
    effect: (k) => effects.push(k),
  };
  return { env, ghost, toasts, effects, player: p };
}

/** Hit on the ground / floor plane of `levelId` (defaults to the first level). */
export function floorHit(project: Project, point: Vec2, levelId = project.levels[0].id): PickHit {
  const lvl = project.levels.find((l) => l.id === levelId)!;
  return { point, elevation: lvl.elevation, normal: { x: 0, y: 0, z: 1 }, levelId, kind: lvl.elevation === 0 ? 'ground' : 'floor', distance: 10 };
}

/** Hit on an element surface. */
export function elementHit(el: Element, point: Vec2, elevation: number, normal: Vec3): PickHit {
  return { elementId: el.id, point, elevation, normal, levelId: el.levelId, kind: 'element', distance: 10 };
}

export function ofType<T extends Element['type']>(ctx: AppContext, type: T): Extract<Element, { type: T }>[] {
  return ctx.store.elements.filter((e): e is Extract<Element, { type: T }> => e.type === type);
}
