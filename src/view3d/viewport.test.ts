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
import type { Door, Element, Furniture, Wall } from '../core/types';
import { pointAtOffset } from '../core/walls';
import type { ViewportHandle } from './types';
import { interaction, REPEAT_DELAY_MS, REPEAT_EVERY_MS, Viewport, WALK_REACH, type ViewportDebug } from './viewport';

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
  delete (document as unknown as { pointerLockElement?: unknown }).pointerLockElement;
  vi.restoreAllMocks();
});

/** Pretend the browser granted pointer lock to the 3D canvas (first person). */
function lock(rig: Rig): void {
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => rig.r.domElement });
  (document as unknown as { exitPointerLock: () => void }).exitPointerLock = () => {
    delete (document as unknown as { pointerLockElement?: unknown }).pointerLockElement;
    document.dispatchEvent(new Event('pointerlockchange'));
  };
  document.dispatchEvent(new Event('pointerlockchange'));
}

function press(rig: Rig, button: number, opts: MouseEventInit = {}): void {
  rig.r.domElement.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true, ...opts }));
}

function release(button: number): void {
  window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
}

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
    click(rig, at(rig, 3500, -125, 1500), 1);
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
    // F toggles orbit ⇄ first person, walking by default.
    key('f');
    expect(rig.ctx.ui.get().cameraMode).toBe('walk');
    expect(rig.debug.stats().mode).toBe('walk');
    expect(rig.debug.stats().flying).toBe(false);
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
    const p = at(rig, 3500, -125, 1500);
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
  it('first person acts on press and repeats while the button is held, like Minecraft', () => {
    let clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const rig = mount();
    hold(rig.ctx, 'block-brick');
    rig.ctx.ui.set({ cameraMode: 'fly' });
    lock(rig);
    rig.debug.lookFrom(-3000, -7000, 3000, -3000, -3000, 0);
    tick(rig.r);
    const n = ofType(rig.ctx, 'block').length;
    press(rig, 2);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 1); // on press, not on release
    tick(rig.r);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 1);
    clock += REPEAT_DELAY_MS;
    tick(rig.r);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 2);
    clock += REPEAT_EVERY_MS;
    tick(rig.r);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 3);
    release(2);
    clock += 1000;
    tick(rig.r);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 3); // release stops, and is not another click
    // Holding LMB keeps breaking.
    press(rig, 0);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 2);
    clock += REPEAT_DELAY_MS;
    tick(rig.r);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 1);
    release(0);
    expect(rig.container.querySelector('.v3d-hand')!.classList.contains('v3d-show')).toBe(true);
    expect(rig.container.querySelector('.v3d-hand')!.classList.contains('v3d-swing')).toBe(true);
  });

  it('walking, you can only reach what is near you; flying reaches far', () => {
    const rig = mount();
    hold(rig.ctx, 'block-brick');
    rig.ctx.ui.set({ cameraMode: 'walk' });
    lock(rig);
    const n = ofType(rig.ctx, 'block').length;
    // Standing on the ground looking at the ground ~30 m away: out of reach.
    rig.debug.lookFrom(-3000, -10000, 1620, -3000, -40000, 0);
    tick(rig.r, 5);
    press(rig, 2);
    release(2);
    expect(ofType(rig.ctx, 'block').length).toBe(n);
    // A few metres ahead: in reach.
    rig.debug.lookFrom(-3000, -10000, 1620, -3000, -10000 - (WALK_REACH - 2) * 1000, 0);
    tick(rig.r, 5);
    press(rig, 2);
    release(2);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 1);
    // Flying, the far ground is reachable.
    rig.ctx.ui.set({ cameraMode: 'fly' });
    rig.debug.lookFrom(-3000, -10000, 1620, -3000, -40000, 0);
    tick(rig.r);
    press(rig, 2);
    release(2);
    expect(ofType(rig.ctx, 'block').length).toBe(n + 2);
  });

  it('RMB opens a door with an animated swing (one undo step); Shift+RMB places against it instead', () => {
    let clock = 10_000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const rig = mount();
    hold(rig.ctx, 'block-brick');
    const door = ofType(rig.ctx, 'door').find((d) => (d as Door).style === 'single') as Door;
    const c = pointAtOffset(rig.ctx.store.getElement(door.hostId) as Wall, door.offset);
    const p = at(rig, c.x, c.y, 1100);
    expect(rig.debug.pickAtClient(p.x, p.y)?.elementId).toBe(door.id);
    const blocks = ofType(rig.ctx, 'block').length;
    click(rig, p, 2);
    expect((rig.ctx.store.getElement(door.id) as Door).openAngle).toBe(90);
    expect(rig.ctx.store.undoLabel).toBe('Open door');
    expect(ofType(rig.ctx, 'block').length).toBe(blocks);
    expect(rig.debug.stats().swinging).toBe(1);
    clock += 1000;
    tick(rig.r);
    expect(rig.debug.stats().swinging).toBe(0);
    rig.ctx.store.undo();
    tick(rig.r);
    expect((rig.ctx.store.getElement(door.id) as Door).openAngle ?? 0).toBe(0);
    click(rig, p, 2, { shiftKey: true });
    expect((rig.ctx.store.getElement(door.id) as Door).openAngle ?? 0).toBe(0);
    expect(ofType(rig.ctx, 'block').length).toBe(blocks + 1);
  });

  it('knows what a right click does by itself: swing doors open, light fixtures switch', () => {
    const rig = mount();
    const doors = ofType(rig.ctx, 'door') as Door[];
    expect(interaction(doors.find((d) => d.style === 'single'))).toBe('door');
    expect(interaction(doors.find((d) => d.style === 'sliding'))).toBeNull();
    const furniture = ofType(rig.ctx, 'furniture') as Furniture[];
    const lamp = furniture.find((f) => f.catalogId.includes('light') || f.catalogId.includes('lamp'))!;
    expect(interaction(lamp)).toBe('light');
    expect(interaction(furniture.find((f) => f.catalogId.includes('sofa')))).toBeNull();
    expect(interaction(undefined)).toBeNull();
  });
});
