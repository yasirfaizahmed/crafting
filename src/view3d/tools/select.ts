/**
 * Select / move tool: LMB selects (Shift toggles), LMB-drag moves the selection on its plane,
 * R rotates selected furniture (Shift+R −15°).
 */
import type { Element, Vec2 } from '../../core/types';
import { formatLength } from '../../core/units';
import { typeName } from './actions';
import { moveElements, previewSet, rotateElements, type MoveResult } from './move';
import { snapToGrid } from './snapping';
import type { KeyInput, PickHit, Tool, ToolEnv } from './types';

interface DragState {
  grab: Vec2;
  elevation: number;
  ids: string[];
  delta: Vec2;
  result: MoveResult | null;
}

export class SelectTool implements Tool {
  private drag: DragState | null = null;

  constructor(private readonly env: ToolEnv) {}

  get dragging(): boolean {
    return !!this.drag;
  }

  hover(hit: PickHit | null): void {
    if (this.drag) return;
    const el = hit?.elementId ? this.env.ctx.store.getElement(hit.elementId) : undefined;
    const n = this.env.ctx.selection.get().length;
    const sel = n ? ` · ${n} selected (R rotate, Del delete)` : '';
    this.env.hint(el ? `LMB: select ${el.name ?? typeName(el)} (Shift adds) · drag to move${sel}` : `Select: LMB an element${sel}`);
  }

  use(): void {
    // RMB with the select tool does nothing (camera orbit in orbit mode).
  }

  primary(hit: PickHit | null, mods?: { shift: boolean }): boolean {
    const { selection } = this.env.ctx;
    const id = hit?.elementId;
    if (!id) {
      if (!mods?.shift) selection.clear();
      return true;
    }
    if (mods?.shift) selection.toggle(id);
    else selection.set([id]);
    this.hover(hit);
    return true;
  }

  beginDrag(hit: PickHit, additive: boolean): boolean {
    const { selection, store } = this.env.ctx;
    const id = hit.elementId;
    if (!id || !store.getElement(id)) return false;
    if (!selection.has(id)) {
      if (additive) selection.set([...selection.get(), id]);
      else selection.set([id]);
    }
    const ids = selection.get().filter((x) => {
      const el = store.getElement(x);
      return el && !el.locked;
    });
    if (!ids.length) {
      this.env.toast('Selection is locked', 'warning');
      return false;
    }
    this.drag = { grab: { ...hit.point }, elevation: hit.elevation, ids, delta: { x: 0, y: 0 }, result: null };
    return true;
  }

  /** Elevation of the horizontal drag plane, mm. */
  get dragElevation(): number | null {
    return this.drag?.elevation ?? null;
  }

  dragTo(point: Vec2): void {
    const d = this.drag;
    if (!d) return;
    const ui = this.env.ctx.ui.get();
    const step = ui.snapGrid ? Math.max(10, this.env.ctx.store.project.settings.gridSize / 5) : 10;
    const delta = snapToGrid({ x: point.x - d.grab.x, y: point.y - d.grab.y }, step);
    if (d.result && delta.x === d.delta.x && delta.y === d.delta.y) return;
    d.delta = delta;
    if (delta.x === 0 && delta.y === 0) {
      d.result = null;
      this.env.ghost.clear();
      return;
    }
    const project = this.env.ctx.store.project;
    d.result = moveElements(project, d.ids, delta);
    const preview = previewSet(project, d.result.elements);
    this.env.ghost.show(preview, d.result.valid, { solid: true, hide: preview.map((e) => e.id) });
    const units = ui.displayUnits;
    const text = `Δ ${formatLength(Math.hypot(delta.x, delta.y), units)}`;
    this.env.ghost.label(text, { point: point, elevation: d.elevation + 400 });
    this.env.hint(`Move ${text} (x ${formatLength(delta.x, units)}, y ${formatLength(delta.y, units)}) — release to drop · Esc cancel`);
  }

  endDrag(commit: boolean): void {
    const d = this.drag;
    this.drag = null;
    this.env.ghost.clear();
    if (!d || !commit || !d.result || !d.result.elements.length) return;
    if (!d.result.valid) {
      this.env.toast('Cannot move there', 'warning');
      return;
    }
    const moved = d.result.elements;
    const label = d.ids.length === 1 ? `Move ${this.describe(d.ids[0])}` : `Move ${d.ids.length} elements`;
    this.env.ctx.store.transact(label, (tx) => moved.forEach((e) => tx.replace(e)));
  }

  key(e: KeyInput): boolean {
    if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey) return false;
    const { store, selection } = this.env.ctx;
    const rotated = rotateElements(store.project, selection.get(), e.shiftKey ? -15 : 90);
    if (!rotated.length) return false;
    store.transact(rotated.length === 1 ? `Rotate ${this.describe(rotated[0].id)}` : `Rotate ${rotated.length} elements`, (tx) =>
      rotated.forEach((el: Element) => tx.replace(el)),
    );
    return true;
  }

  cancel(): boolean {
    if (!this.drag) return false;
    this.endDrag(false);
    return true;
  }

  dispose(): void {
    this.drag = null;
    this.env.ghost.clear();
  }

  private describe(id: string): string {
    const el = this.env.ctx.store.getElement(id);
    return el ? typeName(el) : 'element';
  }
}
