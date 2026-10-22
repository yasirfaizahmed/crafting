/**
 * Wall tool: click-click chaining with live length/angle, typed exact lengths ("3.6m", "3600",
 * "12'6\"", optional "<angle"), closing the loop on the chain start, double-click / Enter / RMB /
 * Esc to finish. Each segment is one undo step.
 */
import { add, angleDeg, dirFromDeg, distance, normalize, sub } from '../../core/math2d';
import type { Vec2, Wall } from '../../core/types';
import type { OverlayItem } from '../editor-types';
import type { SnapResult } from '../snapping';
import { LengthInput, makeWall } from './common';
import type { PlanTool, ToolHost, ToolPointer } from './types';

export class WallTool implements PlanTool {
  readonly name = 'wall';
  private pts: Vec2[] = [];
  private cur: SnapResult | null = null;
  private input = new LengthInput();
  /** Id of the segment committed last in this chain (Backspace steps back over it). */
  private lastWallId: string | null = null;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.hint();
  }

  busy(): boolean {
    return this.pts.length > 0;
  }

  /** Points of the current chain (first = chain start). */
  get chain(): readonly Vec2[] {
    return this.pts;
  }

  private hint(): void {
    this.host.setHint(
      this.pts.length
        ? 'Wall: click the next point · type a length + Enter (e.g. 3.6m, 3600, 12\'6") · click the start to close · double-click / Enter / right-click to finish'
        : `${this.host.item.name}: click to start a wall chain`,
    );
  }

  pointerMove(e: ToolPointer): void {
    const last = this.pts[this.pts.length - 1];
    this.cur = this.host.snap(e.world, { from: last, track: this.pts });
    this.update();
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const last = this.pts[this.pts.length - 1];
    const s = this.cur && distance(this.host.view.toScreen(this.cur.point), e.screen) < 40 ? this.cur : this.host.snap(e.world, { from: last, track: this.pts });
    this.addPoint(s.point);
  }

  /** Add a chain point: the first starts the chain, the next ones commit wall segments. */
  addPoint(p: Vec2): void {
    const host = this.host;
    if (!this.pts.length) {
      this.pts = [{ ...p }];
      this.hint();
      this.update();
      return;
    }
    const last = this.pts[this.pts.length - 1];
    if (distance(last, p) < 1) return;
    const closing = this.pts.length >= 2 && distance(p, this.pts[0]) < 1;
    const wall = makeWall(host, host.item, last, p);
    host.transact('Draw wall', (tx) => tx.add(wall));
    this.lastWallId = wall.id;
    if (closing) {
      this.finish();
      return;
    }
    this.pts.push({ ...p });
    this.input.clear();
    this.update();
  }

  doubleClick(): void {
    this.finish();
  }

  contextClick(): void {
    this.finish();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') {
      if (this.input.active) this.applyTyped();
      else this.finish();
      return true;
    }
    if (this.input.key(e)) {
      this.update();
      return true;
    }
    if (e.key === 'Backspace') {
      this.stepBack();
      return true;
    }
    // While drawing, Delete never deletes the selection.
    return e.key === 'Delete';
  }

  /** Undo the last committed segment of this chain (or drop the start point). */
  private stepBack(): void {
    const store = this.host.app.store;
    if (this.pts.length >= 2 && this.lastWallId && store.getElement(this.lastWallId) && store.undoLabel === 'Draw wall') {
      store.undo();
      this.pts.pop();
      this.lastWallId = null;
    } else if (this.pts.length === 1) this.pts = [];
    this.hint();
    this.update();
  }

  /** Commit the typed length along the current direction (or the typed angle). */
  applyTyped(): boolean {
    const host = this.host;
    const last = this.pts[this.pts.length - 1];
    const v = this.input.value(host.app.ui.get().displayUnits);
    if (!last || !v) {
      host.toast(`Can't read "${this.input.text}" as a length`, 'warning');
      return false;
    }
    let dir: Vec2;
    if (v.angle !== undefined) dir = dirFromDeg(v.angle);
    else {
      const to = this.cur?.point;
      dir = to && distance(to, last) > 1e-6 ? normalize(sub(to, last)) : { x: 1, y: 0 };
    }
    const p = add(last, { x: dir.x * v.length, y: dir.y * v.length });
    const r = (x: number) => Math.round(x * 1000) / 1000;
    this.input.clear();
    this.addPoint({ x: r(p.x), y: r(p.y) });
    return true;
  }

  cancel(): boolean {
    if (!this.pts.length) return false;
    this.finish();
    return true;
  }

  private finish(): void {
    this.pts = [];
    this.lastWallId = null;
    this.input.clear();
    this.host.setGhosts([]);
    this.hint();
    this.update();
  }

  private update(): void {
    const host = this.host;
    const s = this.cur;
    const items: OverlayItem[] = [];
    const last = this.pts[this.pts.length - 1];
    if (s) {
      for (const g of s.guides) items.push(g.kind === 'angle' ? { t: 'line', a: g.from, b: g.to, dash: [2, 4], width: 1, color: 'rgba(47,124,246,0.6)' } : { t: 'guide', a: g.from, b: g.to });
      if (s.kind !== 'none' && s.kind !== 'angle') items.push({ t: 'snap', p: s.point, kind: s.kind });
      else items.push({ t: 'point', p: s.point, r: 3 });
    }
    if (last && s) {
      let end = s.point;
      if (this.input.active) {
        const v = this.input.value(host.app.ui.get().displayUnits);
        if (v) {
          const dir = v.angle !== undefined ? dirFromDeg(v.angle) : distance(end, last) > 1e-6 ? normalize(sub(end, last)) : { x: 1, y: 0 };
          end = add(last, { x: dir.x * v.length, y: dir.y * v.length });
        }
      }
      const len = distance(last, end);
      const ghost: Wall = { ...makeWall(host, host.item, last, end), id: '__ghost_wall' };
      host.setGhosts(len > 1 ? [ghost] : [], 'neutral');
      if (len > 1) {
        items.push({ t: 'dim', a: last, b: end, offset: 28 + ghost.thickness * host.view.scale * 0.5, text: host.fmt(len) });
        const ang = angleDeg(sub(end, last));
        items.push({ t: 'arc', c: last, r: 26, a0: 0, a1: ang });
        const closing = this.pts.length >= 2 && distance(end, this.pts[0]) < 1;
        items.push(
          this.input.active
            ? { t: 'tag', p: end, text: `${this.input.text}▏`, sub: 'Enter ↵', tone: 'accent' }
            : { t: 'tag', p: end, text: closing ? 'Close loop' : host.fmt(len), sub: `${Math.round(((ang % 360) + 360) % 360)}°`, tone: closing ? 'success' : 'info' },
        );
      }
      if (this.pts.length >= 2) items.push({ t: 'point', p: this.pts[0], r: 4.5, color: '#12a150' });
    } else host.setGhosts([]);
    host.setOverlay(items);
  }

  leave(): void {
    if (!this.pts.length) {
      this.cur = null;
      this.host.setOverlay([]);
    }
  }

  deactivate(): void {
    this.host.setGhosts([]);
  }
}
