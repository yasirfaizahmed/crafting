/**
 * Single-click placement tools: furniture (auto-back against walls), stair (drag sets direction),
 * column (grid) and Minecraft-style blocks (cell snapping + stacking).
 */
import { getFurniture } from '../../core/catalog';
import { add, angleDeg, closestOnSegment, distance, dot, normalize, pointInPolygon, scale, sub } from '../../core/math2d';
import type { Block, Column, Furniture, Stair, Vec2 } from '../../core/types';
import { wallNormal } from '../../core/walls';
import type { OverlayItem } from '../editor-types';
import { blockOutline } from '../shapes';
import { makeFromItem, normDeg, snapAngleDeg, template } from './common';
import type { PlanTool, ToolHost, ToolPointer } from './types';

const NO_AUTO_BACK = new Set(['tree', 'rug', 'round', 'table', 'car', 'lamp', 'plant']);

/** Rotation that puts a furniture BACK (local +y) against a wall face with inward normal `n`. */
export function rotationFacingAway(n: Vec2): number {
  return normDeg((Math.atan2(n.x, -n.y) * 180) / Math.PI);
}

export class FurnitureTool implements PlanTool {
  readonly name = 'furniture';
  private userRot = 0;
  private ghost: Furniture | null = null;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint(`${this.host.item.name}: click to place · backs snap against nearby walls · R rotates 90° · Shift+R 15°`);
  }

  /** Where the furniture would go for a pointer at `p`. */
  placementAt(p: Vec2): { position: Vec2; rotation: number; wallId?: string } {
    const host = this.host;
    const catalogId = String(template(host.item).catalogId ?? '');
    const def = getFurniture(catalogId);
    const d = def?.depth ?? 600;
    const w = def?.width ?? 600;
    const ui = host.app.ui.get();
    const q = (v: number) => (ui.snapGrid ? Math.round(v / 50) * 50 : Math.round(v));
    if (def && !NO_AUTO_BACK.has(def.plan) && ui.snapObjects) {
      const reach = Math.max(d / 2 + 350, host.tol(24));
      let best: { c: Vec2; n: Vec2; dist: number; a: Vec2; b: Vec2; wallId: string } | null = null;
      for (const [id, fp] of host.footprints()) {
        const wall = host.app.store.getElement(id);
        if (!wall || wall.type !== 'wall') continue;
        const nL = wallNormal(wall);
        for (const [a, b, n] of [
          [fp.startLeft, fp.endLeft, nL],
          [fp.startRight, fp.endRight, scale(nL, -1)],
        ] as const) {
          const c = closestOnSegment(p, a, b);
          if (dot(sub(p, c.point), n) < -1) continue;
          if (c.distance <= reach && (!best || c.distance < best.dist)) best = { c: c.point, n, dist: c.distance, a, b, wallId: id };
        }
      }
      if (best) {
        const rotation = normDeg(rotationFacingAway(best.n) + this.userRot);
        const sideways = Math.abs(Math.sin((this.userRot * Math.PI) / 180)) > 0.5;
        const depthOff = (sideways ? w : d) / 2 + 1;
        const along = normalize(sub(best.b, best.a));
        const len = distance(best.a, best.b);
        const half = (sideways ? d : w) / 2;
        let s = dot(sub(best.c, best.a), along);
        s = len >= half * 2 ? Math.min(Math.max(q(s), half), len - half) : len / 2;
        const position = add(add(best.a, scale(along, s)), scale(best.n, depthOff));
        return { position: { x: Math.round(position.x), y: Math.round(position.y) }, rotation, wallId: best.wallId };
      }
    }
    return { position: { x: q(p.x), y: q(p.y) }, rotation: normDeg(this.userRot) };
  }

  pointerMove(e: ToolPointer): void {
    const host = this.host;
    const pl = this.placementAt(e.world);
    this.ghost = { ...makeFromItem<Furniture>(host, { position: pl.position, rotation: pl.rotation }), id: '__ghost_furniture' };
    host.setGhosts([this.ghost], 'valid');
    host.setOverlay([{ t: 'tag', p: e.world, text: host.item.name, sub: pl.wallId ? 'Against wall' : `${Math.round(pl.rotation)}°`, tone: 'info', dy: 24 }]);
    host.setCursor('copy');
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const pl = this.placementAt(e.world);
    const el = makeFromItem<Furniture>(this.host, { position: pl.position, rotation: pl.rotation });
    this.host.transact(`Place ${getFurniture(el.catalogId)?.name ?? 'furniture'}`, (tx) => tx.add(el));
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey) return false;
    this.userRot = normDeg(this.userRot + (e.shiftKey ? 15 : 90));
    this.host.invalidate();
    return true;
  }

  leave(): void {
    this.host.setGhosts([]);
    this.host.setOverlay([]);
  }

  deactivate(): void {
    this.leave();
  }
}

export class StairTool implements PlanTool {
  readonly name = 'stair';
  private rotation: number;
  /** Mirrored ghost (M): the turn opposite to the catalog item's. */
  private mirrored = false;
  private press: { at: Vec2; screen: Vec2 } | null = null;
  private lastMove: ToolPointer | null = null;

  constructor(private host: ToolHost) {
    const t = template(host.item);
    this.rotation = typeof t.rotation === 'number' ? t.rotation : 90;
  }

  activate(): void {
    this.host.setHint(`${this.host.item.name}: click to place the foot of the stair · drag to set the direction of travel · R rotates 90° · M mirrors`);
  }

  busy(): boolean {
    return !!this.press;
  }

  private make(p: Vec2, rotation: number): Stair {
    const st = makeFromItem<Stair>(this.host, { position: p, rotation });
    return this.mirrored ? { ...st, turn: st.turn === 'left' ? 'right' : 'left' } : st;
  }

  private ghostAt(p: Vec2, rotation: number): Stair {
    return { ...this.make(p, rotation), id: '__ghost_stair' };
  }

  pointerMove(e: ToolPointer): void {
    this.lastMove = e;
    const host = this.host;
    const items: OverlayItem[] = [];
    if (this.press) {
      const v = sub(e.world, this.press.at);
      if (distance(e.screen, this.press.screen) > 8) this.rotation = e.shift ? normDeg(Math.round(angleDeg(v))) : normDeg(snapAngleDeg(angleDeg(v)));
      host.setGhosts([this.ghostAt(this.press.at, this.rotation)], 'valid');
      items.push({ t: 'line', a: this.press.at, b: e.world, dash: [4, 3], width: 1 }, { t: 'tag', p: e.world, text: `UP ${Math.round(this.rotation)}°`, tone: 'accent' });
    } else {
      const s = host.snap(e.world);
      if (s.kind !== 'none') items.push({ t: 'snap', p: s.point, kind: s.kind });
      host.setGhosts([this.ghostAt(s.point, this.rotation)], 'valid');
    }
    host.setOverlay(items);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    this.press = { at: this.host.snap(e.world).point, screen: e.screen };
  }

  pointerUp(e: ToolPointer): void {
    if (!this.press) return;
    const st = this.make(this.press.at, this.rotation);
    this.press = null;
    this.host.transact('Place stair', (tx) => tx.add(st));
    this.pointerMove(e);
  }

  keyDown(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) return false;
    if (k === 'm' && !e.shiftKey) this.mirrored = !this.mirrored;
    else if (k === 'r') this.rotation = normDeg(this.rotation + (e.shiftKey ? 15 : 90));
    else return false;
    if (this.lastMove) this.pointerMove(this.lastMove);
    return true;
  }

  cancel(): boolean {
    if (!this.press) return false;
    this.press = null;
    this.host.setGhosts([]);
    return true;
  }

  leave(): void {
    if (!this.press) this.host.setGhosts([]);
  }

  deactivate(): void {
    this.host.setGhosts([]);
  }
}

export class ColumnTool implements PlanTool {
  readonly name = 'column';
  private rotation = 0;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint(`${this.host.item.name}: click to place (snaps to grid and wall points) · R rotates`);
  }

  pointerMove(e: ToolPointer): void {
    const s = this.host.snap(e.world);
    this.host.setGhosts([{ ...makeFromItem<Column>(this.host, { position: s.point, rotation: this.rotation }), id: '__ghost_column' }], 'valid');
    this.host.setOverlay(s.kind !== 'none' ? [{ t: 'snap', p: s.point, kind: s.kind }] : []);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const s = this.host.snap(e.world);
    const c = makeFromItem<Column>(this.host, { position: s.point, rotation: this.rotation });
    this.host.transact('Place column', (tx) => tx.add(c));
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey) return false;
    this.rotation = normDeg(this.rotation + (e.shiftKey ? 15 : 90));
    return true;
  }

  leave(): void {
    this.host.setGhosts([]);
    this.host.setOverlay([]);
  }

  deactivate(): void {
    this.leave();
  }
}

export class BlockTool implements PlanTool {
  readonly name = 'block';
  private rotation = 0;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint(`${this.host.item.name}: click to place a block on the grid · clicking on a block stacks on top`);
  }

  /** Cell (min corner) and stacking height for a pointer at `p`. */
  placementAt(p: Vec2): { position: { x: number; y: number; z: number }; layer: number } {
    const host = this.host;
    const proto = makeFromItem<Block>(host, {});
    const sx = proto.size.x;
    const sy = proto.size.y;
    const snap = host.app.ui.get().snapGrid;
    const x = snap ? Math.floor(p.x / sx) * sx : Math.round(p.x - sx / 2);
    const y = snap ? Math.floor(p.y / sy) * sy : Math.round(p.y - sy / 2);
    const c = { x: x + sx / 2, y: y + sy / 2 };
    let z = 0;
    let layer = 0;
    for (const el of host.levelElements()) {
      if (el.type !== 'block' || !pointInPolygon(c, blockOutline(el))) continue;
      const top = el.position.z + el.size.z;
      if (top > z) {
        z = top;
        layer++;
      }
    }
    return { position: { x, y, z }, layer };
  }

  pointerMove(e: ToolPointer): void {
    const pl = this.placementAt(e.world);
    this.host.setGhosts([{ ...makeFromItem<Block>(this.host, { position: pl.position, rotation: this.rotation }), id: '__ghost_block' }], 'valid');
    this.host.setOverlay(pl.position.z > 0 ? [{ t: 'tag', p: e.world, text: `Stack +${this.host.fmt(pl.position.z)}`, tone: 'info', dy: 24 }] : []);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const pl = this.placementAt(e.world);
    const b = makeFromItem<Block>(this.host, { position: pl.position, rotation: this.rotation });
    this.host.transact('Place block', (tx) => tx.add(b));
    this.pointerMove(e);
  }

  leave(): void {
    this.host.setGhosts([]);
    this.host.setOverlay([]);
  }

  deactivate(): void {
    this.leave();
  }
}
