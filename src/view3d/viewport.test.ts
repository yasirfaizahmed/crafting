// @vitest-environment jsdom
/**
 * Drives the real Viewport input pipeline (mouse → click detection → picking → tools → store)
 * in jsdom with a stand-in renderer: everything except actual WebGL drawing runs.
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context';
import { createSampleProject } from '../app/sample';
import type { AppContext } from '../app/state';
import type { Element } from '../core/types';
import type { ViewportHandle } from './types';
import { Viewport, type ViewportDebug } from './viewport';

const W = 800;
const H = 600;

function fakeRenderer() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(canvas, 'clientWidth', { value: W });
  Object.defineProperty(canvas, 'clientHeight', { value: H });
  let loop: ((t: number) => void) | null = null;
  const r = {
    domElement: canvas,
    capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 4096 },
    shadowMap: { enabled: true, needsUpdate: false, autoUpdate: false, type: THREE.PCFSoftShadowMap },
    info: { render: { calls: 0, triangles: 0 } },
    renders: 0,
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    getPixelRatio: () => 1,
    getSize: (v: THREE.Vector2) => v.set(W, H),
    render: () => {
      r.renders++;
    },
    setAnimationLoop: (fn: ((t: number) => void) | null) => {
      loop = fn;
    },
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
    tick: (t: number) => loop?.(t),
  };
  return r;
}

let time = 0;
function tick(r: ReturnType<typeof fakeRenderer>, frames = 1): void {
  for (let i = 0; i < frames; i++) r.tick((time += 16));
}

interface Rig {
  ctx: AppContext;
  r: ReturnType<typeof fakeRenderer>;
  container: HTMLElement;
  handle: ViewportHandle;
  debug: ViewportDebug;
}

const rigs: Rig[] = [];

function mount(): Rig {
  const ctx = createAppContext(createSampleProject());
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: W });
  Object.defineProperty(container, 'clientHeight', { value: H });
  document.body.appendChild(container);
  const r = fakeRenderer();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const vp = new Viewport(container, ctx, r as unknown as THREE.WebGLRenderer);
  warn.mockRestore();
  const handle = vp.handle();
  const debug = (container as unknown as { __view3d: ViewportDebug }).__view3d;
  tick(r, 3);
  const rig = { ctx, r, container, handle, debug };
  rigs.push(rig);
  return rig;
}

afterEach(() => {
  for (const rig of rigs.splice(0)) rig.handle.dispose();
  document.body.innerHTML = '';
});

function hold(ctx: AppContext, id: string): void {
  const hotbar = [...ctx.ui.get().hotbar];
  hotbar[0] = id;
  ctx.ui.set({ hotbar, hotbarIndex: 0 });
}

function click(rig: Rig, p: { x: number; y: number }, button: number, opts: MouseEventInit = {}): void {
  const c = rig.r.domElement;
  c.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y, bubbles: true }));
  tick(rig.r);
  c.dispatchEvent(new MouseEvent('mousedown', { clientX: p.x, clientY: p.y, button, bubbles: true, ...opts }));
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: p.x, clientY: p.y, button, bubbles: true, ...opts }));
  tick(rig.r);
}

function at(rig: Rig, x: number, y: number, e = 0): { x: number; y: number } {
  const p = rig.debug.worldToClient(x, y, e);
  expect(p).not.toBeNull();
  return p!;
}

const ofType = (ctx: AppContext, t: Element['type']) => ctx.store.elements.filter((e) => e.type === t);

describe('viewport input pipeline (jsdom, stand-in renderer)', () => {
  it('mounts: canvas, HUD, commands, model and a first render', () => {
    const rig = mount();
    expect(rig.container.querySelector('canvas')).toBe(rig.r.domElement);
    expect(rig.container.querySelector('.v3d-hud')).not.toBeNull();
    expect(rig.container.dataset.view3d).toBe('ready');
    expect(rig.container.tabIndex).toBe(0);
    expect(rig.r.renders).toBeGreaterThan(0);
    expect(rig.debug.stats().elements).toBeGreaterThan(30);
    expect(rig.ctx.commands.get('view.toggleCamera')).toBeDefined();
  });

  it('RMB twice places a wall, LMB on it breaks it', () => {
    const rig = mount();
    hold(rig.ctx, 'wall-200');
    const n = ofType(rig.ctx, 'wall').length;
    click(rig, at(rig, 1000, -4000), 2);
    click(rig, at(rig, 4000, -4000), 2);
    expect(ofType(rig.ctx, 'wall').length).toBe(n + 1);
    expect(rig.ctx.store.undoLabel).toBe('Place wall');
    // Escape ends the chain (consumed by the 3D view).
    const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    rig.container.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    click(rig, at(rig, 2500, -4100, 1500), 0);
    expect(ofType(rig.ctx, 'wall').length).toBe(n);
    expect(rig.ctx.store.undoLabel).toBe('Break wall');
  });

  it('a drag is not a click: nothing is placed', () => {
    const rig = mount();
    hold(rig.ctx, 'block-brick');
    const n = ofType(rig.ctx, 'block').length;
    const p = at(rig, -3000, -3000);
    const c = rig.r.domElement;
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: p.x, clientY: p.y, button: 2, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x + 40, clientY: p.y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: p.x + 40, clientY: p.y, button: 2, bubbles: true }));
    tick(rig.r);
    expect(ofType(rig.ctx, 'block').length).toBe(n);
    click(rig, p, 2);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 1);
  });

  it('MMB picks the pointed element into the hotbar', () => {
    const rig = mount();
    hold(rig.ctx, 'tool-select');
    click(rig, at(rig, 3000, -125, 1500), 1);
    const ui = rig.ctx.ui.get();
    expect(ui.hotbar[ui.hotbarIndex]).toBe('wall-brick');
  });

  it('keys work only while focused and are consumed; the context menu is suppressed', () => {
    const rig = mount();
    const key = (k: string) => {
      const e = new KeyboardEvent('keydown', { key: k, code: `Key${k.toUpperCase()}`, bubbles: true, cancelable: true });
      rig.container.dispatchEvent(e);
      return e;
    };
    const x = key('x');
    expect(x.defaultPrevented).toBe(true);
    expect(rig.ctx.ui.get().xray).toBe(true);
    key('c');
    expect(rig.ctx.ui.get().cutAboveActive).toBe(true);
    // Global dispatchers see the 'when' guard: not focused → false; focused → true.
    const cmd = rig.ctx.commands.get('view.toggleCamera')!;
    expect(cmd.when!()).toBe(false);
    rig.container.focus();
    expect(cmd.when!()).toBe(true);
    key('f');
    expect(rig.ctx.ui.get().cameraMode).toBe('fly');
    expect(rig.debug.stats().mode).toBe('fly');
    // Unrelated keys bubble to the global keymap.
    const one = key('1');
    expect(one.defaultPrevented).toBe(false);
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    rig.r.domElement.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('fly mode: the wheel cycles the hotbar; Escape-released lock shows the resume overlay', () => {
    const rig = mount();
    rig.ctx.ui.set({ cameraMode: 'fly', hotbarIndex: 8 });
    tick(rig.r);
    const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    rig.r.domElement.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(rig.ctx.ui.get().hotbarIndex).toBe(0);
    rig.r.domElement.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(rig.ctx.ui.get().hotbarIndex).toBe(8);
    expect(rig.container.querySelector('.v3d-overlay')!.classList.contains('v3d-show')).toBe(true);
    expect((rig.container.querySelector('.v3d-crosshair') as HTMLElement).style.display).toBe('');
    rig.ctx.ui.set({ cameraMode: 'orbit' });
    expect(rig.container.querySelector('.v3d-overlay')!.classList.contains('v3d-show')).toBe(false);
  });

  it('cross-highlights hover from the plan and emits its own hover events', () => {
    const rig = mount();
    const seen: (string | null)[] = [];
    rig.ctx.events.on('hover', (e) => {
      if (e.source === '3d') seen.push(e.id);
    });
    const p = at(rig, 3000, -125, 1500);
    rig.r.domElement.dispatchEvent(new MouseEvent('mousemove', { clientX: p.x, clientY: p.y, bubbles: true }));
    tick(rig.r);
    expect(seen.length).toBe(1);
    expect(rig.ctx.store.getElement(seen[0]!)?.type).toBe('wall');
    expect(rig.debug.stats().hover).toBe(seen[0]);
    expect(rig.container.querySelector('.v3d-info')!.classList.contains('v3d-show')).toBe(true);
  });

  it('store changes rebuild incrementally; selection survives; dispose cleans up', () => {
    const rig = mount();
    const before = rig.debug.stats().elements as number;
    rig.ctx.store.remove(ofType(rig.ctx, 'furniture')[0].id);
    tick(rig.r);
    expect(rig.debug.stats().elements).toBe(before - 1);
    rig.ctx.store.undo();
    tick(rig.r);
    expect(rig.debug.stats().elements).toBe(before);
    rig.handle.setActive(false);
    const renders = rig.r.renders;
    rig.ctx.ui.set({ xray: true });
    tick(rig.r, 3);
    expect(rig.r.renders).toBe(renders);
    rig.handle.setActive(true);
    tick(rig.r);
    expect(rig.r.renders).toBeGreaterThan(renders);
    rig.handle.dispose();
    rigs.splice(rigs.indexOf(rig), 1);
    expect(rig.container.querySelector('canvas')).toBeNull();
    expect(rig.container.querySelector('.v3d-hud')).toBeNull();
    expect(rig.ctx.commands.get('view.toggleCamera')).toBeUndefined();
    expect(rig.r.dispose).toHaveBeenCalled();
  });
});
