/**
 * DOM input for the plan editor: pointer (mouse, pen, touch pinch), wheel zoom, keyboard.
 * Keys are handled on the editor's focusable root and stopPropagation()'d when consumed, so the
 * global shortcut dispatcher on window never sees them.
 */
import { distance } from '../core/math2d';
import type { Vec2 } from '../core/types';
import type { PlanEditor } from './editor';
import type { ToolPointer } from './tools/types';

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function bindInput(ed: PlanEditor): () => void {
  const canvas = ed.canvas;
  const root = ed.root;
  let pan: { last: Vec2; id: number } | null = null;
  let spaceDown = false;
  let leftDown = false;
  let rmb: Vec2 | null = null;
  const touches = new Map<number, Vec2>();
  let pinch: { dist: number; mid: Vec2 } | null = null;

  const local = (e: MouseEvent): Vec2 => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toPointer = (e: MouseEvent): ToolPointer => {
    const screen = local(e);
    return { screen, world: ed.view.toWorld(screen), button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  };
  const track = (tp: ToolPointer) => {
    ed.lastPointer = tp;
    ed.cursorWorld = tp.world;
  };
  const capture = (e: PointerEvent) => {
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic events have no active pointer to capture.
    }
  };
  const pinchState = (): { dist: number; mid: Vec2 } | null => {
    if (touches.size < 2) return null;
    const [a, b] = [...touches.values()];
    return { dist: distance(a, b), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onDown = (e: PointerEvent) => {
    if (document.activeElement !== root) root.focus({ preventScroll: true });
    ed.shiftDown = e.shiftKey;
    ed.hovered = true;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, local(e));
      if (touches.size === 2) {
        pinch = pinchState();
        if (leftDown) ed.activeTool.cancel?.();
        leftDown = false;
        return;
      }
    }
    capture(e);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      pan = { last: local(e), id: e.pointerId };
      ed.setCursor('grabbing');
      return;
    }
    const tp = toPointer(e);
    track(tp);
    if (e.button === 2) {
      rmb = tp.screen;
      return;
    }
    if (e.button === 0) {
      leftDown = true;
      ed.activeTool.pointerDown?.(tp);
      ed.invalidate();
    }
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, local(e));
      if (pinch) {
        const next = pinchState();
        if (next && pinch.dist > 0) {
          ed.view.zoomAt(next.mid, next.dist / pinch.dist);
          ed.view.panBy(next.mid.x - pinch.mid.x, next.mid.y - pinch.mid.y);
          pinch = next;
          ed.invalidate();
          ed.notifyView();
        }
        return;
      }
    }
    if (pan) {
      const p = local(e);
      ed.view.panBy(p.x - pan.last.x, p.y - pan.last.y);
      pan.last = p;
      ed.invalidate();
      ed.notifyView();
      return;
    }
    const tp = toPointer(e);
    track(tp);
    ed.hovered = true;
    ed.shiftDown = e.shiftKey;
    ed.activeTool.pointerMove?.(tp);
    ed.invalidate();
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (pinch) {
        if (touches.size < 2) pinch = null;
        return;
      }
    }
    if (pan) {
      pan = null;
      ed.setCursor(spaceDown ? 'grab' : 'default');
      ed.refreshPointer();
      return;
    }
    const tp = toPointer(e);
    track(tp);
    if (e.button === 2) {
      if (rmb && distance(rmb, tp.screen) < 6) {
        const t = ed.activeTool;
        if (t.contextClick) t.contextClick(tp);
        else t.cancel?.();
        ed.refreshPointer();
      }
      rmb = null;
      return;
    }
    if (e.button === 0 && leftDown) {
      leftDown = false;
      ed.activeTool.pointerUp?.(tp);
      ed.invalidate();
    }
  };

  const onDbl = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const tp = toPointer(e);
    ed.activeTool.doubleClick?.(tp);
    ed.refreshPointer();
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    ed.zoomBy(Math.min(4, Math.max(0.25, factor)), local(e));
    ed.refreshPointer();
  };

  const onContext = (e: Event) => e.preventDefault();

  const onEnter = () => {
    ed.hovered = true;
    const a = document.activeElement;
    if (!a || a === document.body || (!isEditable(a) && !root.contains(a))) root.focus({ preventScroll: true });
  };

  const onLeave = () => {
    if (pan || leftDown) return;
    ed.hovered = false;
    ed.activeTool.leave?.();
    ed.invalidate();
  };

  const consume = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== root) return;
    ed.shiftDown = e.shiftKey;
    if (e.key === ' ') {
      if (!e.repeat) {
        spaceDown = true;
        ed.setCursor('grab');
      }
      consume(e);
      return;
    }
    if (e.key === 'Shift') {
      ed.refreshPointer();
      return;
    }
    if (e.key === 'Escape') {
      if (ed.cancelOperation()) consume(e);
      return;
    }
    if (e.key === 'Home' && !e.ctrlKey && !e.metaKey) {
      ed.zoomToFit();
      consume(e);
      return;
    }
    const tool = ed.activeTool;
    if (tool.keyDown?.(e)) {
      consume(e);
      ed.refreshPointer();
      return;
    }
    if (tool.busy?.() && (e.key === 'Backspace' || e.key === 'Delete')) consume(e);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      spaceDown = false;
      ed.setCursor('default');
      ed.refreshPointer();
      e.stopPropagation();
    }
    if (e.key === 'Shift') {
      ed.shiftDown = false;
      ed.refreshPointer();
    }
  };

  const onBlur = () => {
    spaceDown = false;
    ed.shiftDown = false;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('pointerleave', onLeave);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('dblclick', onDbl);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContext);
    canvas.removeEventListener('pointerenter', onEnter);
    canvas.removeEventListener('pointerleave', onLeave);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
