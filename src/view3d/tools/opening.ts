/**
 * Door / window tool: hover a wall to get a ghost opening snapped along it; RMB places it.
 * Doors swing toward the player's side of the wall; R flips the hinge.
 */
import { createFromCatalog } from '../../core/defaults';
import { snap } from '../../core/math2d';
import type { Door, Project, Vec2, Wall, Window } from '../../core/types';
import { formatLength } from '../../core/units';
import { openingFits, openingOverlaps, pointAtOffset, projectOntoWall, wallBaseElevation, wallCenterOffset, wallLength } from '../../core/walls';
import type { CatalogItem } from '../../core/catalog';
import type { KeyInput, PickHit, Tool, ToolEnv } from './types';

export interface OpeningPlan {
  element: Door | Window;
  valid: boolean;
  reason?: string;
}

/** The wall the hit lies on (directly, or as host of the pointed door/window). */
export function hostWallOf(project: Pick<Project, 'elements'>, hit: PickHit | null): Wall | undefined {
  if (!hit?.elementId) return undefined;
  const el = project.elements[hit.elementId];
  if (el?.type === 'wall') return el;
  if (el?.type === 'door' || el?.type === 'window') {
    const host = project.elements[el.hostId];
    return host?.type === 'wall' ? host : undefined;
  }
  return undefined;
}

/** True when `player` stands on the wall's right side (looking start → end). */
export function playerOnRightSide(wall: Wall, player: Vec2): boolean {
  return projectOntoWall(wall, player).lateral < wallCenterOffset(wall);
}

/**
 * Opening of `item` on `wall` nearest to plan point `at`, centre snapped to `step` mm along the
 * wall and clamped inside it. Doors swing toward `player`.
 */
export function planOpening(
  project: Pick<Project, 'elements' | 'levels'>,
  item: CatalogItem,
  wall: Wall,
  at: Vec2,
  player: Vec2 | undefined,
  opts: { hinge?: 'left' | 'right'; step: number },
): OpeningPlan {
  const el = createFromCatalog(item, wall.levelId, { hostId: wall.id }) as Door | Window;
  const len = wallLength(wall);
  const half = el.width / 2;
  let offset = snap(projectOntoWall(wall, at).offset, opts.step);
  if (len >= el.width) offset = Math.min(len - half, Math.max(half, offset));
  el.offset = offset;
  if (el.type === 'door') {
    if (opts.hinge) el.hinge = opts.hinge;
    el.flip = player ? playerOnRightSide(wall, player) : false;
  }
  if (wall.locked) return { element: el, valid: false, reason: 'This wall is locked' };
  if (!openingFits(project, wall, el)) return { element: el, valid: false, reason: `Too big for this wall` };
  if (openingOverlaps(project, el)) return { element: el, valid: false, reason: 'Overlaps another opening' };
  return { element: el, valid: true };
}

export class OpeningTool implements Tool {
  private hinge: 'left' | 'right';
  private lastHit: PickHit | null = null;

  constructor(private readonly env: ToolEnv) {
    this.hinge = (env.item.template?.hinge as 'left' | 'right' | undefined) ?? 'left';
  }

  private get noun(): string {
    return this.env.item.tool === 'door' ? 'door' : 'window';
  }

  private plan(hit: PickHit | null): OpeningPlan | null {
    const project = this.env.ctx.store.project;
    const wall = hostWallOf(project, hit);
    if (!wall || !hit) return null;
    const step = this.env.ctx.ui.get().snapGrid ? 100 : 10;
    return planOpening(project, this.env.item, wall, hit.point, this.env.player().position, { hinge: this.hinge, step });
  }

  hover(hit: PickHit | null): void {
    this.lastHit = hit;
    const { ghost } = this.env;
    const plan = this.plan(hit);
    if (!plan) {
      ghost.clear();
      this.env.hint(`${this.env.item.name}: point at a wall`);
      return;
    }
    const project = this.env.ctx.store.project;
    const wall = project.elements[plan.element.hostId] as Wall;
    // Rebuild the host with the opening cut so the preview shows the real hole.
    ghost.show([plan.element, wall], plan.valid, { hide: [wall.id], solidIds: [wall.id] });
    ghost.marker(null);
    const units = this.env.ctx.ui.get().displayUnits;
    const size = `${formatLength(plan.element.width, units)} × ${formatLength(plan.element.height, units)}`;
    const top = wallBaseElevation(project, wall) + plan.element.sill + plan.element.height;
    ghost.label(size, { point: pointAtOffset(wall, plan.element.offset, wallCenterOffset(wall)), elevation: top + 150 });
    const extra = plan.element.type === 'door' ? ` · R: hinge ${this.hinge === 'left' ? 'right' : 'left'}` : '';
    this.env.hint(plan.valid ? `RMB: place ${this.noun} ${size}${extra}` : `${plan.reason ?? 'Cannot place here'}`);
  }

  use(hit: PickHit | null): void {
    const plan = this.plan(hit);
    if (!plan || !hit) {
      if (hit) this.env.toast(`Point at a wall to place a ${this.noun}`, 'info');
      return;
    }
    if (!plan.valid) {
      this.env.toast(plan.reason ?? 'Cannot place here', 'warning');
      return;
    }
    this.env.ctx.store.transact(`Place ${this.noun}`, (tx) => tx.add(plan.element));
    this.env.effect('place', { point: hit.point, elevation: hit.elevation });
    this.hover(hit);
  }

  key(e: KeyInput): boolean {
    if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || this.env.item.tool !== 'door') return false;
    this.hinge = this.hinge === 'left' ? 'right' : 'left';
    this.hover(this.lastHit);
    return true;
  }

  cancel(): boolean {
    return false;
  }

  dispose(): void {
    this.env.ghost.clear();
  }
}
