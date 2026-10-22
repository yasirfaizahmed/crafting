/**
 * The 3D viewport: wires renderer, environment, model sync, camera modes, picking, tools, HUD,
 * effects and commands together and owns all input handling.
 */
import * as THREE from 'three';
import { activeItem, type AppContext, type UIState } from '../app/state';
import type { CatalogItem, ToolKind } from '../core/catalog';
import { planToWorld } from '../core/coords';
import type { ChangeSet } from '../core/store';
import type { Element, Project, Vec2 } from '../core/types';
import { formatLength } from '../core/units';
import { CameraController } from './camera';
import { registerViewCommands, VIEW_KEYS } from './commands';
import { Effects } from './effects';
import { Environment } from './environment';
import { GhostRenderer } from './ghost';
import { Hud } from './hud';
import { describeElement } from './info';
import { ClickTracker, isTypingTarget } from './input';
import { FixtureLights } from './lights';
import { MaterialLibrary } from './materials';
import { ModelSync, type HoverStyle, type ViewFilter } from './model';
import { Picker } from './picking';
import { captureFrame } from './renderer';
import { breakAt, createTool, pickBlockAt } from './tools';
import type { PickHit, Tool, ToolEnv } from './tools/types';
import type { CaptureOptions, ViewportHandle } from './types';
import type { WalkProbe } from './walker';

/** Plan points describing an element's extent (for framing elements without meshes). */
function planPoints(el: Element): Vec2[] {
  switch (el.type) {
    case 'room':
    case 'slab':
    case 'roof':
      return el.outline;
    case 'dimension':
      return [el.a, el.b];
    case 'wall':
    case 'beam':
      return [el.start, el.end];
    case 'railing':
      return el.path;
    case 'label':
    case 'furniture':
    case 'column':
    case 'stair':
      return [el.position];
    case 'block':
      return [el.position];
    default:
      return [];
  }
}

const HOVER_STYLE: Record<ToolKind, HoverStyle> = {
  select: 'full',
  eraser: 'full',
  eyedropper: 'full',
  paint: 'full',
  block: 'outline',
  door: 'outline',
  window: 'outline',
  roof: 'outline',
  furniture: 'outline',
  stair: 'outline',
  column: 'outline',
  wall: 'none',
  beam: 'none',
  railing: 'none',
  slab: 'none',
  measure: 'none',
  dimension: 'none',
  label: 'none',
  room: 'none',
};

interface DragState {
  pending: PickHit | null;
  shift: boolean;
  active: boolean;
  elevation: number;
}

/** Debug / E2E hook exposed as `container.__view3d`. */
export interface ViewportDebug {
  worldToClient(planX: number, planY: number, elevationMm?: number): { x: number; y: number } | null;
  pickAtClient(clientX: number, clientY: number): PickHit | null;
  stats(): Record<string, unknown>;
  renderNow(): void;
  /** Place the camera at a plan point / elevation looking at another one (instant). */
  lookFrom(x: number, y: number, elev: number, tx: number, ty: number, televation: number): void;
  /** Capture through the handle; resolves to the blob's type and byte size. */
  capture(options?: CaptureOptions): Promise<{ type: string; size: number }>;
}

export class Viewport {
  private readonly scene = new THREE.Scene();
  private readonly canvas: HTMLCanvasElement;
  private readonly materials: MaterialLibrary;
  private readonly env: Environment;
  private readonly model: ModelSync;
  private readonly ghost: GhostRenderer;
  private readonly picker = new Picker();
  private readonly cam: CameraController;
  private readonly hud: Hud;
  private readonly effects = new Effects();
  private readonly fixtures = new FixtureLights();
  private readonly clicks = new ClickTracker();
  private tool: Tool;
  private toolItem: CatalogItem;
  private hoverHit: PickHit | null = null;
  private hoverId: string | null = null;
  private externalHover: string | null = null;
  private readonly pointer = { x: 0, y: 0, inside: false };
  private pointerDirty = true;
  private needsRender = true;
  private active = true;
  private capturing = false;
  private locked = false;
  private revision = 0;
  private lastTime = 0;
  private lightsDirty = true;
  private lastLightsUpdate = 0;
  private shadowVersion = -1;
  private wheelAccum = 0;
  /** Last press came from a touch screen (tap = place, long press = break). */
  private touch = { active: false, start: 0 };
  private drag: DragState | null = null;
  private renderCount = 0;
  private size = { w: 0, h: 0 };
  private envMapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly disposers: (() => void)[] = [];
  private readonly focusPoint = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly ctx: AppContext,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    container.classList.add('v3d-container');
    if (!container.hasAttribute('tabindex')) container.tabIndex = 0;
    container.setAttribute('aria-label', '3D view');
    this.canvas = renderer.domElement;
    this.canvas.classList.add('v3d-canvas');
    container.appendChild(this.canvas);

    const ui = ctx.ui.get();
    this.materials = new MaterialLibrary({ anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
    this.env = new Environment(this.scene, this.materials);
    this.model = new ModelSync(this.materials, this.filter(ui));
    this.scene.add(this.model.root, this.fixtures.group, this.effects.group);
    this.ghost = new GhostRenderer(this.materials, () => this.project, this.model);
    this.ghost.onChange = () => (this.needsRender = true);
    this.scene.add(this.ghost.group);
    this.cam = new CameraController(this.canvas, { probe: this.createProbe(), centerDistance: () => this.centerDistance() });
    this.cam.onFlyingChange = (flying) => {
      this.hud.setMode(flying ? 'fly' : 'walk');
      this.toast(flying ? 'Flying' : 'Walking — double-tap Space to fly', 'info');
    };
    this.hud = new Hud(container, () => this.requestLock());
    this.resize();

    this.model.rebuildAll(this.project);
    this.toolItem = activeItem(ui);
    this.tool = createTool(this.toolEnv(this.toolItem));
    this.applyUi(ui, null);
    this.env.updateEnvironmentMap(renderer);
    this.env.fitShadow(this.model.bounds());
    this.cam.resetView(this.model.bounds(), 0);

    this.disposers.push(
      ctx.store.subscribe(this.onStoreChange),
      ctx.ui.subscribe((v, prev) => this.applyUi(v, prev)),
      ctx.selection.subscribe(() => {
        this.refreshHighlight();
        this.needsRender = true;
      }),
      ctx.events.on('hover', ({ id, source }) => {
        if (source === '3d') return;
        this.externalHover = id;
        this.refreshHighlight();
        this.needsRender = true;
      }),
      ctx.events.on('zoom-to', ({ ids }) => this.frame(ids)),
      registerViewCommands(ctx.commands, {
        toggleCamera: () => ctx.ui.set({ cameraMode: ctx.ui.get().cameraMode === 'fly' ? 'orbit' : 'fly' }),
        toggleXray: () => ctx.ui.set({ xray: !ctx.ui.get().xray }),
        toggleCutAway: () => ctx.ui.set({ cutAboveActive: !ctx.ui.get().cutAboveActive }),
        resetCamera: () => {
          this.cam.resetView(this.model.bounds());
          this.needsRender = true;
        },
        topView: () => {
          this.cam.topView(this.model.bounds());
          this.needsRender = true;
        },
        frameSelection: () => this.frame([...ctx.selection.get()]),
        focused: () => this.focused(),
      }),
    );

    const c = this.canvas;
    this.listen(c, 'pointerdown', ((e: PointerEvent) => {
      this.touch = { active: e.pointerType === 'touch', start: e.timeStamp };
    }) as EventListener);
    this.listen(c, 'mousedown', this.onMouseDown as EventListener);
    this.listen(window, 'mousemove', this.onMouseMove as EventListener);
    this.listen(window, 'mouseup', this.onMouseUp as EventListener);
    this.listen(c, 'mouseleave', () => {
      if (this.cam.mode === 'orbit' && !this.clicks.anyPressed) {
        this.pointer.inside = false;
        this.pointerDirty = true;
      }
    });
    this.listen(c, 'wheel', this.onWheel as EventListener, { passive: false });
    this.listen(c, 'contextmenu', (e) => e.preventDefault());
    this.listen(c, 'auxclick', (e) => e.preventDefault());
    this.listen(container, 'keydown', this.onKeyDown as EventListener);
    this.listen(container, 'keyup', this.onKeyUp as EventListener);
    this.listen(container, 'blur', () => this.cam.releaseKeys());
    this.listen(window, 'blur', () => this.cam.releaseKeys());
    this.listen(document, 'pointerlockchange', this.onLockChange);
    this.listen(document, 'pointerlockerror', () => this.hud.showOverlay(this.cam.mode === 'fly'));

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(container);
      this.disposers.push(() => ro.disconnect());
    } else this.listen(window, 'resize', () => this.resize());
    this.resize();

    Object.defineProperty(container, '__view3d', { configurable: true, enumerable: false, value: this.debugApi() });
    renderer.setAnimationLoop(this.tick);
  }

  get project(): Project {
    return this.ctx.store.project as Project;
  }

  handle(): ViewportHandle {
    return {
      resize: () => this.resize(),
      setActive: (a) => this.setActive(a),
      captureImage: (o) => this.capture(o),
      frame: (ids) => this.frame(ids),
      dispose: () => this.dispose(),
    };
  }

  // ---------------------------------------------------------------------------
  // State sync

  private filter(ui: UIState): ViewFilter {
    const lvl = this.project.levels.find((l) => l.id === ui.activeLevelId) ?? this.project.levels[0];
    return { activeLevelId: lvl.id, activeElevation: lvl.elevation, cutAboveActive: ui.cutAboveActive, xray: ui.xray };
  }

  private applyUi(ui: UIState, prev: UIState | null): void {
    const changed = (k: keyof UIState) => !prev || prev[k] !== ui[k];
    if (changed('activeLevelId') || changed('cutAboveActive') || changed('xray')) {
      this.model.setFilter(this.filter(ui));
      this.lightsDirty = true;
      this.pointerDirty = true;
    }
    if (changed('activeLevelId') || changed('showGrid') || changed('displayUnits')) {
      this.updateLevelHud();
      this.updateGrid();
    }
    if (changed('shadows')) this.env.setShadows(ui.shadows);
    if (changed('sunAzimuth') || changed('sunAltitude')) {
      this.env.setSun(ui.sunAzimuth, ui.sunAltitude, this.project.settings.northAngle);
      this.env.fitShadow(this.model.bounds());
      if (prev) this.scheduleEnvMap();
    }
    if (changed('cameraMode')) this.applyCameraMode(ui.cameraMode, !prev);
    if (changed('hotbar') || changed('hotbarIndex')) {
      const item = activeItem(ui);
      if (item.id !== this.toolItem.id) this.switchTool(item);
      if (prev) this.hud.showItem(item.name);
    }
    if (prev && changed('inventoryOpen') && ui.inventoryOpen && this.locked) document.exitPointerLock();
    if (changed('toolHint')) this.hud.setToolHint(ui.toolHint);
    if (changed('displayUnits')) this.updateHoverInfo();
    this.needsRender = true;
  }

  private onStoreChange = (change: ChangeSet): void => {
    this.revision++;
    this.model.apply(this.project, change);
    if (change.levelsChanged || change.reset) {
      this.model.setFilter(this.filter(this.ctx.ui.get()));
      this.updateLevelHud();
      this.updateGrid();
    }
    if (change.settingsChanged) {
      const ui = this.ctx.ui.get();
      this.env.setSun(ui.sunAzimuth, ui.sunAltitude, this.project.settings.northAngle);
      this.updateGrid();
    }
    this.env.fitShadow(this.model.bounds());
    if (change.reset) this.cam.resetView(this.model.bounds(), 0);
    this.lightsDirty = true;
    this.pointerDirty = true;
    this.needsRender = true;
    this.updateHoverInfo();
  };

  private updateLevelHud(): void {
    const ui = this.ctx.ui.get();
    const lvl = this.project.levels.find((l) => l.id === ui.activeLevelId) ?? this.project.levels[0];
    const e = lvl.elevation;
    this.hud.setLevel(lvl.name, `${e >= 0 ? '+' : '−'}${formatLength(Math.abs(e), ui.displayUnits)}`.replace('+0 mm', '±0.00'));
  }

  private updateGrid(): void {
    const ui = this.ctx.ui.get();
    const lvl = this.project.levels.find((l) => l.id === ui.activeLevelId) ?? this.project.levels[0];
    this.env.setGrid(ui.showGrid, this.project.settings.gridSize, lvl.elevation);
    this.needsRender = true;
  }

  private scheduleEnvMap(): void {
    if (this.envMapTimer) clearTimeout(this.envMapTimer);
    this.envMapTimer = setTimeout(() => {
      this.envMapTimer = null;
      if (this.disposed) return;
      this.env.updateEnvironmentMap(this.renderer);
      this.needsRender = true;
    }, 250);
  }

  private applyCameraMode(mode: UIState['cameraMode'], initial: boolean): void {
    this.cam.setMode(mode);
    this.container.dataset.camera = mode;
    this.hud.setMode(mode === 'orbit' ? 'orbit' : this.cam.flying ? 'fly' : 'walk');
    if (mode === 'fly') {
      if (!initial) this.requestLock();
    } else if (this.locked) document.exitPointerLock();
    this.hud.showOverlay(mode === 'fly' && !this.locked);
    this.pointerDirty = true;
    this.needsRender = true;
  }

  private refreshHighlight(): void {
    this.model.setHighlight(this.hoverId ?? this.externalHover, this.ctx.selection.get(), this.hoverId ? HOVER_STYLE[this.toolItem.tool] : 'full');
  }

  private updateHoverInfo(): void {
    const el = this.hoverId ? this.ctx.store.getElement(this.hoverId) : undefined;
    this.hud.setHover(el ? describeElement(this.project, el, this.ctx.ui.get().displayUnits) : null);
  }

  // ---------------------------------------------------------------------------
  // Tools

  private toast(message: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    this.ctx.events.emit('toast', { message, kind });
  }

  private toolEnv(item: CatalogItem): ToolEnv {
    return {
      ctx: this.ctx,
      item,
      ghost: this.ghost,
      player: () => this.cam.player(),
      revision: () => this.revision,
      hint: (text) => this.ctx.ui.set({ toolHint: text }),
      toast: (message, kind) => this.toast(message, kind),
      effect: (kind, at, materialId) => {
        const p = new THREE.Vector3(...planToWorld(at.point, at.elevation));
        if (kind === 'break') this.effects.burst(p, this.materials.color(materialId));
        else this.effects.pulse(p);
        this.needsRender = true;
      },
    };
  }

  private switchTool(item: CatalogItem): void {
    if (this.drag?.active) this.tool.endDrag?.(false);
    this.drag = null;
    this.tool.dispose();
    this.ghost.clear();
    this.toolItem = item;
    this.tool = createTool(this.toolEnv(item));
    this.refreshHighlight();
    this.tool.hover(this.hoverHit);
    this.needsRender = true;
  }

  // ---------------------------------------------------------------------------
  // Picking

  private aim(): boolean {
    if (this.cam.mode === 'fly') {
      this.picker.aim(this.cam.camera, 0, 0);
      return true;
    }
    if (!this.pointer.inside) return false;
    this.picker.aim(this.cam.camera, this.pointer.x, this.pointer.y);
    return true;
  }

  private pick(): PickHit | null {
    if (!this.aim()) return null;
    return this.picker.pick(this.model.pickables(), this.project, this.ctx.ui.get().activeLevelId);
  }

  private centerDistance(): number | null {
    this.picker.aim(this.cam.camera, 0, 0);
    return this.picker.pick(this.model.pickables(), this.project, this.ctx.ui.get().activeLevelId)?.distance ?? null;
  }

  private updateHover(): void {
    if (this.drag?.active) return;
    const hit = this.pick();
    this.hoverHit = hit;
    const id = hit?.elementId ?? null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.refreshHighlight();
      this.ctx.events.emit('hover', { id, source: '3d' });
      this.updateHoverInfo();
    }
    this.tool.hover(hit);
    this.needsRender = true;
  }

  private createProbe(): WalkProbe {
    const rc = new THREE.Raycaster();
    const o = new THREE.Vector3();
    const d = new THREE.Vector3();
    return {
      groundAt: (x, z, fromY) => {
        o.set(x, fromY, z);
        d.set(0, -1, 0);
        rc.set(o, d);
        rc.far = fromY + 500;
        for (const h of rc.intersectObjects(this.model.colliders(), false)) {
          if (!h.face || h.face.normal.y < 0.45) continue;
          return h.point.y > 0 ? h.point.y : fromY >= 0 ? 0 : h.point.y;
        }
        return fromY >= 0 ? 0 : null;
      },
      obstacle: (x, y, z, dx, dz, max) => {
        o.set(x, y, z);
        d.set(dx, 0, dz);
        rc.set(o, d);
        rc.far = max;
        for (const h of rc.intersectObjects(this.model.colliders(), false)) {
          if (!h.face || Math.abs(h.face.normal.y) > 0.6) continue;
          return h.distance;
        }
        return null;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Input

  private listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  private focused(): boolean {
    const a = document.activeElement;
    return this.locked || (!!a && (a === this.container || this.container.contains(a)));
  }

  private requestLock(): void {
    this.container.focus({ preventScroll: true });
    if (this.cam.mode !== 'fly' || this.locked) return;
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => this.hud.showOverlay(this.cam.mode === 'fly' && !this.locked));
    } catch {
      this.hud.showOverlay(true);
    }
  }

  private onLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    if (locked === this.locked) return;
    this.locked = locked;
    this.clicks.reset();
    this.cam.releaseKeys();
    if (locked) this.container.focus({ preventScroll: true });
    else if (this.cam.mode === 'fly') {
      if (this.drag?.active) this.tool.endDrag?.(false);
      this.drag = null;
      this.tool.cancel();
    }
    this.hud.showOverlay(this.cam.mode === 'fly' && !locked);
    this.pointerDirty = true;
    this.needsRender = true;
  };

  private updatePointer(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    this.pointer.inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
    this.pointer.x = (x / Math.max(1, r.width)) * 2 - 1;
    this.pointer.y = -(y / Math.max(1, r.height)) * 2 + 1;
  }

  private onMouseDown = (e: MouseEvent): void => {
    this.container.focus({ preventScroll: true });
    if (e.button === 1) e.preventDefault();
    if (this.cam.mode === 'fly' && !this.locked) {
      this.requestLock();
      return;
    }
    if (!this.locked) this.updatePointer(e);
    this.clicks.down(e.button, e.clientX, e.clientY);
    if (this.cam.mode === 'orbit' && e.button !== 0) {
      // Orbit / pan around whatever is under the cursor.
      const hit = this.pick();
      if (hit) this.cam.pivotAt(this.tmp.set(...planToWorld(hit.point, hit.elevation)));
    }
    if (e.button === 0 && this.tool.beginDrag) {
      const hit = this.pick();
      this.drag = { pending: hit, shift: e.shiftKey, active: false, elevation: hit?.elevation ?? 0 };
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.locked) {
      this.cam.look(e.movementX, e.movementY);
      this.clicks.moveBy(e.movementX, e.movementY);
      this.pointerDirty = true;
      this.needsRender = true;
    } else {
      const wasInside = this.pointer.inside;
      this.updatePointer(e);
      this.clicks.moveTo(e.clientX, e.clientY);
      if (this.cam.mode === 'orbit' && (this.pointer.inside || wasInside)) this.pointerDirty = true;
    }
    this.updateDrag();
  };

  private updateDrag(): void {
    const d = this.drag;
    if (!d) return;
    if (!d.active) {
      if (!this.clicks.isDrag(0)) return;
      if (!d.pending?.elementId || !this.tool.beginDrag?.(d.pending, d.shift)) {
        this.drag = null;
        return;
      }
      d.active = true;
    }
    if (!this.aim()) return;
    const p = this.picker.planePoint(d.elevation);
    if (p) this.tool.dragTo?.(p);
    this.needsRender = true;
  }

  private onMouseUp = (e: MouseEvent): void => {
    if (!this.clicks.isPressed(e.button)) return;
    const click = this.locked ? this.clicks.up(e.button) : this.clicks.up(e.button, e.clientX, e.clientY);
    if (e.button === 0 && this.drag) {
      const wasActive = this.drag.active;
      this.drag = null;
      if (wasActive) {
        this.tool.endDrag?.(true);
        this.pointerDirty = true;
        return;
      }
    }
    if (!click) return;
    if (!this.locked) this.updatePointer(e);
    let button = e.button;
    if (this.touch.active && button === 0 && this.toolItem.tool !== 'select') {
      // Touch: tap places / uses, long press breaks.
      button = e.timeStamp - this.touch.start > 450 ? 0 : 2;
    }
    this.handleClick(button, this.pick(), e.shiftKey);
  };

  /** Click semantics: LMB break (or tool primary), MMB pick block, RMB place/use. */
  private handleClick(button: number, hit: PickHit | null, shift: boolean): void {
    if (button === 0) {
      if (!this.tool.primary?.(hit, { shift })) breakAt(this.toolEnv(this.toolItem), hit);
    } else if (button === 1) {
      pickBlockAt(this.toolEnv(this.toolItem), hit);
    } else if (button === 2) {
      this.tool.use(hit);
    }
    this.pointerDirty = true;
    this.needsRender = true;
  }

  private onWheel = (e: WheelEvent): void => {
    if (this.cam.mode !== 'fly') {
      this.pointerDirty = true;
      return;
    }
    e.preventDefault();
    this.wheelAccum += e.deltaY;
    if (Math.abs(this.wheelAccum) < 40) return;
    const step = Math.sign(this.wheelAccum);
    this.wheelAccum = 0;
    const ui = this.ctx.ui.get();
    const n = Math.max(1, ui.hotbar.length);
    this.ctx.ui.set({ hotbarIndex: (ui.hotbarIndex + step + n) % n });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== this.container && isTypingTarget(e.target)) return;
    const k = e.key.toLowerCase();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    let consumed = false;
    if (e.key === 'Escape') {
      if (this.drag?.active) {
        this.drag = null;
        this.tool.endDrag?.(false);
        consumed = true;
      } else consumed = this.tool.cancel();
    } else if (plain && !e.shiftKey && VIEW_KEYS[k]) {
      if (!e.repeat && !e.defaultPrevented) void this.ctx.commands.run(VIEW_KEYS[k]);
      consumed = true;
    } else if (plain && k === 'r') {
      consumed = this.tool.key?.(e) ?? false;
    }
    if (!consumed && !e.metaKey && !e.altKey && (!e.ctrlKey || e.code.startsWith('Control'))) consumed = this.cam.keyDown(e.code, e.repeat, e.timeStamp);
    if (consumed) {
      e.preventDefault();
      e.stopPropagation();
      this.pointerDirty = true;
      this.needsRender = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.cam.keyUp(e.code);
  };

  // ---------------------------------------------------------------------------
  // Loop

  private tick = (time: number): void => {
    if (!this.active || this.capturing || this.disposed) {
      this.lastTime = time;
      return;
    }
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = time;
    const moved = this.cam.update(dt);
    if (moved) {
      this.needsRender = true;
      this.pointerDirty = true;
      if (this.drag?.active) this.updateDrag();
    }
    if (this.effects.update(dt)) this.needsRender = true;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.updateHover();
    }
    if (this.lightsDirty || (moved && time - this.lastLightsUpdate > 1500)) {
      this.fixtures.update(this.model.lights(), this.ctx.ui.get().activeLevelId, this.cam.camera.position);
      this.lightsDirty = false;
      this.lastLightsUpdate = time;
      this.needsRender = true;
    }
    if (this.needsRender) this.render();
  };

  private render(): void {
    const camera = this.cam.camera;
    if (this.cam.mode === 'orbit') this.focusPoint.copy(this.cam.orbit.target);
    else this.focusPoint.copy(camera.position).addScaledVector(camera.getWorldDirection(this.tmp), 6).setY(this.env.grid.position.y);
    this.env.follow(camera, this.focusPoint);
    if (this.env.shadowsDirty || this.model.version !== this.shadowVersion) {
      this.renderer.shadowMap.needsUpdate = true;
      this.env.shadowsDirty = false;
      this.shadowVersion = this.model.version;
    }
    this.renderer.render(this.scene, camera);
    this.renderCount++;
    this.needsRender = false;
    this.hud.setHeading(this.cam.heading());
    this.updateLabel();
    if (this.container.dataset.view3d !== 'ready') this.container.dataset.view3d = 'ready';
  }

  private updateLabel(): void {
    const text = this.ghost.labelText;
    if (!text) {
      this.hud.setLabel(null);
      return;
    }
    const p = this.tmp.copy(this.ghost.labelPos).project(this.cam.camera);
    if (p.z > 1 || p.z < -1) {
      this.hud.setLabel(null);
      return;
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.hud.setLabel(text, ((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h);
  }

  // ---------------------------------------------------------------------------
  // Handle API

  resize(): void {
    const w = Math.max(1, Math.floor(this.container.clientWidth));
    const h = Math.max(1, Math.floor(this.container.clientHeight));
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h);
    this.cam.setAspect(w, h);
    this.needsRender = true;
  }

  private setActive(a: boolean): void {
    this.active = a;
    if (a) {
      this.lastTime = 0;
      this.needsRender = true;
      this.resize();
    } else {
      if (this.locked) document.exitPointerLock();
      this.cam.releaseKeys();
    }
  }

  frame(ids?: string[]): void {
    const box = ids && ids.length ? this.model.bounds(ids) : this.model.bounds();
    // Elements without 3D geometry (rooms, labels, dimensions) frame their plan extent.
    for (const id of ids ?? []) {
      if (this.model.entry(id)) continue;
      const el = this.ctx.store.getElement(id);
      if (el) for (const p of planPoints(el)) box.expandByPoint(this.tmp.set(...planToWorld(p, this.levelElevation(el.levelId))));
    }
    if (box.isEmpty() && ids?.length) return;
    this.cam.frameBox(box);
    this.needsRender = true;
  }

  private levelElevation(levelId: string): number {
    return this.project.levels.find((l) => l.id === levelId)?.elevation ?? 0;
  }

  private async capture(opts: CaptureOptions = {}): Promise<Blob> {
    this.capturing = true;
    const gridVisible = this.env.grid.visible;
    this.ghost.setVisible(false);
    this.env.grid.visible = false;
    this.model.setHighlight(null, []);
    try {
      return await captureFrame(this.renderer, this.cam.camera, () => {
        this.renderer.shadowMap.needsUpdate = true;
        this.renderer.render(this.scene, this.cam.camera);
      }, opts);
    } finally {
      this.ghost.setVisible(true);
      this.env.grid.visible = gridVisible;
      this.refreshHighlight();
      this.capturing = false;
      this.needsRender = true;
    }
  }

  private debugApi(): ViewportDebug {
    return {
      worldToClient: (x, y, elev = 0) => {
        const v = new THREE.Vector3(...planToWorld({ x, y }, elev)).project(this.cam.camera);
        if (v.z > 1) return null;
        const r = this.canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      pickAtClient: (cx, cy) => {
        const r = this.canvas.getBoundingClientRect();
        this.picker.aim(this.cam.camera, ((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
        return this.picker.pick(this.model.pickables(), this.project, this.ctx.ui.get().activeLevelId);
      },
      stats: () => ({
        elements: this.model.size,
        renders: this.renderCount,
        tool: this.toolItem.tool,
        item: this.toolItem.id,
        mode: this.cam.mode,
        flying: this.cam.flying,
        animating: this.cam.moving,
        camera: this.cam.player(),
        locked: this.locked,
        ghost: this.ghost.count,
        lights: this.fixtures.count,
        materials: this.materials.size,
        hover: this.hoverId,
        environment: !!this.scene.environment,
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }),
      renderNow: () => this.render(),
      lookFrom: (x, y, e, tx, ty, te) => {
        this.cam.flyTo(new THREE.Vector3(...planToWorld({ x, y }, e)), new THREE.Vector3(...planToWorld({ x: tx, y: ty }, te)), 0);
        this.pointerDirty = true;
        this.needsRender = true;
      },
      capture: async (o) => {
        const b = await this.capture(o);
        return { type: b.type, size: b.size };
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    if (this.locked) document.exitPointerLock();
    if (this.envMapTimer) clearTimeout(this.envMapTimer);
    for (const d of this.disposers.splice(0)) d();
    this.tool.dispose();
    this.ctx.ui.set({ toolHint: '' });
    this.cam.dispose();
    this.ghost.dispose();
    this.model.dispose();
    this.effects.dispose();
    this.fixtures.dispose();
    this.env.dispose();
    this.materials.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    delete (this.container as unknown as { __view3d?: unknown }).__view3d;
    delete this.container.dataset.view3d;
    delete this.container.dataset.camera;
    this.container.classList.remove('v3d-container');
  }
}
