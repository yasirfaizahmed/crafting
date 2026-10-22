/**
 * PlanEditor: owns the canvas, viewport, derived model caches, the active tool and the render loop.
 * Implements ToolHost for the tools in ./tools.
 */
import { activeItem, type AppContext } from '../app/state';
import { DEFAULT_GENERATE_OPTIONS, type Generate3DOptions } from '../core/autobuild';
import type { CatalogItem } from '../core/catalog';
import { emptyBounds, extendBounds, isEmptyBounds, type Bounds2 } from '../core/math2d';
import { detectRooms, type DetectedRoom } from '../core/rooms';
import type { Transaction } from '../core/store';
import type { Element, ElementType, Level, LevelUnderlay, Vec2, Wall } from '../core/types';
import { formatLength } from '../core/units';
import { computeFootprintsForWalls, computeWallFootprints, projectOntoWall, wallFaceOffsets, wallLength, type WallFootprint } from '../core/walls';
import type { Patch } from './edit-ops';
import type { GhostState, HoverTone, OverlayItem } from './editor-types';
import { renderPlan, type RenderScene } from './render/renderer';
import { boundRooms, syncRooms } from './roomsync';
import { elementBounds, elementPolygons, hitTest } from './shapes';
import { buildSnapScene, snapPoint, type SnapResult, type SnapScene } from './snapping';
import { createTool } from './tools';
import type { PlanTool, PromptOptions, SnapRequest, ToolPointer, WallHit } from './tools/types';
import { CalibrateTool, MoveUnderlayTool, type UnderlayHost } from './tools/underlay-tools';
import { UnderlayImages } from './underlay';
import { Viewport } from './viewport';

export interface PlanEditorOptions {
  /** Skip creating a 2D context (unit tests in jsdom). */
  headless?: boolean;
}

const GEN_KEY = 'crafting.plan2d.generateOptions';

export class PlanEditor implements UnderlayHost {
  readonly app: AppContext;
  readonly container: HTMLElement;
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly view = new Viewport();
  readonly underlays: UnderlayImages;
  private g: CanvasRenderingContext2D | null = null;
  private dpr = 1;
  private baseTool!: PlanTool;
  private overrideTool: PlanTool | null = null;
  private itemId = '';
  private rev = 0;
  private cache: {
    rev: number;
    level: string;
    elements?: Element[];
    footprints?: Map<string, WallFootprint>;
    rooms?: DetectedRoom[];
    scenes?: Map<string, SnapScene>;
    below?: { level: Level; elements: Element[]; footprints: Map<string, WallFootprint> } | null;
  } = { rev: -1, level: '' };
  hoverId: string | null = null;
  hoverTone: HoverTone = 'normal';
  externalHoverId: string | null = null;
  ghosts: Element[] = [];
  ghostState: GhostState = 'neutral';
  private ghostFootprints: Map<string, WallFootprint> | null = null;
  preview: Patch | null = null;
  /** Live underlay edits (dragging, opacity slider) before they are committed. */
  underlayPreview: LevelUnderlay | null = null;
  private previewFootprints: Map<string, WallFootprint> | null = null;
  overlay: OverlayItem[] = [];
  cursorWorld: Vec2 | null = null;
  lastPointer: ToolPointer | null = null;
  shiftDown = false;
  hovered = false;
  active = true;
  disposed = false;
  private raf: number | null = null;
  private fitted = false;
  private unsubs: (() => void)[] = [];
  private promptEl: HTMLDivElement | null = null;
  private viewListeners = new Set<() => void>();
  private pendingHint: string | null = null;
  generateOptions: Generate3DOptions;
  /** Generate 3D for every level or only the active one. */
  generateScope: 'all' | 'active' = 'all';

  constructor(container: HTMLElement, app: AppContext, opts: PlanEditorOptions = {}) {
    this.app = app;
    this.container = container;
    this.root = document.createElement('div');
    this.root.className = 'p2d';
    this.root.tabIndex = 0;
    this.root.setAttribute('role', 'application');
    this.root.setAttribute('aria-label', 'Floor plan editor');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'p2d-canvas';
    this.root.appendChild(this.canvas);
    // The editor fills its container: make sure the container is a positioning context.
    if (typeof getComputedStyle === 'function' && getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.root);
    if (!opts.headless) {
      try {
        this.g = this.canvas.getContext('2d');
      } catch {
        this.g = null;
      }
    }
    this.underlays = new UnderlayImages(() => this.invalidate());
    this.generateOptions = loadGenerateOptions();
    this.generateScope = loadGenerateScope();
    this.setToolFromUI();

    this.unsubs.push(
      app.store.subscribe((change) => {
        this.rev++;
        if (change.reset) {
          this.cancelOperation();
          this.fitted = false;
          this.resize();
        }
        this.activeTool.modelChanged?.();
        this.invalidate();
        this.notifyView();
      }),
      app.ui.subscribe((v, prev) => {
        if (v.activeLevelId !== prev.activeLevelId) {
          this.cancelOperation();
          this.rev++;
        }
        if (activeItem(v).id !== this.itemId) this.setToolFromUI();
        else if (v.snapGrid !== prev.snapGrid || v.snapAngle !== prev.snapAngle || v.snapObjects !== prev.snapObjects) this.refreshPointer();
        this.invalidate();
        this.notifyView();
      }),
      app.selection.subscribe(() => this.invalidate()),
      app.events.on('hover', ({ id, source }) => {
        if (source === 'plan' || this.externalHoverId === id) return;
        this.externalHoverId = id;
        this.invalidate();
      }),
      app.events.on('zoom-to', ({ ids }) => this.frame(ids)),
    );
  }

  // ---------------------------------------------------------------- ToolHost

  get levelId(): string {
    return this.level.id;
  }

  get level(): Level {
    const id = this.app.ui.get().activeLevelId;
    return this.app.store.getLevel(id) ?? this.app.store.project.levels[0];
  }

  get item(): CatalogItem {
    return activeItem(this.app.ui.get());
  }

  get activeTool(): PlanTool {
    return this.overrideTool ?? this.baseTool;
  }

  private ensureCache(): void {
    if (this.cache.rev !== this.rev || this.cache.level !== this.levelId) this.cache = { rev: this.rev, level: this.levelId };
  }

  levelElements(): Element[] {
    this.ensureCache();
    return (this.cache.elements ??= this.app.store.elementsOnLevel(this.levelId));
  }

  footprints(): Map<string, WallFootprint> {
    this.ensureCache();
    return (this.cache.footprints ??= computeWallFootprints(this.app.store.project, this.levelId));
  }

  rooms(): DetectedRoom[] {
    this.ensureCache();
    return (this.cache.rooms ??= detectRooms(this.app.store.project, this.levelId));
  }

  private belowLevel(): { level: Level; elements: Element[]; footprints: Map<string, WallFootprint> } | null {
    this.ensureCache();
    if (this.cache.below !== undefined) return this.cache.below;
    const levels = [...this.app.store.project.levels].sort((a, b) => a.elevation - b.elevation);
    const i = levels.findIndex((l) => l.id === this.levelId);
    const below = i > 0 ? levels[i - 1] : undefined;
    this.cache.below = below
      ? { level: below, elements: this.app.store.elementsOnLevel(below.id), footprints: computeWallFootprints(this.app.store.project, below.id) }
      : null;
    return this.cache.below;
  }

  tol(px = 10): number {
    return this.view.pxToMm(px);
  }

  snap(raw: Vec2, req: SnapRequest = {}): SnapResult {
    const ui = this.app.ui.get();
    const exclude = req.exclude ? new Set(req.exclude) : undefined;
    this.ensureCache();
    const key = `${req.faces ? 'f' : ''}|${exclude ? [...exclude].sort().join(',') : ''}`;
    const scenes = (this.cache.scenes ??= new Map());
    let scene = scenes.get(key);
    if (!scene) {
      scene = buildSnapScene(this.levelElements(), { exclude, faces: req.faces, footprints: this.footprints(), level: this.level });
      if (scenes.size > 8) scenes.clear();
      scenes.set(key, scene);
    }
    return snapPoint(raw, scene, {
      grid: ui.snapGrid && req.grid !== false,
      objects: ui.snapObjects && req.objects !== false,
      angle: ui.snapAngle && !this.shiftDown && req.angle !== false,
      gridSize: this.app.store.project.settings.gridSize,
      tolerance: this.tol(10),
      from: req.from,
      track: req.track,
    });
  }

  hit(p: Vec2, opts: { types?: ElementType[]; exclude?: Set<string>; areas?: boolean; tolPx?: number } = {}): Element | undefined {
    const ctx = { elements: this.app.store.project.elements, footprints: this.footprints(), level: this.level };
    return hitTest(this.levelElements(), ctx, p, this.tol(opts.tolPx ?? 6), opts);
  }

  wallAt(p: Vec2, tolPx = 10): WallHit | undefined {
    let best: (WallHit & { d: number }) | undefined;
    const tol = this.tol(tolPx);
    for (const el of this.levelElements()) {
      if (el.type !== 'wall' || el.hidden) continue;
      const len = wallLength(el);
      if (len < 1) continue;
      const pr = projectOntoWall(el, p);
      if (pr.offset < -tol || pr.offset > len + tol) continue;
      const f = wallFaceOffsets(el);
      const d = pr.lateral > f.left ? pr.lateral - f.left : pr.lateral < f.right ? f.right - pr.lateral : 0;
      if (d > tol) continue;
      const score = d + Math.abs(pr.lateral - (f.left + f.right) / 2) * 1e-3;
      if (!best || score < best.d) best = { wall: el as Wall, offset: pr.offset, lateral: pr.lateral, d: score };
    }
    if (!best) return undefined;
    const { d: _d, ...hit } = best;
    return hit;
  }

  setGhosts(els: Element[], state: GhostState = 'neutral'): void {
    this.ghosts = els;
    this.ghostState = state;
    const ghostWalls = els.filter((e): e is Wall => e.type === 'wall');
    this.ghostFootprints = ghostWalls.length
      ? computeFootprintsForWalls([...this.levelElements().filter((e): e is Wall => e.type === 'wall' && wallLength(e) > 1e-6), ...ghostWalls.filter((w) => wallLength(w) > 1e-6)])
      : null;
    this.invalidate();
  }

  setPreview(patch: Patch | null): void {
    this.preview = patch && patch.size ? patch : null;
    this.previewFootprints = null;
    this.invalidate();
  }

  setOverlay(items: OverlayItem[]): void {
    this.overlay = items;
    this.invalidate();
  }

  setHover(id: string | null, tone: HoverTone = 'normal'): void {
    if (id === this.hoverId && tone === this.hoverTone) return;
    const changed = id !== this.hoverId;
    this.hoverId = id;
    this.hoverTone = tone;
    if (changed) this.app.events.emit('hover', { id, source: 'plan' });
    this.invalidate();
  }

  /**
   * Status-bar hint. Applied in a microtask: tools often change hints while the UI store is
   * notifying listeners, and a nested set() would reach other modules out of order.
   */
  setHint(text: string): void {
    const first = this.pendingHint === null;
    this.pendingHint = text;
    if (!first) return;
    queueMicrotask(() => {
      const t = this.pendingHint;
      this.pendingHint = null;
      if (t !== null && !this.disposed && this.app.ui.get().toolHint !== t) this.app.ui.set({ toolHint: t });
    });
  }

  setCursor(cursor: string): void {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  toast(message: string, kind: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    this.app.events.emit('toast', { message, kind });
  }

  fmt(mm: number): string {
    return formatLength(mm, this.app.ui.get().displayUnits);
  }

  transact<R>(label: string, fn: (tx: Transaction) => R): R {
    const store = this.app.store;
    const lvl = this.levelId;
    // Elements are immutable values, so a shallow copy is an exact "before" snapshot.
    const before = { ...store.project.elements };
    return store.transact(label, (tx) => {
      const r = fn(tx);
      const after = store.project.elements;
      const wallChanged = (id: string) => {
        const a = before[id];
        const b = after[id];
        return a !== b && ((a?.type === 'wall' && a.levelId === lvl) || (b?.type === 'wall' && b.levelId === lvl));
      };
      const changed = Object.keys(after).some(wallChanged) || Object.keys(before).some((id) => !(id in after) && wallChanged(id));
      if (changed) {
        const bindings = boundRooms(before, lvl);
        for (const el of syncRooms(bindings, after, lvl).values()) tx.replace(el);
      }
      return r;
    });
  }

  commitPatch(label: string, patch: Patch): void {
    if (!patch.size) return;
    this.transact(label, (tx) => {
      for (const el of patch.values()) if (tx.get(el.id)) tx.replace(el);
    });
  }

  prompt(opts: PromptOptions): void {
    this.closePrompt();
    const wrap = document.createElement('div');
    wrap.className = 'p2d-prompt';
    const x = Math.min(Math.max(8, opts.at.x), Math.max(8, this.view.width - 230));
    const y = Math.min(Math.max(8, opts.at.y), Math.max(8, this.view.height - 60));
    wrap.style.left = `${x}px`;
    wrap.style.top = `${y}px`;
    if (opts.label) {
      const l = document.createElement('label');
      l.textContent = opts.label;
      wrap.appendChild(l);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.value = opts.value ?? '';
    input.placeholder = opts.placeholder ?? '';
    input.spellcheck = false;
    wrap.appendChild(input);
    const hint = document.createElement('small');
    hint.textContent = 'Enter ↵ to apply · Esc to cancel';
    wrap.appendChild(hint);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      if (ok) {
        const res = opts.onSubmit(input.value);
        if (res === false) {
          wrap.classList.add('invalid');
          input.select();
          return;
        }
      } else opts.onCancel?.();
      done = true;
      this.closePrompt();
      this.root.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(wrap);
    this.promptEl = wrap;
    // Focus after the current pointer sequence: the browser's mousedown focus change would
    // otherwise blur the input immediately.
    setTimeout(() => {
      if (done || this.promptEl !== wrap) return;
      input.focus();
      input.select();
      input.addEventListener('blur', () => setTimeout(() => finish(false), 0));
    }, 0);
  }

  get promptOpen(): boolean {
    return !!this.promptEl;
  }

  closePrompt(): void {
    const el = this.promptEl;
    this.promptEl = null;
    el?.remove();
  }

  invalidate(): void {
    if (this.disposed || !this.active || !this.g || this.raf !== null) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    this.raf = raf(() => {
      this.raf = null;
      this.render();
    });
  }

  // ---------------------------------------------------------------- Tools

  setToolFromUI(): void {
    const item = this.item;
    this.baseTool?.cancel?.();
    this.baseTool?.deactivate?.();
    this.clearToolVisuals();
    this.itemId = item.id;
    this.baseTool = createTool(item.tool, this);
    this.baseTool.activate?.();
    this.refreshPointer();
    this.notifyView();
  }

  /** Temporarily replace the hotbar tool (underlay calibration / move). */
  startOverride(tool: PlanTool): void {
    this.endOverride();
    this.baseTool.cancel?.();
    this.clearToolVisuals();
    this.overrideTool = tool;
    tool.activate?.();
    this.root.focus({ preventScroll: true });
    this.refreshPointer();
    this.notifyView();
  }

  endOverride(): void {
    if (!this.overrideTool) return;
    const t = this.overrideTool;
    this.overrideTool = null;
    t.deactivate?.();
    this.clearToolVisuals();
    this.refreshPointer();
    this.notifyView();
  }

  startCalibration(): void {
    if (!this.level.underlay) {
      this.toast('Import a blueprint image first (Trace image)', 'warning');
      return;
    }
    this.startOverride(new CalibrateTool(this));
  }

  startMoveUnderlay(): void {
    if (!this.level.underlay) return;
    this.startOverride(new MoveUnderlayTool(this));
  }

  underlaySize(): { w: number; h: number } | null {
    const u = this.level.underlay;
    return u ? this.underlays.size(u.src) : null;
  }

  get overrideActive(): string | null {
    return this.overrideTool?.name ?? null;
  }

  private clearToolVisuals(): void {
    this.ghosts = [];
    this.ghostFootprints = null;
    this.preview = null;
    this.previewFootprints = null;
    this.overlay = [];
    this.setHover(null);
    this.setHint('');
    this.setCursor('default');
    this.invalidate();
  }

  /** Esc-style cancel of whatever is in progress. Returns true if something was cancelled. */
  cancelOperation(): boolean {
    this.closePrompt();
    let did = false;
    if (this.overrideTool) {
      did = this.overrideTool.cancel?.() ?? false;
      if (!did) {
        this.endOverride();
        did = true;
      }
    } else did = this.baseTool.cancel?.() ?? false;
    if (did) this.refreshPointer();
    return did;
  }

  /** Re-run the hover logic at the last pointer position (after modifier / model changes). */
  refreshPointer(): void {
    if (this.lastPointer && this.hovered) this.activeTool.pointerMove?.({ ...this.lastPointer, shift: this.shiftDown });
  }

  // ---------------------------------------------------------------- View

  /** Re-measure the container and redraw. */
  resize(): void {
    const r = this.root.getBoundingClientRect();
    const real = r.width > 0 && r.height > 0;
    const w = real ? r.width : this.view.width || 800;
    const h = real ? r.height : this.view.height || 600;
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.view.setSize(w, h);
    const pw = Math.max(1, Math.round(w * this.dpr));
    const ph = Math.max(1, Math.round(h * this.dpr));
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    if (real && !this.fitted) {
      this.fitted = true;
      this.zoomToFit();
    }
    this.render();
    this.notifyView();
  }

  zoomToFit(): void {
    const ctx = { elements: this.app.store.project.elements, footprints: this.footprints(), level: this.level };
    let b = elementBounds(this.levelElements(), ctx);
    if (isEmptyBounds(b)) {
      const below = this.belowLevel();
      if (below) b = elementBounds(below.elements.filter((e) => e.type === 'wall'), { ...ctx, footprints: below.footprints });
    }
    if (isEmptyBounds(b)) b = { minX: -2000, minY: -2000, maxX: 12000, maxY: 9000 };
    this.view.fit(padBounds(b, 0), 64);
    this.invalidate();
    this.notifyView();
  }

  /** Frame specific elements (switching to their level when needed). */
  frame(ids?: string[]): void {
    const els = (ids ?? []).map((id) => this.app.store.getElement(id)).filter((e): e is Element => !!e);
    if (!els.length) {
      this.zoomToFit();
      return;
    }
    const lvl = els[0].levelId;
    if (lvl !== this.levelId) this.app.ui.set({ activeLevelId: lvl });
    const fps = computeWallFootprints(this.app.store.project, lvl);
    const b = emptyBounds();
    for (const el of els.filter((e) => e.levelId === lvl)) for (const poly of elementPolygons(el, { elements: this.app.store.project.elements, footprints: fps })) for (const p of poly) extendBounds(b, p);
    if (isEmptyBounds(b)) return;
    this.view.fit(padBounds(b, 600), 64, 0.4);
    this.invalidate();
    this.notifyView();
  }

  zoomBy(factor: number, at?: Vec2): void {
    this.view.zoomAt(at ?? { x: this.view.width / 2, y: this.view.height / 2 }, factor);
    this.invalidate();
    this.notifyView();
  }

  onViewChange(fn: () => void): () => void {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }

  notifyView(): void {
    for (const fn of [...this.viewListeners]) fn();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.resize();
  }

  /** Render synchronously (also used by the rAF loop). */
  render(): void {
    const g = this.g;
    if (!g || this.disposed || !this.active) return;
    renderPlan(g, this.view, this.dpr, this.buildScene());
  }

  buildScene(): RenderScene {
    const ui = this.app.ui.get();
    const project = this.app.store.project;
    let elements = project.elements;
    let footprints = this.footprints();
    if (this.preview) {
      elements = { ...project.elements };
      for (const [id, el] of this.preview) elements[id] = el;
      const wallChanged = [...this.preview.values()].some((e) => e.type === 'wall');
      if (wallChanged) footprints = this.previewFootprints ??= computeWallFootprints({ elements }, this.levelId);
    }
    const level = this.level;
    const u = this.underlayPreview ?? level.underlay;
    const img = u?.visible ? this.underlays.get(u.src) : null;
    return {
      elements,
      level,
      footprints,
      below: ui.showLevelBelow ? this.belowLevel() : null,
      selection: new Set(this.app.selection.get()),
      hoverId: this.hoverId,
      hoverTone: this.hoverTone,
      externalHoverId: this.externalHoverId,
      ghosts: this.ghosts,
      ghostState: this.ghostState,
      ghostFootprints: this.ghostFootprints,
      overlay: this.overlay,
      handles: this.activeTool.handles?.() ?? [],
      hotHandleId: this.activeTool.hotHandle?.() ?? null,
      underlay: u && img ? { image: img, u } : null,
      units: ui.displayUnits,
      showGrid: ui.showGrid,
      gridSize: project.settings.gridSize,
      cursor: this.hovered ? this.cursorWorld : null,
      northAngle: project.settings.northAngle ?? 0,
    };
  }

  /** Persist and use new Generate-3D options. */
  setGenerateOptions(patch: Partial<Generate3DOptions>, scope?: 'all' | 'active'): void {
    this.generateOptions = { ...this.generateOptions, ...patch };
    if (scope) this.generateScope = scope;
    try {
      localStorage.setItem(GEN_KEY, JSON.stringify({ ...this.generateOptions, scope: this.generateScope }));
    } catch {
      // Storage unavailable (private mode): options just are not remembered.
    }
    this.notifyView();
  }

  dispose(): void {
    if (this.disposed) return;
    this.activeTool.cancel?.();
    this.activeTool.deactivate?.();
    this.disposed = true;
    if (this.app.ui.get().toolHint) this.app.ui.set({ toolHint: '' });
    if (this.raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.closePrompt();
    this.root.remove();
  }
}

function padBounds(b: Bounds2, pad: number): Bounds2 {
  return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
}

function loadGenerateOptions(): Generate3DOptions {
  try {
    const raw = localStorage.getItem(GEN_KEY);
    if (raw) {
      const { scope: _s, ...v } = JSON.parse(raw) as Partial<Generate3DOptions> & { scope?: string };
      return { ...DEFAULT_GENERATE_OPTIONS, ...v, levelIds: undefined };
    }
  } catch {
    // Fall back to defaults.
  }
  return { ...DEFAULT_GENERATE_OPTIONS };
}

function loadGenerateScope(): 'all' | 'active' {
  try {
    const raw = localStorage.getItem(GEN_KEY);
    if (raw && (JSON.parse(raw) as { scope?: string }).scope === 'active') return 'active';
  } catch {
    // Default scope.
  }
  return 'all';
}
