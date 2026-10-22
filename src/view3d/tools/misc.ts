/** Paint, eraser, eyedropper, measure and annotation tools. */
import { getMaterial } from '../../core/materials';
import { distance } from '../../core/math2d';
import type { Element, Vec3, Wall } from '../../core/types';
import { formatLength } from '../../core/units';
import { wallNormal } from '../../core/walls';
import { breakAt, pickBlockAt, typeName } from './actions';
import { nearestEndpoint, wallSnapTargets } from './snapping';
import type { PickHit, PlanPoint, Tool, ToolEnv } from './types';

/** Which wall face a plan-space normal points out of ('left'/'right' looking start → end). */
export function wallSideFromNormal(wall: Pick<Wall, 'start' | 'end'>, normal: Vec3): 'left' | 'right' | null {
  const n = wallNormal(wall);
  const d = normal.x * n.x + normal.y * n.y;
  if (d > 0.5) return 'left';
  if (d < -0.5) return 'right';
  return null;
}

/** Patch that paints `el` with `materialId` at the hit (wall sides get their own finish). */
export function paintPatch(el: Element, normal: Vec3, materialId: string): { patch: Partial<Element>; label: string } | null {
  if (el.type === 'wall') {
    const side = wallSideFromNormal(el, normal);
    if (side === 'left') return el.leftFinishId === materialId ? null : { patch: { leftFinishId: materialId } as Partial<Wall>, label: 'Paint wall (left face)' };
    if (side === 'right') return el.rightFinishId === materialId ? null : { patch: { rightFinishId: materialId } as Partial<Wall>, label: 'Paint wall (right face)' };
  }
  if (el.materialId === materialId) return null;
  return { patch: { materialId }, label: `Paint ${typeName(el)}` };
}

export class PaintTool implements Tool {
  constructor(private readonly env: ToolEnv) {}

  private get materialId(): string {
    return String(this.env.item.template?.materialId ?? 'paint-white');
  }

  hover(hit: PickHit | null): void {
    this.env.ghost.clear();
    const mat = getMaterial(this.materialId);
    const el = hit?.elementId ? this.env.ctx.store.getElement(hit.elementId) : undefined;
    if (!el || !hit) {
      this.env.hint(`${mat.name}: point at something to paint`);
      return;
    }
    const side = el.type === 'wall' ? wallSideFromNormal(el, hit.normal) : null;
    this.env.hint(`RMB: paint ${typeName(el)}${side ? ` (${side} face)` : ''} with ${mat.name}`);
  }

  use(hit: PickHit | null): void {
    const el = hit?.elementId ? this.env.ctx.store.getElement(hit.elementId) : undefined;
    if (!el || !hit) return;
    if (el.locked) {
      this.env.toast(`This ${typeName(el)} is locked`, 'warning');
      return;
    }
    const p = paintPatch(el, hit.normal, this.materialId);
    if (!p) return;
    this.env.ctx.store.transact(p.label, (tx) => tx.update(el.id, p.patch));
    this.env.effect('place', { point: hit.point, elevation: hit.elevation }, this.materialId);
  }

  cancel(): boolean {
    return false;
  }

  dispose(): void {}
}

export class EraserTool implements Tool {
  constructor(private readonly env: ToolEnv) {}

  hover(hit: PickHit | null): void {
    this.env.ghost.clear();
    const el = hit?.elementId ? this.env.ctx.store.getElement(hit.elementId) : undefined;
    this.env.hint(el ? `LMB/RMB: break ${el.name ?? typeName(el)}` : 'Break: point at something');
  }

  use(hit: PickHit | null): void {
    breakAt(this.env, hit);
  }

  primary(hit: PickHit | null): boolean {
    breakAt(this.env, hit);
    return true;
  }

  cancel(): boolean {
    return false;
  }

  dispose(): void {}
}

export class EyedropperTool implements Tool {
  constructor(private readonly env: ToolEnv) {}

  hover(hit: PickHit | null): void {
    this.env.ghost.clear();
    const el = hit?.elementId ? this.env.ctx.store.getElement(hit.elementId) : undefined;
    this.env.hint(el ? `LMB/RMB: pick ${el.name ?? typeName(el)} into the hotbar` : 'Pick block: point at something');
  }

  use(hit: PickHit | null): void {
    pickBlockAt(this.env, hit);
  }

  primary(hit: PickHit | null): boolean {
    pickBlockAt(this.env, hit);
    return true;
  }

  cancel(): boolean {
    return false;
  }

  dispose(): void {}
}

/** Distance between two picked points (3D), shown as a rubber band with a label. No element is created. */
export function measureText(a: PlanPoint, b: PlanPoint, units: 'metric' | 'imperial' = 'metric'): string {
  const dxy = distance(a.point, b.point);
  const dz = b.elevation - a.elevation;
  const d = Math.hypot(dxy, dz);
  return Math.abs(dz) < 1 ? formatLength(d, units) : `${formatLength(d, units)} (plan ${formatLength(dxy, units)}, Δh ${formatLength(dz, units)})`;
}

export class MeasureTool implements Tool {
  private a: PlanPoint | null = null;
  private b: PlanPoint | null = null;

  constructor(private readonly env: ToolEnv) {}

  /** Last completed measurement, mm. */
  get result(): number | null {
    return this.a && this.b ? Math.hypot(distance(this.a.point, this.b.point), this.b.elevation - this.a.elevation) : null;
  }

  private snapPoint(hit: PickHit): PlanPoint {
    const t = wallSnapTargets(this.env.ctx.store.project, hit.levelId);
    const ep = this.env.ctx.ui.get().snapObjects ? nearestEndpoint(hit.point, t.endpoints, 150) : undefined;
    return { point: ep ? { ...ep } : hit.point, elevation: hit.elevation };
  }

  hover(hit: PickHit | null): void {
    const { ghost } = this.env;
    if (this.a && this.b) return;
    if (!hit) {
      ghost.marker(null);
      return;
    }
    const p = this.snapPoint(hit);
    ghost.marker(p);
    const units = this.env.ctx.ui.get().displayUnits;
    if (this.a) {
      ghost.line([this.a, p]);
      const text = measureText(this.a, p, units);
      ghost.label(text, { point: { x: (this.a.point.x + p.point.x) / 2, y: (this.a.point.y + p.point.y) / 2 }, elevation: (this.a.elevation + p.elevation) / 2 });
      this.env.hint(`Measure: ${text} — RMB to finish`);
    } else {
      this.env.hint('Measure: RMB first point');
    }
  }

  use(hit: PickHit | null): void {
    if (!hit) return;
    const p = this.snapPoint(hit);
    if (!this.a || this.b) {
      this.a = p;
      this.b = null;
      this.env.ghost.line(null);
      this.env.ghost.label(null);
      this.hover(hit);
      return;
    }
    this.b = p;
    const units = this.env.ctx.ui.get().displayUnits;
    const text = measureText(this.a, p, units);
    this.env.ghost.line([this.a, p]);
    this.env.ghost.marker(p);
    this.env.ghost.label(text, { point: { x: (this.a.point.x + p.point.x) / 2, y: (this.a.point.y + p.point.y) / 2 }, elevation: (this.a.elevation + p.elevation) / 2 });
    this.env.hint(`Distance ${text} — RMB to measure again · LMB clear`);
  }

  primary(): boolean {
    if (!this.a) return false;
    this.cancel();
    return true;
  }

  cancel(): boolean {
    if (!this.a) return false;
    this.a = null;
    this.b = null;
    this.env.ghost.clear();
    return true;
  }

  dispose(): void {
    this.env.ghost.clear();
  }
}

export class AnnotationTool implements Tool {
  constructor(private readonly env: ToolEnv) {}

  hover(): void {
    this.env.ghost.clear();
    this.env.hint(`${this.env.item.name}: use the plan view for annotations`);
  }

  use(hit: PickHit | null): void {
    if (hit) this.env.toast('Use the plan view for annotations', 'info');
  }

  cancel(): boolean {
    return false;
  }

  dispose(): void {}
}
