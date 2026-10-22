/**
 * Helpers shared by plan tools: typed-length entry, catalog templates, wall clear spans.
 */
import { getCatalogItem, type CatalogItem } from '../../core/catalog';
import { createFromCatalog } from '../../core/defaults';
import { dot, sub } from '../../core/math2d';
import type { Element, UnitSystem, Vec2, Wall } from '../../core/types';
import { parseLength } from '../../core/units';
import { projectOntoWall, wallDirection, wallLength, type WallFootprint } from '../../core/walls';
import type { ToolHost } from './types';

/**
 * Keyboard length entry while drawing: digits, units and separators accumulate; `value()` parses
 * "3.6m", "3600", "12'6\"", optionally followed by "<angle".
 */
export class LengthInput {
  text = '';

  /** Feed a key; returns true when consumed. */
  key(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Backspace') {
      if (!this.text) return false;
      this.text = this.text.slice(0, -1);
      return true;
    }
    if (e.key.length === 1 && /[0-9.,'"<\-mcinft ]/i.test(e.key)) {
      // Letters only continue a number (units), never start one (keeps R, F… for tools).
      if (/[a-z ]/i.test(e.key) && !/[0-9.'"]$/.test(this.text) && !/[a-z]$/i.test(this.text)) return false;
      if (e.key === ' ' && !this.text) return false;
      this.text += e.key;
      return true;
    }
    return false;
  }

  get active(): boolean {
    return this.text.length > 0;
  }

  clear(): void {
    this.text = '';
  }

  /** Parsed length (mm) and optional absolute angle (deg). */
  value(units: UnitSystem): { length: number; angle?: number } | null {
    const [lenStr, angStr] = this.text.split('<');
    const length = parseLength(lenStr.trim(), units);
    if (length === null || !Number.isFinite(length) || length <= 0) return null;
    if (angStr !== undefined) {
      const angle = parseFloat(angStr);
      if (!Number.isFinite(angle)) return null;
      return { length, angle };
    }
    return { length };
  }
}

export function template(item: CatalogItem): Record<string, unknown> {
  return item.template ?? {};
}

/** Wall item used by tools that create walls implicitly (room tool): first wall in the hotbar. */
export function wallItemFor(host: ToolHost): CatalogItem {
  const ui = host.app.ui.get();
  for (const id of ui.hotbar) {
    const it = getCatalogItem(id);
    if (it?.tool === 'wall') return it;
  }
  return getCatalogItem('wall-200')!;
}

export function makeWall(host: ToolHost, item: CatalogItem, start: Vec2, end: Vec2): Wall {
  const t = template(item);
  const thickness = typeof t.thickness === 'number' ? t.thickness : host.app.store.project.settings.wallThickness;
  return createFromCatalog(item, host.levelId, { start: { ...start }, end: { ...end }, thickness }) as Wall;
}

export function makeFromItem<T extends Element>(host: ToolHost, props: Record<string, unknown>, item: CatalogItem = host.item): T {
  return createFromCatalog(item, host.levelId, props) as T;
}

/**
 * Along-wall interval of the wall body that is clear of joins at both ends and of walls T-joined
 * into its faces: [start, end] in mm from wall.start, plus blocked sub-intervals.
 */
export function wallClearSpan(wall: Wall, footprints: Map<string, WallFootprint>): { start: number; end: number; blocked: [number, number][] } {
  const len = wallLength(wall);
  const fp = footprints.get(wall.id);
  let start = 0;
  let end = len;
  if (fp) {
    const o = (p: Vec2) => projectOntoWall(wall, p).offset;
    start = Math.max(o(fp.startLeft), o(fp.startRight), 0);
    end = Math.min(o(fp.endLeft), o(fp.endRight), len);
  }
  const blocked: [number, number][] = [];
  const dir = wallDirection(wall);
  for (const [id, other] of footprints) {
    if (id === wall.id) continue;
    // Walls whose footprint reaches into this wall's body (T joins) block that part of it.
    const inside = other.polygon.filter((q) => {
      const pr = projectOntoWall(wall, q);
      return pr.offset > start - 1 && pr.offset < end + 1 && Math.abs(pr.lateral) <= wall.thickness + 1;
    });
    if (inside.length < 2) continue;
    const along = other.polygon.map((q) => dot(sub(q, wall.start), dir));
    const near = other.polygon
      .map((q, i) => ({ lat: projectOntoWall(wall, q).lateral, s: along[i] }))
      .filter((x) => Math.abs(x.lat) <= wall.thickness + 1);
    if (near.length < 2) continue;
    const lo = Math.min(...near.map((x) => x.s));
    const hi = Math.max(...near.map((x) => x.s));
    if (hi - lo < 1 || hi <= start || lo >= end) continue;
    blocked.push([lo, hi]);
  }
  return { start, end, blocked };
}

export function snapAngleDeg(deg: number, step = 15): number {
  return Math.round(deg / step) * step;
}

export function normDeg(deg: number): number {
  const v = ((deg % 360) + 360) % 360;
  return Math.round(v * 1e6) / 1e6;
}
