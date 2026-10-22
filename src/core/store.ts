import { cloneElement } from './defaults';
import type { Element, Level, Project } from './types';

/**
 * Describes what changed in one committed transaction (or undo/redo step).
 * Views use it for incremental updates; call `affectedIds()` (core/dependencies.ts)
 * to expand it to elements whose GEOMETRY depends on the changed ones (wall joins, hosted openings).
 */
export interface ChangeSet {
  added: string[];
  updated: string[];
  removed: string[];
  /** Level list or a level's properties changed (elevation/height affect most geometry). */
  levelsChanged: boolean;
  /** Project info/settings changed. */
  settingsChanged: boolean;
  /** The whole project was replaced (load/new). Views should rebuild everything. */
  reset: boolean;
  /** Human readable label of the transaction, e.g. "Place wall". */
  label: string;
  /** 'user' | 'undo' | 'redo' | 'load' — lets views decide e.g. whether to re-select. */
  origin: 'user' | 'undo' | 'redo' | 'load';
  /** Element values BEFORE this change, for every updated or removed id. */
  previous: Record<string, Element>;
}

type ElementPatch = { id: string; before: Element | undefined; after: Element | undefined };

interface HistoryEntry {
  label: string;
  elements: ElementPatch[];
  levelsBefore?: Level[];
  levelsAfter?: Level[];
  settingsBefore?: Pick<Project, 'info' | 'settings'>;
  settingsAfter?: Pick<Project, 'info' | 'settings'>;
}

export type StoreListener = (change: ChangeSet) => void;

/** Mutation API available inside `store.transact()`. */
export interface Transaction {
  add<T extends Element>(el: T): T;
  /** Shallow-merge `patch` into the element. Nested objects (start/end/outline) must be replaced whole. */
  update<T extends Element>(id: string, patch: Partial<T>): void;
  /** Replace the element entirely (same id). */
  replace(el: Element): void;
  /** Remove an element; walls cascade to their hosted openings. */
  remove(id: string): void;
  get(id: string): Element | undefined;
  addLevel(level: Level): void;
  updateLevel(id: string, patch: Partial<Level>): void;
  /** Removes the level and every element on it. */
  removeLevel(id: string): void;
  updateInfo(patch: Partial<Project['info']>): void;
  updateSettings(patch: Partial<Project['settings']>): void;
}

const MAX_HISTORY = 500;

/**
 * Single source of truth for the open project, with transactional edits and unlimited-ish undo.
 *
 * Elements are treated as immutable values: every update stores a NEW object, so views can
 * cheaply detect changes by identity, and history keeps before/after snapshots.
 */
export class DocumentStore {
  private _project: Project;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<StoreListener>();
  private active: { entry: HistoryEntry; touched: Map<string, ElementPatch> } | null = null;
  private dirty = false;

  constructor(project: Project) {
    this._project = project;
  }

  get project(): Readonly<Project> {
    return this._project;
  }

  /** True when there are unsaved edits since the last `markSaved()`/`load()`. */
  get isDirty(): boolean {
    return this.dirty;
  }

  markSaved(): void {
    this.dirty = false;
  }

  getElement(id: string): Element | undefined {
    return this._project.elements[id];
  }

  get elements(): Element[] {
    return Object.values(this._project.elements);
  }

  elementsOnLevel(levelId: string): Element[] {
    return this.elements.filter((e) => e.levelId === levelId);
  }

  getLevel(id: string): Level | undefined {
    return this._project.levels.find((l) => l.id === id);
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  /** Replace the whole project (open file / new). Clears history. */
  load(project: Project): void {
    this._project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit({ ...emptyChange('Load project', 'load'), reset: true, levelsChanged: true, settingsChanged: true });
  }

  /**
   * Run `fn` as one undoable step. Nested calls join the outer transaction.
   * If `fn` throws, all of its changes are rolled back and the error is rethrown.
   */
  transact<R>(label: string, fn: (tx: Transaction) => R): R {
    if (this.active) return fn(this.txApi());
    const entry: HistoryEntry = { label, elements: [] };
    this.active = { entry, touched: new Map() };
    let result: R;
    try {
      result = fn(this.txApi());
    } catch (err) {
      const { touched } = this.active;
      this.active = null;
      this.revert(entry, touched);
      throw err;
    }
    const { touched } = this.active;
    this.active = null;
    entry.elements = [...touched.values()].filter((p) => p.before !== p.after);
    const noop = entry.elements.length === 0 && !entry.levelsAfter && !entry.settingsAfter;
    if (noop) return result;
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this._project.info.modified = new Date().toISOString();
    this.emit(this.changeFromEntry(entry, 'user', false));
    return result;
  }

  // Convenience single-operation transactions.
  add<T extends Element>(el: T, label = `Add ${el.type}`): T {
    return this.transact(label, (tx) => tx.add(el));
  }

  update<T extends Element>(id: string, patch: Partial<T>, label = 'Edit'): void {
    this.transact(label, (tx) => tx.update<T>(id, patch));
  }

  remove(id: string | string[], label = 'Delete'): void {
    const ids = Array.isArray(id) ? id : [id];
    this.transact(label, (tx) => ids.forEach((i) => tx.remove(i)));
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.applyEntry(entry, 'before');
    this.redoStack.push(entry);
    this.dirty = true;
    this.emit(this.changeFromEntry(entry, 'undo', true));
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.applyEntry(entry, 'after');
    this.undoStack.push(entry);
    this.dirty = true;
    this.emit(this.changeFromEntry(entry, 'redo', false));
    return true;
  }

  /** Serialisable deep copy of the current project. */
  snapshot(): Project {
    return JSON.parse(JSON.stringify(this._project)) as Project;
  }

  // ---------------------------------------------------------------------------

  private txApi(): Transaction {
    const store = this;
    const a = this.active!;
    const els = () => store._project.elements;

    const touch = (id: string, after: Element | undefined) => {
      const existing = a.touched.get(id);
      if (existing) existing.after = after;
      else a.touched.set(id, { id, before: els()[id], after });
      if (after) els()[id] = after;
      else delete els()[id];
    };

    const snapshotLevels = () => {
      if (!a.entry.levelsBefore) a.entry.levelsBefore = store._project.levels.map((l) => ({ ...l }));
    };
    const commitLevels = () => {
      store._project.levels.sort((x, y) => x.elevation - y.elevation);
      a.entry.levelsAfter = store._project.levels.map((l) => ({ ...l }));
    };
    const snapshotSettings = () => {
      if (!a.entry.settingsBefore)
        a.entry.settingsBefore = { info: { ...store._project.info }, settings: { ...store._project.settings } };
    };
    const commitSettings = () => {
      a.entry.settingsAfter = { info: { ...store._project.info }, settings: { ...store._project.settings } };
    };

    const api: Transaction = {
      add(el) {
        if (els()[el.id]) throw new Error(`Element ${el.id} already exists`);
        if (!store.getLevel(el.levelId)) throw new Error(`Unknown level ${el.levelId}`);
        const copy = cloneElement(el);
        touch(el.id, copy);
        return copy as typeof el;
      },
      update(id, patch) {
        const cur = els()[id];
        if (!cur) return;
        const next = { ...cur, ...patch, id: cur.id, type: cur.type } as Element;
        touch(id, next);
      },
      replace(el) {
        if (!els()[el.id]) throw new Error(`Element ${el.id} does not exist`);
        touch(el.id, cloneElement(el));
      },
      remove(id) {
        const cur = els()[id];
        if (!cur) return;
        if (cur.type === 'wall') {
          for (const e of Object.values(els())) {
            if ((e.type === 'door' || e.type === 'window') && e.hostId === id) touch(e.id, undefined);
          }
        }
        touch(id, undefined);
      },
      get(id) {
        return els()[id];
      },
      addLevel(level) {
        snapshotLevels();
        if (store._project.levels.some((l) => l.id === level.id)) throw new Error(`Level ${level.id} exists`);
        store._project.levels.push({ ...level });
        commitLevels();
      },
      updateLevel(id, patch) {
        snapshotLevels();
        const idx = store._project.levels.findIndex((l) => l.id === id);
        if (idx < 0) return;
        store._project.levels[idx] = { ...store._project.levels[idx], ...patch, id };
        commitLevels();
      },
      removeLevel(id) {
        if (store._project.levels.length <= 1) throw new Error('A project needs at least one level');
        for (const e of Object.values(els())) if (e.levelId === id) touch(e.id, undefined);
        snapshotLevels();
        store._project.levels = store._project.levels.filter((l) => l.id !== id);
        commitLevels();
      },
      updateInfo(patch) {
        snapshotSettings();
        store._project.info = { ...store._project.info, ...patch };
        commitSettings();
      },
      updateSettings(patch) {
        snapshotSettings();
        store._project.settings = { ...store._project.settings, ...patch };
        commitSettings();
      },
    };
    return api;
  }

  private revert(entry: HistoryEntry, touched: Map<string, ElementPatch>): void {
    for (const p of touched.values()) {
      if (p.before) this._project.elements[p.id] = p.before;
      else delete this._project.elements[p.id];
    }
    if (entry.levelsBefore) this._project.levels = entry.levelsBefore.map((l) => ({ ...l }));
    if (entry.settingsBefore) {
      this._project.info = { ...entry.settingsBefore.info };
      this._project.settings = { ...entry.settingsBefore.settings };
    }
  }

  private applyEntry(entry: HistoryEntry, side: 'before' | 'after'): void {
    for (const p of entry.elements) {
      const v = p[side];
      if (v) this._project.elements[p.id] = v;
      else delete this._project.elements[p.id];
    }
    const levels = side === 'before' ? entry.levelsBefore : entry.levelsAfter;
    if (levels) this._project.levels = levels.map((l) => ({ ...l }));
    const s = side === 'before' ? entry.settingsBefore : entry.settingsAfter;
    if (s) {
      this._project.info = { ...s.info };
      this._project.settings = { ...s.settings };
    }
  }

  private changeFromEntry(entry: HistoryEntry, origin: ChangeSet['origin'], inverse: boolean): ChangeSet {
    const c = emptyChange(entry.label, origin);
    for (const p of entry.elements) {
      const before = inverse ? p.after : p.before;
      const after = inverse ? p.before : p.after;
      if (!before && after) c.added.push(p.id);
      else if (before && !after) c.removed.push(p.id);
      else if (before && after) c.updated.push(p.id);
      if (before) c.previous[p.id] = before;
    }
    c.levelsChanged = !!entry.levelsAfter;
    c.settingsChanged = !!entry.settingsAfter;
    return c;
  }

  private emit(change: ChangeSet): void {
    for (const l of [...this.listeners]) {
      try {
        l(change);
      } catch (err) {
        console.error('Store listener failed', err);
      }
    }
  }
}

export function emptyChange(label: string, origin: ChangeSet['origin']): ChangeSet {
  return {
    added: [],
    updated: [],
    removed: [],
    levelsChanged: false,
    settingsChanged: false,
    reset: false,
    label,
    origin,
    previous: {},
  };
}
