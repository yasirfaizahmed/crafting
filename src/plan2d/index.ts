/**
 * 2D blueprint (floor plan) editor.
 *
 *   mountPlanEditor(container, ctx) → PlanHandle
 *
 * Canvas plan of the ACTIVE level (plus the level below, faded) with CAD-style drafting tools
 * driven by the hotbar item in hand, snapping, blueprint image tracing and "Generate 3D".
 */
import type { AppContext } from '../app/state';
import type { Vec2 } from '../core/types';
import { registerPlanCommands } from './commands';
import { PlanEditor, type PlanEditorOptions } from './editor';
import { bindInput } from './input';
import './plan2d.css';
import { Toolbar } from './toolbar';
import type { PlanHandle } from './types';

export type { PlanHandle } from './types';
export { PlanEditor } from './editor';

/** Test/debug hook attached to the plan canvas (`canvas.__plan`). */
export interface PlanDebugHook {
  worldToClient(x: number, y: number): Vec2;
  clientToWorld(x: number, y: number): Vec2;
  editor: PlanEditor;
}

export interface MountedPlan extends PlanHandle {
  editor: PlanEditor;
}

/** Mount the editor and return the editor instance too (tests, embedding). */
export function createPlanEditor(container: HTMLElement, ctx: AppContext, opts: PlanEditorOptions = {}): MountedPlan {
  const editor = new PlanEditor(container, ctx, opts);
  const unbind = bindInput(editor);
  const toolbar = new Toolbar(editor);
  const unregister = registerPlanCommands(editor);
  let ro: ResizeObserver | null = null;
  const onWinResize = () => editor.resize();
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => editor.resize());
    ro.observe(editor.root);
  } else window.addEventListener('resize', onWinResize);
  const hook: PlanDebugHook = {
    editor,
    worldToClient: (x, y) => {
      const r = editor.canvas.getBoundingClientRect();
      const s = editor.view.toScreen({ x, y });
      return { x: r.left + s.x, y: r.top + s.y };
    },
    clientToWorld: (x, y) => {
      const r = editor.canvas.getBoundingClientRect();
      return editor.view.toWorld({ x: x - r.left, y: y - r.top });
    },
  };
  Object.defineProperty(editor.canvas, '__plan', { value: hook, enumerable: false, configurable: true });
  editor.resize();
  return {
    editor,
    resize: () => editor.resize(),
    setActive: (active) => editor.setActive(active),
    frame: (ids) => editor.frame(ids),
    dispose: () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWinResize);
      unregister();
      toolbar.dispose();
      unbind();
      editor.dispose();
    },
  };
}

export function mountPlanEditor(container: HTMLElement, ctx: AppContext): PlanHandle {
  const { resize, setActive, frame, dispose } = createPlanEditor(container, ctx);
  return { resize, setActive, frame, dispose };
}
