/**
 * Area tools — room, slab and roof. Shared interaction: drag a rectangle, or click polygon points
 * (close on the first point / Enter / double-click), or click inside an enclosed area.
 */
import { interiorPoint, nextRoomName, nextRoomNumber, orientedBounds, outerFootprints } from '../../core/autobuild';
import { createElement } from '../../core/defaults';
import { distance, ensureCCW, pointInPolygon, polygonArea, signedArea } from '../../core/math2d';
import { detectRooms, pointInDetectedRoom, type DetectedRoom } from '../../core/rooms';
import type { Element, Roof, Room, Slab, Vec2, Wall } from '../../core/types';
import { formatArea } from '../../core/units';
import { rectCorners, wallSegmentsAlong } from '../edit-ops';
import type { OverlayItem } from '../editor-types';
import { offsetPolygon } from '../shapes';
import type { SnapResult } from '../snapping';
import { makeFromItem, makeWall, template, wallItemFor } from './common';
import type { PlanTool, ToolHost, ToolPointer } from './types';

type State = 'idle' | 'press' | 'rect' | 'poly';

const MIN_SIDE = 300;

export abstract class AreaTool implements PlanTool {
  abstract readonly name: string;
  protected state: State = 'idle';
  protected start: Vec2 | null = null;
  protected downScreen: Vec2 | null = null;
  protected pts: Vec2[] = [];
  protected cur: SnapResult | null = null;

  constructor(protected host: ToolHost) {}

  protected abstract label: string;
  /** Rectangle / polygon finished (CCW outline). */
  protected abstract create(outline: Vec2[]): void;
  /** Click without drag at `p`: return true if handled (e.g. inside an enclosed area). */
  protected abstract click(p: Vec2): boolean;
  /** Ghost elements for an outline being drawn. */
  protected abstract ghostsFor(outline: Vec2[]): Element[];
  /** Hover preview while idle. */
  protected abstract idleHover(p: Vec2, items: OverlayItem[]): void;

  activate(): void {
    this.hint();
  }

  protected hint(): void {
    this.host.setHint(
      this.state === 'poly'
        ? `${this.label}: click the next corner · click the first point / Enter / double-click to close · Backspace removes a point · Esc cancels`
        : `${this.label}: drag a rectangle · click inside an enclosed area · or click corner points for any shape`,
    );
  }

  busy(): boolean {
    return this.state !== 'idle';
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    if (this.state === 'poly') {
      const p = this.snapPoly(e.world).point;
      if (this.pts.length >= 3 && distance(this.host.view.toScreen(this.pts[0]), this.host.view.toScreen(p)) <= 10) {
        this.finishPoly();
        return;
      }
      if (distance(p, this.pts[this.pts.length - 1]) > 1) this.pts.push(p);
      this.updatePoly();
      return;
    }
    this.start = this.host.snap(e.world).point;
    this.downScreen = e.screen;
    this.state = 'press';
  }

  pointerMove(e: ToolPointer): void {
    switch (this.state) {
      case 'press':
        if (this.downScreen && distance(e.screen, this.downScreen) > 5) {
          this.state = 'rect';
          this.updateRect(e);
        }
        return;
      case 'rect':
        this.updateRect(e);
        return;
      case 'poly':
        this.cur = this.snapPoly(e.world);
        this.updatePoly();
        return;
      default: {
        this.cur = this.host.snap(e.world);
        const items: OverlayItem[] = [];
        if (this.cur.kind !== 'none') items.push({ t: 'snap', p: this.cur.point, kind: this.cur.kind });
        this.idleHover(e.world, items);
        this.host.setOverlay(items);
      }
    }
  }

  pointerUp(e: ToolPointer): void {
    if (e.button !== 0) return;
    if (this.state === 'press') {
      const start = this.start!;
      this.state = 'idle';
      if (!this.click(e.world)) {
        this.state = 'poly';
        this.pts = [start];
        this.cur = this.snapPoly(e.world);
        this.hint();
        this.updatePoly();
      }
      return;
    }
    if (this.state === 'rect') {
      const end = this.host.snap(e.world).point;
      const corners = rectCorners(this.start!, end);
      this.reset();
      if (corners[2].x - corners[0].x >= MIN_SIDE && corners[2].y - corners[0].y >= MIN_SIDE) this.create(corners);
      else this.host.toast('Rectangle too small', 'warning');
      this.pointerMove(e);
    }
  }

  doubleClick(): void {
    if (this.state === 'poly') this.finishPoly();
  }

  contextClick(): void {
    if (this.state === 'poly' && this.pts.length >= 3) this.finishPoly();
    else this.cancel();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (this.state !== 'poly') return false;
    if (e.key === 'Enter') {
      this.finishPoly();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (this.pts.length > 1) this.pts.pop();
      else this.reset();
      this.updatePoly();
      return true;
    }
    return false;
  }

  cancel(): boolean {
    if (this.state === 'idle') return false;
    this.reset();
    return true;
  }

  leave(): void {
    if (this.state === 'idle') {
      this.host.setOverlay([]);
      this.host.setGhosts([]);
    }
  }

  deactivate(): void {
    this.host.setGhosts([]);
  }

  protected reset(): void {
    this.state = 'idle';
    this.pts = [];
    this.start = null;
    this.downScreen = null;
    this.host.setGhosts([]);
    this.host.setOverlay([]);
    this.hint();
  }

  private snapPoly(raw: Vec2): SnapResult {
    return this.host.snap(raw, { from: this.pts[this.pts.length - 1], track: this.pts });
  }

  private finishPoly(): void {
    const pts = this.pts;
    this.reset();
    if (pts.length < 3 || Math.abs(signedArea(pts)) < MIN_SIDE * MIN_SIDE) {
      this.host.toast('Need at least three corners', 'warning');
      return;
    }
    this.create(ensureCCW(pts));
  }

  private updateRect(e: ToolPointer): void {
    const host = this.host;
    const s = host.snap(e.world, { track: this.start ? [this.start] : [] });
    const c = rectCorners(this.start!, s.point);
    const items: OverlayItem[] = [];
    if (s.kind !== 'none') items.push({ t: 'snap', p: s.point, kind: s.kind });
    for (const g of s.guides) items.push({ t: 'guide', a: g.from, b: g.to });
    const w = c[1].x - c[0].x;
    const h = c[2].y - c[1].y;
    if (w > 1 && h > 1) {
      items.push({ t: 'dim', a: c[3], b: c[2], offset: 30, text: host.fmt(w) });
      items.push({ t: 'dim', a: c[2], b: c[1], offset: 30, text: host.fmt(h) });
      items.push({ t: 'tag', p: s.point, text: formatArea(w * h, host.app.ui.get().displayUnits), sub: `${host.fmt(w)} × ${host.fmt(h)}`, tone: 'accent' });
      host.setGhosts(this.ghostsFor(c), w >= MIN_SIDE && h >= MIN_SIDE ? 'neutral' : 'invalid');
    } else host.setGhosts([]);
    host.setOverlay(items);
  }

  private updatePoly(): void {
    const host = this.host;
    const s = this.cur;
    const items: OverlayItem[] = [];
    const pts = s ? [...this.pts, s.point] : [...this.pts];
    if (s) {
      if (s.kind !== 'none' && s.kind !== 'angle') items.push({ t: 'snap', p: s.point, kind: s.kind });
      for (const g of s.guides) items.push(g.kind === 'angle' ? { t: 'line', a: g.from, b: g.to, dash: [2, 4], width: 1 } : { t: 'guide', a: g.from, b: g.to });
      const last = this.pts[this.pts.length - 1];
      if (last && distance(last, s.point) > 1) items.push({ t: 'dim', a: last, b: s.point, offset: 24, text: host.fmt(distance(last, s.point)) });
    }
    items.push({ t: 'poly', pts, closed: false, width: 1.5 });
    if (this.pts.length >= 2) items.push({ t: 'point', p: this.pts[0], r: 5, color: '#12a150' });
    if (pts.length >= 3) {
      host.setGhosts(this.ghostsFor(ensureCCW(pts)), 'neutral');
      items.push({ t: 'tag', p: pts[pts.length - 1], text: formatArea(polygonArea(pts), host.app.ui.get().displayUnits), sub: `${this.pts.length} pts`, tone: 'info' });
    } else host.setGhosts([]);
    host.setOverlay(items);
  }

  /** Smallest detected enclosed area containing `p`. */
  protected detectedAt(p: Vec2): DetectedRoom | undefined {
    return this.host
      .rooms()
      .filter((r) => pointInDetectedRoom(p, r))
      .sort((a, b) => a.area - b.area)[0];
  }

  /** Room elements on the level covering a detected area. */
  protected roomCovering(det: DetectedRoom): Room | undefined {
    const probe = interiorPoint(det.polygon);
    return this.host
      .levelElements()
      .find((e): e is Room => e.type === 'room' && e.outline.length >= 3 && (pointInPolygon(probe, e.outline) || pointInDetectedRoom(interiorPoint(e.outline), det)));
  }
}

export class RoomTool extends AreaTool {
  readonly name = 'room';
  protected label = 'Room';

  protected click(p: Vec2): boolean {
    const det = this.detectedAt(p);
    if (!det) return false;
    const existing = this.roomCovering(det);
    if (existing) {
      this.host.app.selection.set([existing.id]);
      this.host.toast(`“${existing.name}” already defines this space`, 'info');
      return true;
    }
    const host = this.host;
    const project = host.app.store.project;
    const room = this.makeRoom(ensureCCW(det.polygon), nextRoomName(project), nextRoomNumber(project, host.levelId));
    host.transact('Add room', (tx) => tx.add(room));
    host.toast(`${room.name} · ${formatArea(polygonArea(room.outline), host.app.ui.get().displayUnits)}`, 'success');
    return true;
  }

  private makeRoom(outline: Vec2[], name: string, number: string): Room {
    const t = template(this.host.item);
    const base = typeof t.name === 'string' && t.name !== 'Room' ? t.name : name;
    return createElement('room', this.host.levelId, { ...(t as Partial<Room>), outline, name: base, number });
  }

  /** Walls along the outline (sharing corners, skipping existing walls) + a Room, in one step. */
  protected create(outline: Vec2[]): void {
    const host = this.host;
    const store = host.app.store;
    const item = wallItemFor(host);
    const walls = host.levelElements().filter((e) => e.type === 'wall') as Wall[];
    const segs = wallSegmentsAlong(outline, true, walls);
    const name = nextRoomName(store.project);
    const number = nextRoomNumber(store.project, host.levelId);
    let made: Room | undefined;
    host.transact('Draw room', (tx) => {
      let thickness = 200;
      for (const [a, b] of segs) {
        const w = makeWall(host, item, a, b);
        thickness = w.thickness;
        tx.add(w);
      }
      const probe = interiorPoint(outline);
      const det = detectRooms(store.project, host.levelId)
        .filter((d) => pointInDetectedRoom(probe, d))
        .sort((x, y) => x.area - y.area)[0];
      const roomOutline = det ? ensureCCW(det.polygon) : offsetPolygon(outline, -thickness / 2);
      made = this.makeRoom(roomOutline, name, number);
      tx.add(made);
    });
    if (made) host.toast(`${made.name} · ${formatArea(polygonArea(made.outline), host.app.ui.get().displayUnits)} · ${segs.length} wall${segs.length === 1 ? '' : 's'}`, 'success');
  }

  protected ghostsFor(outline: Vec2[]): Element[] {
    const host = this.host;
    const item = wallItemFor(host);
    const walls = host.levelElements().filter((e) => e.type === 'wall') as Wall[];
    const segs = wallSegmentsAlong(outline, true, walls);
    const ghosts: Element[] = segs.map(([a, b], i) => ({ ...makeWall(host, item, a, b), id: `__ghost_wall_${i}` }));
    const t = segs.length ? makeWall(host, item, segs[0][0], segs[0][1]).thickness : 200;
    ghosts.push({ ...createElement('room', host.levelId, { outline: offsetPolygon(outline, -t / 2), name: '' }), id: '__ghost_room' });
    return ghosts;
  }

  protected idleHover(p: Vec2, items: OverlayItem[]): void {
    const det = this.detectedAt(p);
    if (!det) {
      this.host.setGhosts([]);
      return;
    }
    const existing = this.roomCovering(det);
    const ghost = { ...createElement('room', this.host.levelId, { outline: det.polygon, name: '' }), id: '__ghost_room' };
    this.host.setGhosts([ghost], existing ? 'neutral' : 'valid');
    const area = formatArea(det.area, this.host.app.ui.get().displayUnits);
    items.push({ t: 'tag', p, text: existing ? existing.name : 'Click to add room', sub: area, tone: existing ? 'info' : 'success' });
  }
}

export class SlabTool extends AreaTool {
  readonly name = 'slab';
  protected get label(): string {
    return this.host.item.name;
  }

  private makeSlab(outline: Vec2[], holes?: Vec2[][]): Slab {
    const t = template(this.host.item);
    const kind = (t.kind as Slab['kind']) ?? 'floor';
    return makeFromItem<Slab>(this.host, { outline, holes: holes?.length ? holes.map((h) => ensureCCW(h).reverse()) : undefined, topOffset: kind === 'ceiling' ? this.host.level.height : 0 });
  }

  protected click(p: Vec2): boolean {
    const det = this.detectedAt(p);
    if (!det) return false;
    const slab = this.makeSlab(ensureCCW(det.polygon), det.holes);
    this.host.transact(`Add ${slab.kind} slab`, (tx) => tx.add(slab));
    this.host.toast(`${this.host.item.name} · ${formatArea(polygonArea(slab.outline), this.host.app.ui.get().displayUnits)}`, 'success');
    return true;
  }

  protected create(outline: Vec2[]): void {
    const slab = this.makeSlab(outline);
    this.host.transact(`Draw ${slab.kind} slab`, (tx) => tx.add(slab));
  }

  protected ghostsFor(outline: Vec2[]): Element[] {
    return [{ ...this.makeSlab(outline), id: '__ghost_slab' }];
  }

  protected idleHover(p: Vec2, items: OverlayItem[]): void {
    const det = this.detectedAt(p);
    if (!det) {
      this.host.setGhosts([]);
      return;
    }
    this.host.setGhosts([{ ...this.makeSlab(det.polygon), id: '__ghost_slab' }], 'valid');
    items.push({ t: 'tag', p, text: 'Click to fill floor', sub: formatArea(det.area, this.host.app.ui.get().displayUnits), tone: 'success' });
  }
}

export class RoofTool extends AreaTool {
  readonly name = 'roof';
  protected get label(): string {
    return this.host.item.name;
  }

  private footprintAt(p: Vec2): Vec2[] | undefined {
    const project = this.host.app.store.project;
    const own = outerFootprints(project, this.host.levelId);
    const hit = own.find((o) => pointInPolygon(p, o));
    if (hit) return hit;
    if (own.length) return undefined;
    // Empty level: roof over the level below.
    const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
    const i = levels.findIndex((l) => l.id === this.host.levelId);
    if (i <= 0) return undefined;
    return outerFootprints(project, levels[i - 1].id).find((o) => pointInPolygon(p, o));
  }

  private makeRoof(outline: Vec2[]): Roof {
    const ob = orientedBounds(outline);
    return makeFromItem<Roof>(this.host, { outline, ridgeAngle: ob.angle });
  }

  protected click(p: Vec2): boolean {
    const fp = this.footprintAt(p);
    if (!fp) return false;
    const roof = this.makeRoof(fp);
    this.host.transact(`Add ${roof.shape} roof`, (tx) => tx.add(roof));
    return true;
  }

  protected create(outline: Vec2[]): void {
    const roof = this.makeRoof(outline);
    this.host.transact(`Draw ${roof.shape} roof`, (tx) => tx.add(roof));
  }

  protected ghostsFor(outline: Vec2[]): Element[] {
    return [{ ...this.makeRoof(outline), id: '__ghost_roof' }];
  }

  protected idleHover(p: Vec2, items: OverlayItem[]): void {
    const fp = this.footprintAt(p);
    if (!fp) {
      this.host.setGhosts([]);
      return;
    }
    this.host.setGhosts([{ ...this.makeRoof(fp), id: '__ghost_roof' }], 'valid');
    items.push({ t: 'tag', p, text: 'Click to roof this footprint', sub: formatArea(polygonArea(fp), this.host.app.ui.get().displayUnits), tone: 'success' });
  }
}
