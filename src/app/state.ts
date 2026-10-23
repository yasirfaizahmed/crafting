/**
 * Shared application context passed to every view/module: the document store plus
 * UI state, selection, an event bus and a command registry.
 */
import { DEFAULT_HOTBAR, getCatalogItem, type CatalogItem } from '../core/catalog';
import type { DocumentStore } from '../core/store';
import type { UnitSystem } from '../core/types';

type Listener<T> = (value: T, prev: T) => void;

/** Tiny observable object store. `set` shallow-merges and notifies only on real changes. */
export class Observable<T extends object> {
  private value: T;
  private listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(patch: Partial<T>): void {
    const prev = this.value;
    let changed = false;
    for (const k of Object.keys(patch) as (keyof T)[]) {
      if (!Object.is(prev[k], patch[k])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.value = { ...prev, ...patch };
    for (const l of [...this.listeners]) l(this.value, prev);
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export type ViewMode = 'plan' | '3d' | 'split';
/** 3D camera: orbit around a target, or first person walking (gravity) or flying (Minecraft creative). */
export type CameraMode = 'fly' | 'orbit' | 'walk';

export interface UIState {
  activeLevelId: string;
  viewMode: ViewMode;
  /** 3D camera mode: orbit around a target, or Minecraft-style first person walking or flying. */
  cameraMode: CameraMode;
  /** Sound effects in the 3D world (placing, breaking, footsteps, doors). */
  sound: boolean;
  /** Nine catalog item ids. */
  hotbar: string[];
  hotbarIndex: number;
  /** Creative inventory overlay open. */
  inventoryOpen: boolean;
  /** Snapping. */
  snapGrid: boolean;
  snapObjects: boolean;
  /** Constrain drawing angles to 15° increments (Shift toggles temporarily). */
  snapAngle: boolean;
  showGrid: boolean;
  /** Show the level below as a faded underlay in plan / ghosted in 3D. */
  showLevelBelow: boolean;
  /** 3D: hide levels above the active one (cut-away dollhouse view). */
  cutAboveActive: boolean;
  /** 3D: semi-transparent walls. */
  xray: boolean;
  /** 3D: sun shadows. */
  shadows: boolean;
  /** Sun azimuth/altitude in degrees for the 3D view and shadow studies. */
  sunAzimuth: number;
  sunAltitude: number;
  displayUnits: UnitSystem;
  /** Free text shown in the status bar by the active tool (hint / live dimension). */
  toolHint: string;
}

export function activeItem(ui: UIState): CatalogItem {
  return getCatalogItem(ui.hotbar[ui.hotbarIndex]) ?? getCatalogItem('tool-select')!;
}

export function initialUIState(levelId: string): UIState {
  return {
    activeLevelId: levelId,
    viewMode: 'split',
    cameraMode: 'orbit',
    sound: true,
    hotbar: [...DEFAULT_HOTBAR],
    hotbarIndex: 1,
    inventoryOpen: false,
    snapGrid: true,
    snapObjects: true,
    snapAngle: true,
    showGrid: true,
    showLevelBelow: true,
    cutAboveActive: false,
    xray: false,
    shadows: true,
    sunAzimuth: 135,
    sunAltitude: 45,
    displayUnits: 'metric',
    toolHint: '',
  };
}

/** Ordered set of selected element ids. */
export class Selection {
  private ids: string[] = [];
  private listeners = new Set<(ids: readonly string[]) => void>();

  get(): readonly string[] {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  get primary(): string | undefined {
    return this.ids[this.ids.length - 1];
  }

  set(ids: string[]): void {
    const next = [...new Set(ids)];
    if (next.length === this.ids.length && next.every((v, i) => v === this.ids[i])) return;
    this.ids = next;
    this.notify();
  }

  toggle(id: string): void {
    this.set(this.has(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id]);
  }

  clear(): void {
    this.set([]);
  }

  /** Drop ids that no longer exist. */
  prune(exists: (id: string) => boolean): void {
    const next = this.ids.filter(exists);
    if (next.length !== this.ids.length) this.set(next);
  }

  subscribe(fn: (ids: readonly string[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l(this.ids);
  }
}

export interface AppEvents {
  /** Show a transient notification. */
  toast: { message: string; kind?: 'info' | 'success' | 'warning' | 'error' };
  /** Ask views to frame these elements (or everything if empty). */
  'zoom-to': { ids: string[] };
  /** The 3D builder hovered an element / the plan hovered one (for cross-highlighting). */
  hover: { id: string | null; source: 'plan' | '3d' };
  /** Request to open a dialog by name: 'export', 'project', 'help', 'levels', 'shortcuts'. */
  'open-dialog': { name: string; options?: Record<string, unknown> };
}

type EventHandler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof AppEvents, Set<EventHandler<never>>>();

  on<K extends keyof AppEvents>(name: K, fn: EventHandler<AppEvents[K]>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(fn as EventHandler<never>);
    this.handlers.set(name, set);
    return () => set.delete(fn as EventHandler<never>);
  }

  emit<K extends keyof AppEvents>(name: K, payload: AppEvents[K]): void {
    for (const fn of [...(this.handlers.get(name) ?? [])]) (fn as EventHandler<AppEvents[K]>)(payload);
  }
}

export interface Command {
  id: string;
  label: string;
  /** Menu group, e.g. 'File', 'Edit', 'View', 'Build', 'Export', 'Help'. */
  group: string;
  /** Display string, e.g. 'Ctrl+Z'. Key handling is done by the keyboard module via `keys`. */
  shortcut?: string;
  /**
   * Key bindings in KeyboardEvent terms: 'ctrl+z', 'ctrl+shift+z', 'delete', 'f'.
   * 'ctrl' matches Ctrl or ⌘. Bindings are ignored while typing in inputs.
   */
  keys?: string[];
  run: () => void | Promise<void>;
  enabled?: () => boolean;
  /** When set, the command only fires from keyboard while this returns true. */
  when?: () => boolean;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private listeners = new Set<() => void>();

  register(cmd: Command): () => void {
    this.commands.set(cmd.id, cmd);
    this.listeners.forEach((l) => l());
    return () => {
      if (this.commands.get(cmd.id) === cmd) this.commands.delete(cmd.id);
      this.listeners.forEach((l) => l());
    };
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  async run(id: string): Promise<boolean> {
    const c = this.commands.get(id);
    if (!c || (c.enabled && !c.enabled())) return false;
    await c.run();
    return true;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export interface AppContext {
  store: DocumentStore;
  ui: Observable<UIState>;
  selection: Selection;
  events: EventBus;
  commands: CommandRegistry;
}
