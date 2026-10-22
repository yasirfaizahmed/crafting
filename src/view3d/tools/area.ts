/**
 * Area tools: slabs (one-click room flood fill or two-click rectangle) and roofs (one-click auto
 * roof over a storey's wall footprint, click an existing roof to restyle it, or two-click rectangle
 * on open ground).
 */
import { createFromCatalog } from '../../core/defaults';
import { boundsOf, emptyBounds, extendBounds, isEmptyBounds, pointInPolygon, polygonArea, rectPolygon, type Bounds2 } from '../../core/math2d';
import { roomAtPoint } from '../../core/rooms';
import type { Element, Project, Roof, Slab, Vec2 } from '../../core/types';
import { formatArea, formatLength } from '../../core/units';
import { computeWallFootprints, wallsOnLevel } from '../../core/walls';
import { commitPlacement, resolveBuildTarget, sortedLevels, targetLevelId, type BuildTarget } from './levels';
import { snapToGrid } from './snapping';
import type { PickHit, Tool, ToolEnv } from './types';

/** Rectangles smaller than this (mm) along either side are rejected. */
export const MIN_RECT = 100;

/** CCW rectangle spanned by two corners. */
export function rectFromCorners(a: Vec2, b: Vec2): Vec2[] {
  return rectPolygon(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
}

export function rectValid(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) >= MIN_RECT && Math.abs(a.y - b.y) >= MIN_RECT;
}

/** Bounds of every wall footprint (outer faces) on a level, or null when it has no walls. */
export function wallFootprintBounds(project: Pick<Project, 'elements'>, levelId: string): Bounds2 | null {
  const b = emptyBounds();
  for (const fp of computeWallFootprints(project, levelId).values()) for (const p of fp.polygon) extendBounds(b, p);
  return isEmptyBounds(b) ? null : b;
}

/**
 * Auto-roof footprint for a storey: the bounding outline of its walls expanded to their outer
 * faces, with the ridge running along the longer side.
 */
export function roofFootprint(project: Pick<Project, 'elements'>, levelId: string): { outline: Vec2[]; ridgeAngle: number } | null {
  const b = wallFootprintBounds(project, levelId);
  if (!b) return null;
  const outline = rectPolygon(b.minX, b.minY, b.maxX, b.maxY);
  return { outline, ridgeAngle: b.maxX - b.minX >= b.maxY - b.minY ? 0 : 90 };
}

/** Highest storey whose wall footprint (± margin) contains plan point `p`. */
export function buildingLevelAt(project: Pick<Project, 'elements' | 'levels'>, p: Vec2, margin = 50): string | undefined {
  for (const l of sortedLevels(project).reverse()) {
    if (!wallsOnLevel(project, l.id).length) continue;
    const b = wallFootprintBounds(project, l.id);
    if (b && p.x >= b.minX - margin && p.x <= b.maxX + margin && p.y >= b.minY - margin && p.y <= b.maxY + margin) return l.id;
  }
  return undefined;
}

/** Floor outline for a one-click fill at `p`: a room on the target storey, else one enclosed by the storey below. */
export function floodFillOutline(project: Pick<Project, 'elements' | 'levels'>, target: BuildTarget, p: Vec2): Vec2[] | null {
  if (target.levelId) {
    const room = roomAtPoint(project, target.levelId, p);
    if (room) return room.polygon;
  }
  // Walls of the storey below whose tops carry this floor: cover them up to their location lines.
  const below = sortedLevels(project).filter((l) => Math.abs(l.elevation + l.height - target.levelElevation) <= 100 && l.id !== target.levelId);
  for (const l of below) {
    const room = roomAtPoint(project, l.id, p);
    if (room) return room.centerPolygon;
  }
  return null;
}

function samePolygon(a: Vec2[], b: Vec2[]): boolean {
  const ba = boundsOf(a);
  const bb = boundsOf(b);
  const tol = 60;
  return (
    Math.abs(ba.minX - bb.minX) <= tol &&
    Math.abs(ba.minY - bb.minY) <= tol &&
    Math.abs(ba.maxX - bb.maxX) <= tol &&
    Math.abs(ba.maxY - bb.maxY) <= tol &&
    Math.abs(polygonArea(a) - polygonArea(b)) <= 0.03 * Math.max(polygonArea(a), 1)
  );
}

interface RectState {
  start: Vec2;
  target: BuildTarget;
}

abstract class RectTool implements Tool {
  protected rect: RectState | null = null;
  private roomCache: { key: string; outline: Vec2[] | null } | null = null;

  constructor(protected readonly env: ToolEnv) {}

  abstract hover(hit: PickHit | null): void;
  abstract use(hit: PickHit | null): void;
  protected abstract makeRect(outline: Vec2[], levelId: string, target: BuildTarget): Element | undefined;

  primary(): boolean {
    if (!this.rect) return false;
    this.cancel();
    return true;
  }

  cancel(): boolean {
    if (!this.rect) return false;
    this.rect = null;
    this.env.ghost.clear();
    return true;
  }

  dispose(): void {
    this.rect = null;
    this.env.ghost.clear();
  }

  protected snapped(p: Vec2): Vec2 {
    const ui = this.env.ctx.ui.get();
    return snapToGrid(p, ui.snapGrid ? this.env.ctx.store.project.settings.gridSize : 10);
  }

  protected cachedFill(target: BuildTarget, p: Vec2): Vec2[] | null {
    const key = `${this.env.revision()}:${target.levelId ?? 'new'}:${target.levelElevation}:${Math.round(p.x / 50)}:${Math.round(p.y / 50)}`;
    if (this.roomCache?.key === key) return this.roomCache.outline;
    const outline = floodFillOutline(this.env.ctx.store.project, target, p);
    this.roomCache = { key, outline };
    return outline;
  }

  /** Ghost + hint for the rectangle in progress. Returns false when no rectangle is active. */
  protected hoverRect(hit: PickHit, noun: string): boolean {
    if (!this.rect) return false;
    const r = this.rect;
    const b = this.snapped(hit.point);
    const outline = rectFromCorners(r.start, b);
    const el = this.makeRect(outline, targetLevelId(r.target), r.target);
    const valid = rectValid(r.start, b);
    this.env.ghost.show(el ? [el] : [], valid, { extraLevels: r.target.create ? [r.target.create] : undefined });
    const elev = r.target.levelElevation + r.target.offset;
    this.env.ghost.marker({ point: b, elevation: elev });
    const units = this.env.ctx.ui.get().displayUnits;
    const w = Math.abs(b.x - r.start.x);
    const d = Math.abs(b.y - r.start.y);
    const text = `${formatLength(w, units)} × ${formatLength(d, units)}`;
    this.env.ghost.label(text, { point: { x: (r.start.x + b.x) / 2, y: (r.start.y + b.y) / 2 }, elevation: elev });
    this.env.hint(`${noun} ${text} — RMB to place · LMB/Esc cancel`);
    return true;
  }

  /** Commit the rectangle in progress. Returns false when no rectangle is active. */
  protected commitRect(hit: PickHit, label: string): boolean {
    if (!this.rect) return false;
    const r = this.rect;
    const b = this.snapped(hit.point);
    if (!rectValid(r.start, b)) return true;
    const outline = rectFromCorners(r.start, b);
    const els = commitPlacement(this.env, label, r.target, (levelId) => {
      const el = this.makeRect(outline, levelId, r.target);
      return el ? [el] : [];
    });
    if (els) this.env.effect('place', { point: b, elevation: r.target.levelElevation + r.target.offset });
    this.rect = null;
    this.env.ghost.clear();
    return true;
  }

  protected startRect(hit: PickHit, target: BuildTarget): void {
    this.rect = { start: this.snapped(hit.point), target };
    this.hover(hit);
  }
}

export class SlabTool extends RectTool {
  hover(hit: PickHit | null): void {
    const { ghost } = this.env;
    if (!hit) {
      ghost.clear();
      this.env.hint(`${this.env.item.name}: RMB inside a room to fill its floor, or RMB-RMB for a rectangle`);
      return;
    }
    if (this.hoverRect(hit, 'Slab')) return;
    const target = resolveBuildTarget(this.env.ctx.store.project, hit);
    const fill = this.cachedFill(target, hit.point);
    const elev = target.levelElevation + target.offset;
    if (fill) {
      const el = this.makeRect(fill, targetLevelId(target), target);
      const dup = this.duplicateOf(fill, target);
      ghost.show(el ? [el] : [], !dup, { extraLevels: target.create ? [target.create] : undefined });
      ghost.marker(null);
      ghost.label(formatArea(polygonArea(fill), this.env.ctx.ui.get().displayUnits), { point: hit.point, elevation: elev });
      this.env.hint(dup ? 'This room already has this floor' : 'RMB: fill this room’s floor (one click) · LMB break');
    } else {
      ghost.show([], true);
      ghost.label(null);
      ghost.marker({ point: this.snapped(hit.point), elevation: elev });
      this.env.hint(`${this.env.item.name}: RMB to start a rectangle (or point inside an enclosed room)`);
    }
  }

  use(hit: PickHit | null): void {
    if (!hit) return;
    if (this.commitRect(hit, 'Place slab')) return;
    const project = this.env.ctx.store.project;
    const target = resolveBuildTarget(project, hit);
    const fill = floodFillOutline(project, target, hit.point);
    if (fill) {
      if (this.duplicateOf(fill, target)) {
        this.env.toast('This room already has this floor', 'info');
        return;
      }
      const els = commitPlacement(this.env, 'Fill room floor', target, (levelId) => {
        const el = this.makeRect(fill, levelId, target);
        return el ? [el] : [];
      });
      if (els) this.env.effect('place', { point: hit.point, elevation: target.levelElevation + target.offset });
      this.env.ghost.clear();
      return;
    }
    this.startRect(hit, target);
  }

  protected makeRect(outline: Vec2[], levelId: string, target: BuildTarget): Element | undefined {
    return createFromCatalog(this.env.item, levelId, { outline: outline.map((p) => ({ ...p })), topOffset: target.offset });
  }

  private duplicateOf(outline: Vec2[], target: BuildTarget): boolean {
    if (!target.levelId) return false;
    const kind = (this.env.item.template?.kind as Slab['kind'] | undefined) ?? 'floor';
    return Object.values(this.env.ctx.store.project.elements).some(
      (e) =>
        e.type === 'slab' &&
        e.levelId === target.levelId &&
        e.kind === kind &&
        Math.abs(e.topOffset - target.offset) < 1 &&
        samePolygon(e.outline, outline),
    );
  }
}

export class RoofTool extends RectTool {
  hover(hit: PickHit | null): void {
    const { ghost } = this.env;
    if (!hit) {
      ghost.clear();
      this.env.hint(`${this.env.item.name}: RMB on a building for an automatic roof`);
      return;
    }
    if (this.hoverRect(hit, 'Roof')) return;
    const project = this.env.ctx.store.project;
    const hitEl = hit.elementId ? project.elements[hit.elementId] : undefined;
    if (hitEl?.type === 'roof') {
      const style = this.styleProps();
      const same = (Object.keys(style) as (keyof Roof)[]).every((k) => hitEl[k] === style[k]);
      ghost.show(same ? [] : [{ ...hitEl, ...style } as Roof], true, same ? undefined : { hide: [hitEl.id] });
      ghost.marker(null);
      ghost.label(null);
      this.env.hint(same ? `This roof is already ${this.env.item.name}` : `RMB: change this roof to ${this.env.item.name}`);
      return;
    }
    const auto = this.autoRoof(hit);
    if (auto) {
      ghost.show([auto.roof], true, auto.replace ? { hide: [auto.replace.id] } : undefined);
      ghost.marker(null);
      ghost.label(null);
      this.env.hint(auto.replace ? `RMB: restyle the roof over this storey` : `RMB: roof over this storey (${this.env.item.name})`);
      return;
    }
    const target = resolveBuildTarget(project, hit);
    ghost.show([], true);
    ghost.label(null);
    ghost.marker({ point: this.snapped(hit.point), elevation: target.levelElevation + target.offset });
    this.env.hint(`${this.env.item.name}: RMB on a building for an automatic roof, or RMB-RMB a rectangle`);
  }

  use(hit: PickHit | null): void {
    if (!hit) return;
    if (this.commitRect(hit, 'Place roof')) return;
    const { store } = this.env.ctx;
    const hitEl = hit.elementId ? store.getElement(hit.elementId) : undefined;
    if (hitEl?.type === 'roof') {
      this.restyle(hitEl);
      return;
    }
    const auto = this.autoRoof(hit);
    if (auto) {
      if (auto.replace) {
        this.restyle(auto.replace);
        return;
      }
      const lvl = store.getLevel(auto.roof.levelId)!;
      const els = commitPlacement(this.env, 'Place roof', { levelId: lvl.id, levelElevation: lvl.elevation, levelHeight: lvl.height, offset: 0 }, (levelId) => {
        const el = createFromCatalog(this.env.item, levelId, { outline: auto.roof.outline, ridgeAngle: auto.roof.ridgeAngle });
        return el ? [el] : [];
      });
      if (els) this.env.effect('place', { point: hit.point, elevation: lvl.elevation + lvl.height });
      this.env.ghost.clear();
      return;
    }
    this.startRect(hit, resolveBuildTarget(store.project, hit));
  }

  protected makeRect(outline: Vec2[], levelId: string, _target: BuildTarget): Element | undefined {
    const b = boundsOf(outline);
    return createFromCatalog(this.env.item, levelId, {
      outline: outline.map((p) => ({ ...p })),
      ridgeAngle: b.maxX - b.minX >= b.maxY - b.minY ? 0 : 90,
    });
  }

  private styleProps(): Partial<Roof> {
    const t = this.env.item.template ?? {};
    const out: Partial<Roof> = {};
    if (typeof t.shape === 'string') out.shape = t.shape as Roof['shape'];
    if (typeof t.pitch === 'number') out.pitch = t.pitch;
    if (typeof t.materialId === 'string') out.materialId = t.materialId;
    if (typeof t.overhang === 'number') out.overhang = t.overhang;
    return out;
  }

  private restyle(roof: Roof): void {
    if (roof.locked) {
      this.env.toast('This roof is locked', 'warning');
      return;
    }
    this.env.ctx.store.transact('Change roof', (tx) => tx.update<Roof>(roof.id, this.styleProps()));
    this.env.ghost.clear();
  }

  /** Roof over the storey under/inside which the hit lies, or the existing roof there. */
  private autoRoof(hit: PickHit): { roof: Roof; replace?: Roof } | null {
    const project = this.env.ctx.store.project;
    const hitEl = hit.elementId ? project.elements[hit.elementId] : undefined;
    let levelId = buildingLevelAt(project, hit.point);
    if (!levelId && hitEl && wallsOnLevel(project, hitEl.levelId).length) levelId = hitEl.levelId;
    if (!levelId) return null;
    const fp = roofFootprint(project, levelId);
    if (!fp) return null;
    const existing = Object.values(project.elements).find(
      (e): e is Roof => e.type === 'roof' && e.levelId === levelId && pointInPolygon(hit.point, expandBox(e.outline, 50)),
    );
    const roof = createFromCatalog(this.env.item, levelId, { outline: fp.outline, ridgeAngle: fp.ridgeAngle }) as Roof;
    return { roof, replace: existing };
  }
}

function expandBox(poly: Vec2[], m: number): Vec2[] {
  const b = boundsOf(poly);
  return rectPolygon(b.minX - m, b.minY - m, b.maxX + m, b.maxY + m);
}
