/**
 * Select / move tool: click, Shift-click toggle, window (L→R) / crossing (R→L) box selection,
 * drag to move (joined walls stretch), handles (wall ends, vertices, rotate, opening jambs,
 * dimension offset), arrow-key nudge, R rotate, F flip doors.
 */
import { add, distance, sub } from '../../core/math2d';
import type { Door, Element, Label, Opening, Room, Vec2 } from '../../core/types';
import { moveElements, type Patch, rotated, withInsertedVertex } from '../edit-ops';
import type { Handle, OverlayItem } from '../editor-types';
import { applyHandle, handlesFor, sizeLabel, stairStretchLabel } from '../handles';
import { elementsInBox } from '../shapes';
import type { PlanTool, ToolHost, ToolPointer } from './types';

type Mode = 'idle' | 'press' | 'move' | 'box' | 'handle';

const DRAG_PX = 4;
const MAX_HANDLE_ELEMENTS = 12;

export class SelectTool implements PlanTool {
  readonly name = 'select';
  private mode: Mode = 'idle';
  private down: ToolPointer | null = null;
  private pressHit: Element | undefined;
  private wasSelected = false;
  private dragIds: string[] = [];
  private anchor: Vec2 = { x: 0, y: 0 };
  private handle: Handle | null = null;
  private handleBase: Element | null = null;
  private hot: string | null = null;
  private patch: Patch | null = null;
  private boxEnd: Vec2 | null = null;
  /** Pressed on an unselected room/slab/roof: a drag box-selects instead of moving the area. */
  private areaPress = false;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint('Select: click · Shift+click add · drag to move · drag empty space to box-select (→ window, ← crossing) · arrows nudge');
  }

  busy(): boolean {
    return this.mode !== 'idle' && this.mode !== 'press';
  }

  handles(): Handle[] {
    const ids = this.host.app.selection.get();
    if (!ids.length || ids.length > MAX_HANDLE_ELEMENTS || this.mode === 'move') return [];
    const elements = this.currentElements();
    const out: Handle[] = [];
    for (const id of ids) {
      const el = elements[id];
      if (!el || el.levelId !== this.host.levelId) continue;
      out.push(...handlesFor(el, { elements, px: (n) => this.host.tol(n), levelHeight: this.host.level.height }));
    }
    return out;
  }

  hotHandle(): string | null {
    return this.hot;
  }

  private currentElements(): Record<string, Element> {
    const els = this.host.app.store.project.elements;
    if (!this.patch) return els;
    const merged = { ...els };
    for (const [id, el] of this.patch) merged[id] = el;
    return merged;
  }

  private handleAt(screen: Vec2): Handle | null {
    let best: { h: Handle; d: number } | null = null;
    for (const h of this.handles()) {
      const d = distance(this.host.view.toScreen(h.p), screen);
      if (d <= 8 && (!best || d < best.d || (d === best.d && h.shape !== 'diamond'))) best = { h, d };
    }
    return best?.h ?? null;
  }

  pointerDown(e: ToolPointer): void {
    const sel = this.host.app.selection;
    this.down = e;
    const h = this.handleAt(e.screen);
    if (h) {
      const base = this.host.app.store.getElement(h.elementId);
      if (base) {
        this.mode = 'handle';
        this.handle = h;
        this.handleBase = base;
        this.hot = h.id;
        return;
      }
    }
    const hit = this.host.hit(e.world);
    this.pressHit = hit;
    this.wasSelected = !!hit && sel.has(hit.id);
    this.areaPress = !!hit && !this.wasSelected && !e.shift && (hit.type === 'room' || hit.type === 'slab' || hit.type === 'roof');
    if (hit) {
      if (e.shift) sel.toggle(hit.id);
      else if (!sel.has(hit.id)) sel.set([hit.id]);
      this.mode = 'press';
    } else {
      this.mode = 'box';
      this.boxEnd = null;
    }
  }

  pointerMove(e: ToolPointer): void {
    const host = this.host;
    switch (this.mode) {
      case 'idle': {
        const h = this.handleAt(e.screen);
        this.hot = h?.id ?? null;
        const hit = h ? undefined : host.hit(e.world);
        host.setHover(h ? h.elementId : (hit?.id ?? null));
        host.setCursor(h ? (h.cursor ?? 'pointer') : hit ? (hit.locked ? 'not-allowed' : 'move') : 'default');
        host.invalidate();
        return;
      }
      case 'press': {
        if (!this.down || distance(e.screen, this.down.screen) < DRAG_PX) return;
        if (this.areaPress) {
          this.mode = 'box';
          this.boxEnd = null;
          this.pointerMove(e);
          return;
        }
        const ids = host.app.selection.get().filter((id) => {
          const el = host.app.store.getElement(id);
          return el && !el.locked && el.levelId === host.levelId;
        });
        if (!ids.length || (this.pressHit && !host.app.selection.has(this.pressHit.id))) {
          this.mode = 'idle';
          return;
        }
        this.dragIds = ids;
        this.anchor = this.anchorFor(this.pressHit, this.down.world);
        this.mode = 'move';
        host.setHover(null);
        this.updateMove(e);
        return;
      }
      case 'move':
        this.updateMove(e);
        return;
      case 'box': {
        if (!this.down) return;
        if (distance(e.screen, this.down.screen) < DRAG_PX && !this.boxEnd) return;
        this.boxEnd = e.screen;
        const mode = e.screen.x >= this.down.screen.x ? 'window' : 'crossing';
        host.setOverlay([{ t: 'box', a: this.down.screen, b: e.screen, mode }]);
        return;
      }
      case 'handle':
        this.updateHandle(e);
        return;
    }
  }

  pointerUp(e: ToolPointer): void {
    const host = this.host;
    const sel = host.app.selection;
    switch (this.mode) {
      case 'press':
        // Plain click on an already selected element in a multi-selection: select just it.
        if (!e.shift && this.pressHit && this.wasSelected && sel.get().length > 1) sel.set([this.pressHit.id]);
        break;
      case 'move':
        if (this.patch) host.commitPatch(this.dragIds.length > 1 ? `Move ${this.dragIds.length} elements` : `Move ${host.app.store.getElement(this.dragIds[0])?.type ?? 'element'}`, this.patch);
        break;
      case 'box': {
        if (!this.down) break;
        if (!this.boxEnd) {
          if (!e.shift) sel.clear();
          break;
        }
        const a = host.view.toWorld(this.down.screen);
        const b = host.view.toWorld(e.screen);
        const box = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
        const mode = e.screen.x >= this.down.screen.x ? 'window' : 'crossing';
        const ids = elementsInBox(host.levelElements(), { elements: host.app.store.project.elements, footprints: host.footprints(), level: host.level }, box, mode);
        sel.set(e.shift ? [...sel.get(), ...ids] : ids);
        break;
      }
      case 'handle':
        if (this.patch && this.handle) host.commitPatch(labelForHandle(this.handle), this.patch);
        break;
      default:
        break;
    }
    this.reset();
    this.pointerMove(e);
  }

  private reset(): void {
    this.mode = 'idle';
    this.down = null;
    this.patch = null;
    this.handle = null;
    this.handleBase = null;
    this.boxEnd = null;
    this.host.setPreview(null);
    this.host.setOverlay([]);
  }

  cancel(): boolean {
    if (this.mode === 'idle' || this.mode === 'press') {
      this.mode = 'idle';
      return false;
    }
    this.reset();
    return true;
  }

  modelChanged(): void {
    if (this.mode === 'move' || this.mode === 'handle') {
      // The model changed under the drag (undo, another view): abandon the preview.
      this.reset();
    }
  }

  /** Characteristic point of the grabbed element, so snapping aligns the element, not the cursor. */
  private anchorFor(el: Element | undefined, grab: Vec2): Vec2 {
    if (!el) return grab;
    const nearest = (pts: Vec2[]) => pts.reduce((b, p) => (distance(p, grab) < distance(b, grab) ? p : b), pts[0]);
    switch (el.type) {
      case 'wall':
      case 'beam':
        return nearest([el.start, el.end]);
      case 'room':
      case 'slab':
      case 'roof':
        return el.outline.length ? nearest(el.outline) : grab;
      case 'railing':
        return el.path.length ? nearest(el.path) : grab;
      case 'dimension':
        return nearest([el.a, el.b]);
      case 'furniture':
      case 'column':
      case 'stair':
      case 'label':
        return el.position;
      case 'block':
        return { x: el.position.x, y: el.position.y };
      default:
        return grab;
    }
  }

  private updateMove(e: ToolPointer): void {
    const host = this.host;
    if (!this.down) return;
    const raw = add(this.anchor, sub(e.world, this.down.world));
    const onlyOpenings = this.dragIds.every((id) => {
      const t = host.app.store.getElement(id)?.type;
      return t === 'door' || t === 'window';
    });
    const s = onlyOpenings ? { point: raw, kind: 'none' as const, guides: [] } : host.snap(raw, { exclude: this.dragIds, angle: false });
    const delta = sub(s.point, this.anchor);
    this.patch = moveElements(host.app.store.project.elements, this.dragIds, delta);
    host.setPreview(this.patch);
    const items: OverlayItem[] = [];
    if (s.kind !== 'none' && s.kind !== 'grid') items.push({ t: 'snap', p: s.point, kind: s.kind });
    for (const g of s.guides) items.push({ t: 'guide', a: g.from, b: g.to });
    const dist = Math.hypot(delta.x, delta.y);
    if (dist > 0) {
      items.push({ t: 'line', a: this.anchor, b: s.point, dash: [4, 3], width: 1 });
      items.push({ t: 'tag', p: s.point, text: host.fmt(dist), sub: `Δx ${host.fmt(delta.x)}  Δy ${host.fmt(delta.y)}`, tone: 'accent' });
    }
    host.setOverlay(items);
  }

  private updateHandle(e: ToolPointer): void {
    const host = this.host;
    const h = this.handle;
    let base = this.handleBase;
    if (!h || !base || !this.down) return;
    if (h.kind === 'insert') {
      if (distance(e.screen, this.down.screen) < DRAG_PX) return;
      base = withInsertedVertex(base, h.index ?? 0, h.p);
      this.handleBase = base;
      this.handle = { ...h, kind: 'vertex', index: (h.index ?? 0) + 1, id: `${base.id}:vertex:${(h.index ?? 0) + 1}` };
      this.hot = this.handle.id;
      return this.updateHandle(e);
    }
    const items: OverlayItem[] = [];
    let target = e.world;
    const stretching = h.kind.startsWith('stair-') || h.kind === 'size';
    if (h.kind !== 'rotate' && h.kind !== 'offset' && h.kind !== 'opening-a' && h.kind !== 'opening-b' && !stretching) {
      const exclude = new Set<string>([base.id]);
      let from: Vec2 | undefined;
      if (base.type === 'wall') {
        from = h.kind === 'wall-start' ? base.end : base.start;
        // Walls sharing the dragged end move too: do not snap to them.
        const p = h.kind === 'wall-start' ? base.start : base.end;
        for (const w of host.levelElements()) if (w.type === 'wall' && (distance(w.start, p) < 3 || distance(w.end, p) < 3)) exclude.add(w.id);
      } else if (base.type === 'beam') from = h.kind === 'point-a' ? base.end : base.start;
      else if (h.kind === 'vertex') {
        const pts = base.type === 'railing' ? base.path : 'outline' in base ? (base.outline as Vec2[]) : [];
        const i = h.index ?? 0;
        if (pts.length > 1) from = pts[(i + pts.length - 1) % pts.length];
      }
      const s = host.snap(e.world, { exclude, from, faces: base.type === 'dimension' });
      target = s.point;
      if (s.kind !== 'none' && s.kind !== 'grid' && s.kind !== 'angle') items.push({ t: 'snap', p: s.point, kind: s.kind });
      for (const g of s.guides) items.push({ t: g.kind === 'angle' ? 'line' : 'guide', a: g.from, b: g.to } as OverlayItem);
      if (from) items.push({ t: 'dim', a: from, b: target, offset: 22, text: host.fmt(distance(from, target)) });
    }
    this.patch = applyHandle(h, base, target, { elements: host.app.store.project.elements, freeAngle: e.shift, levelHeight: host.level.height });
    const after = this.patch.get(base.id);
    if (after && h.kind === 'size') items.push({ t: 'tag', p: e.world, text: sizeLabel(after, (v) => host.fmt(v)), tone: 'accent' });
    if (after?.type === 'stair' && stretching) items.push({ t: 'tag', p: e.world, text: stairStretchLabel(h, after, host.level.height, (v) => host.fmt(v)), tone: 'accent' });
    if (after && h.kind === 'rotate' && 'rotation' in after) items.push({ t: 'tag', p: e.world, text: `${Math.round((after as { rotation: number }).rotation)}°`, tone: 'accent' });
    if (after && (after.type === 'door' || after.type === 'window') && (h.kind === 'opening-a' || h.kind === 'opening-b')) items.push({ t: 'tag', p: e.world, text: `Width ${host.fmt((after as Opening).width)}`, tone: 'accent' });
    host.setPreview(this.patch);
    host.setOverlay(items);
  }

  keyDown(e: KeyboardEvent): boolean {
    const host = this.host;
    const ids = host.app.selection.get().filter((id) => {
      const el = host.app.store.getElement(id);
      return el && !el.locked && el.levelId === host.levelId;
    });
    if (!ids.length || e.ctrlKey || e.metaKey || e.altKey) return false;
    const step = e.shiftKey ? 100 : 10;
    const arrows: Record<string, Vec2> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
    const d = arrows[e.key];
    if (d) {
      host.commitPatch('Nudge', moveElements(host.app.store.project.elements, ids, d));
      return true;
    }
    const k = e.key.toLowerCase();
    if (k === 'r') {
      const doors = ids.map((id) => host.app.store.getElement(id)).filter((el): el is Door => el?.type === 'door');
      if (doors.length && doors.length === ids.length) {
        host.transact('Flip door hinge', (tx) => doors.forEach((dr) => tx.update<Door>(dr.id, { hinge: dr.hinge === 'left' ? 'right' : 'left' })));
        return true;
      }
      const patch: Patch = new Map();
      const deg = e.shiftKey ? 15 : 90;
      for (const id of ids) {
        const el = host.app.store.getElement(id)!;
        if (el.type === 'door' || el.type === 'window') continue;
        patch.set(id, rotated(el, deg));
      }
      host.commitPatch('Rotate', patch);
      return patch.size > 0;
    }
    if (k === 'f') {
      const doors = ids.map((id) => host.app.store.getElement(id)).filter((el): el is Door => el?.type === 'door');
      if (!doors.length) return false;
      host.transact('Flip door swing', (tx) => doors.forEach((dr) => tx.update<Door>(dr.id, { flip: !dr.flip })));
      return true;
    }
    return false;
  }

  /** Double-click a room to rename it, a label to edit its text. */
  doubleClick(e: ToolPointer): void {
    const host = this.host;
    const el = host.hit(e.world);
    if (!el || el.locked) return;
    if (el.type === 'room') {
      host.prompt({
        at: { x: e.screen.x + 8, y: e.screen.y - 20 },
        label: 'Room name',
        value: el.name,
        onSubmit: (v) => {
          const name = v.trim();
          if (!name) return false;
          host.transact('Rename room', (tx) => tx.update<Room>(el.id, { name }));
        },
      });
    } else if (el.type === 'label') {
      host.prompt({
        at: { x: e.screen.x + 8, y: e.screen.y - 20 },
        label: 'Label text',
        value: el.text,
        onSubmit: (v) => {
          if (!v.trim()) return false;
          host.transact('Edit label', (tx) => tx.update<Label>(el.id, { text: v.trim() }));
        },
      });
    }
  }

  leave(): void {
    if (this.mode === 'idle') {
      this.host.setHover(null);
      this.hot = null;
    }
  }
}

function labelForHandle(h: Handle): string {
  switch (h.kind) {
    case 'wall-start':
    case 'wall-end':
      return 'Move wall end';
    case 'rotate':
      return 'Rotate';
    case 'opening-a':
    case 'opening-b':
      return 'Resize opening';
    case 'offset':
      return 'Move dimension line';
    default:
      return 'Edit shape';
  }
}
