/**
 * Two-click linear tools with chaining: walls, beams and railings.
 * RMB sets the start, RMB again commits a segment and continues from its end; LMB or Esc ends the
 * chain. Points snap to wall ends (magnet), wall lines, 15° angles and the grid.
 */
import { createFromCatalog } from '../../core/defaults';
import { angleDeg, closestOnSegment, distance, midpoint, sub } from '../../core/math2d';
import type { Element, Project, Railing, Vec2 } from '../../core/types';
import { formatLength } from '../../core/units';
import { JOIN_TOLERANCE } from '../../core/walls';
import { commitPlacement, resolveBuildTarget, settledTarget, sortedLevels, targetLevelId, type BuildTarget } from './levels';
import { DEFAULT_MAGNET, normalizeDeg, snapPlanPoint, wallSnapTargets, type SnapResult } from './snapping';
import type { PickHit, Tool, ToolEnv } from './types';

export type LinearKind = 'wall' | 'beam' | 'railing';

/** Segments shorter than this (mm) are not committed. */
export const MIN_SEGMENT = 100;

const LABELS: Record<LinearKind, string> = { wall: 'Place wall', beam: 'Place beam', railing: 'Place railing' };
const NOUNS: Record<LinearKind, string> = { wall: 'wall', beam: 'beam', railing: 'railing' };

interface Chain {
  origin: Vec2;
  start: Vec2;
  target: BuildTarget;
  /** Beams resting on a wall/column top: top of beam above the level datum. */
  beamTop?: number;
  railingId?: string;
  segments: number;
}

interface Resolved {
  point: Vec2;
  target: BuildTarget;
  snap: SnapResult;
  beamTop?: number;
}

/** Build the element for a segment a→b on `levelId` from the catalog template. */
export function makeLinearElement(
  project: Pick<Project, 'settings'>,
  env: Pick<ToolEnv, 'item'>,
  kind: LinearKind,
  a: Vec2,
  b: Vec2,
  levelId: string,
  target: BuildTarget,
  beamTop?: number,
): Element | undefined {
  const tpl = env.item.template ?? {};
  const props: Record<string, unknown> = {};
  if (kind === 'wall') {
    props.start = { ...a };
    props.end = { ...b };
    props.baseOffset = target.offset;
    if (tpl.thickness === undefined) props.thickness = project.settings.wallThickness;
    if (target.offset > 0 && tpl.height === undefined) props.height = Math.max(300, target.levelHeight - target.offset);
  } else if (kind === 'beam') {
    props.start = { ...a };
    props.end = { ...b };
    if (beamTop !== undefined) props.topOffset = beamTop;
  } else {
    props.path = [{ ...a }, { ...b }];
    props.baseOffset = target.offset;
  }
  return createFromCatalog(env.item, levelId, props);
}

export class LinearTool implements Tool {
  private chain: Chain | null = null;

  constructor(
    private readonly env: ToolEnv,
    readonly kind: LinearKind,
  ) {}

  /** True while a chain is being drawn. */
  get drawing(): boolean {
    return !!this.chain;
  }

  hover(hit: PickHit | null): void {
    const { ghost } = this.env;
    if (!hit) {
      ghost.clear();
      this.env.hint(this.idleHint());
      return;
    }
    const r = this.resolve(hit);
    const elev = r.target.levelElevation + r.target.offset;
    ghost.marker({ point: r.point, elevation: elev }, true);
    if (!this.chain) {
      ghost.show([], true);
      ghost.label(null);
      this.env.hint(this.idleHint());
      return;
    }
    const c = this.chain;
    const el = makeLinearElement(this.env.ctx.store.project, this.env, this.kind, c.start, r.point, targetLevelId(c.target), c.target, c.beamTop);
    const len = distance(c.start, r.point);
    const valid = len >= MIN_SEGMENT;
    ghost.show(el ? [el] : [], valid, { extraLevels: c.target.create ? [c.target.create] : undefined });
    const top = elev + this.ghostHeight(el);
    const angle = normalizeDeg(Math.round(angleDeg(sub(r.point, c.start)) * 10) / 10);
    const units = this.env.ctx.ui.get().displayUnits;
    ghost.label(`${formatLength(len, units)} · ${angle}°`, { point: midpoint(c.start, r.point), elevation: top });
    this.env.hint(
      `${capital(NOUNS[this.kind])} ${formatLength(len, units)} at ${angle}° — RMB place & continue · LMB/Esc finish`,
    );
  }

  use(hit: PickHit | null): void {
    if (!hit) return;
    const r = this.resolve(hit);
    if (!this.chain) {
      this.chain = { origin: r.point, start: r.point, target: r.target, beamTop: r.beamTop, segments: 0 };
      this.hover(hit);
      return;
    }
    const c = this.chain;
    if (distance(c.start, r.point) < MIN_SEGMENT) return;
    const { store } = this.env.ctx;
    const existingRail = c.railingId ? store.getElement(c.railingId) : undefined;
    if (this.kind === 'railing' && existingRail?.type === 'railing') {
      const rail = existingRail as Railing;
      store.transact('Extend railing', (tx) => tx.update<Railing>(rail.id, { path: [...rail.path, { ...r.point }] }));
    } else {
      const project = store.project;
      const els = commitPlacement(this.env, LABELS[this.kind], c.target, (levelId) => {
        const el = makeLinearElement(project, this.env, this.kind, c.start, r.point, levelId, c.target, c.beamTop);
        return el ? [el] : [];
      });
      if (!els?.length) return;
      c.target = settledTarget(c.target);
      if (this.kind === 'railing') c.railingId = els[0].id;
    }
    this.env.effect('place', { point: r.point, elevation: c.target.levelElevation + c.target.offset });
    c.segments++;
    c.start = r.point;
    if (c.segments >= 2 && distance(r.point, c.origin) <= JOIN_TOLERANCE) {
      // Closed loop: finish automatically.
      this.chain = null;
      this.env.ghost.clear();
      this.env.hint(`Loop closed — ${this.idleHint()}`);
      return;
    }
    this.hover(hit);
  }

  primary(): boolean {
    if (!this.chain) return false;
    this.endChain();
    return true;
  }

  cancel(): boolean {
    if (!this.chain) return false;
    this.endChain();
    return true;
  }

  dispose(): void {
    this.chain = null;
    this.env.ghost.clear();
  }

  private endChain(): void {
    this.chain = null;
    this.env.ghost.show([], true);
    this.env.ghost.label(null);
    this.env.hint(this.idleHint());
  }

  private idleHint(): string {
    return `${this.env.item.name}: RMB to start · snaps to grid, wall ends & 15°`;
  }

  private ghostHeight(el: Element | undefined): number {
    if (!el) return 0;
    if (el.type === 'wall') return el.height ?? this.chain?.target.levelHeight ?? 3000;
    if (el.type === 'railing') return el.height;
    if (el.type === 'beam') return el.topOffset ?? this.chain?.target.levelHeight ?? 3000;
    return 0;
  }

  private resolve(hit: PickHit): Resolved {
    const project = this.env.ctx.store.project;
    const ui = this.env.ctx.ui.get();
    let target = this.chain?.target;
    let beamTop = this.chain?.beamTop;
    if (!target) {
      target = resolveBuildTarget(project, hit);
      if (this.kind === 'beam' && hit.elementId && hit.normal.z > 0.7) {
        const el = project.elements[hit.elementId];
        const lvl = el && project.levels.find((l) => l.id === el.levelId);
        if (lvl && (el.type === 'wall' || el.type === 'column')) {
          target = { levelId: lvl.id, levelElevation: lvl.elevation, levelHeight: lvl.height, offset: 0 };
          beamTop = hit.elevation - lvl.elevation;
        }
      }
    }
    const levelId = target.levelId;
    const own = wallSnapTargets(project, levelId);
    // Align with the storey below (e.g. stacking walls on the walls underneath).
    const levels = sortedLevels(project);
    const below = levels.filter((l) => l.elevation < target!.levelElevation - 1).pop();
    const under = below ? wallSnapTargets(project, below.id) : { endpoints: [], lines: [] };
    const extra: Vec2[] = [];
    if (levelId) {
      for (const el of Object.values(project.elements)) {
        if (el.levelId !== levelId) continue;
        if (this.kind === 'railing' && el.type === 'railing') extra.push(...el.path);
        if (this.kind === 'beam' && el.type === 'beam') extra.push(el.start, el.end);
        if (this.kind === 'beam' && el.type === 'column') extra.push(el.position);
      }
    }
    // Aiming at a wall face starts/ends on that wall's location line (clean T junction).
    let raw = hit.point;
    const hitEl = hit.elementId ? project.elements[hit.elementId] : undefined;
    if (hitEl?.type === 'wall' && Math.abs(hit.normal.z) < 0.5 && hitEl.levelId === levelId) {
      raw = closestOnSegment(hit.point, hitEl.start, hitEl.end).point;
    }
    const snap = snapPlanPoint(raw, {
      grid: project.settings.gridSize,
      snapGrid: ui.snapGrid,
      snapAngle: ui.snapAngle,
      magnet: ui.snapObjects ? DEFAULT_MAGNET : 0,
      endpoints: ui.snapObjects ? [...own.endpoints, ...under.endpoints, ...extra] : [],
      lines: ui.snapObjects ? own.lines : [],
      from: this.chain?.start,
    });
    return { point: snap.point, target, snap, beamTop };
  }
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
