/**
 * Contract between the plan editor (ToolHost) and its tools (PlanTool).
 */
import type { AppContext } from '../../app/state';
import type { CatalogItem } from '../../core/catalog';
import type { DetectedRoom } from '../../core/rooms';
import type { Transaction } from '../../core/store';
import type { Element, ElementType, Level, Vec2, Wall } from '../../core/types';
import type { WallFootprint } from '../../core/walls';
import type { Patch } from '../edit-ops';
import type { GhostState, Handle, HoverTone, OverlayItem } from '../editor-types';
import type { SnapResult } from '../snapping';
import type { Viewport } from '../viewport';

export interface ToolPointer {
  /** CSS px relative to the canvas. */
  screen: Vec2;
  /** Raw model point under the pointer (mm). */
  world: Vec2;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface SnapRequest {
  from?: Vec2;
  track?: Vec2[];
  exclude?: Iterable<string>;
  objects?: boolean;
  grid?: boolean;
  angle?: boolean;
  /** Offer wall faces too (furniture, dimensions, measuring). */
  faces?: boolean;
}

export interface PromptOptions {
  /** Screen position (CSS px) of the input's top-left corner. */
  at: Vec2;
  label?: string;
  value?: string;
  placeholder?: string;
  /** Return false to keep the prompt open (invalid input). */
  onSubmit(value: string): boolean | void;
  onCancel?(): void;
}

export interface WallHit {
  wall: Wall;
  /** Distance along the location line from start. */
  offset: number;
  /** Signed distance from the location line (+ = left side). */
  lateral: number;
}

export interface ToolHost {
  readonly app: AppContext;
  readonly view: Viewport;
  readonly levelId: string;
  readonly level: Level;
  /** The catalog item in hand. */
  readonly item: CatalogItem;
  /** Live modifier state (Shift disables angle snap). */
  readonly shiftDown: boolean;
  /** Elements of the active level (store values). */
  levelElements(): Element[];
  footprints(): Map<string, WallFootprint>;
  rooms(): DetectedRoom[];
  snap(raw: Vec2, req?: SnapRequest): SnapResult;
  hit(p: Vec2, opts?: { types?: ElementType[]; exclude?: Set<string>; areas?: boolean; tolPx?: number }): Element | undefined;
  wallAt(p: Vec2, tolPx?: number): WallHit | undefined;
  /** Model mm for a screen distance. */
  tol(px?: number): number;
  setGhosts(els: Element[], state?: GhostState): void;
  setPreview(patch: Patch | null): void;
  setOverlay(items: OverlayItem[]): void;
  setHover(id: string | null, tone?: HoverTone): void;
  setHint(text: string): void;
  setCursor(cursor: string): void;
  toast(message: string, kind?: 'info' | 'success' | 'warning' | 'error'): void;
  /** One undoable step; bound rooms follow wall changes automatically. */
  transact<R>(label: string, fn: (tx: Transaction) => R): R;
  /** Commit a patch (id → new element value) as one undoable step. */
  commitPatch(label: string, patch: Patch): void;
  prompt(opts: PromptOptions): void;
  invalidate(): void;
  /** Format a length in display units. */
  fmt(mm: number): string;
}

export interface PlanTool {
  readonly name: string;
  activate?(): void;
  deactivate?(): void;
  pointerDown?(e: ToolPointer): void;
  pointerMove?(e: ToolPointer): void;
  pointerUp?(e: ToolPointer): void;
  doubleClick?(e: ToolPointer): void;
  /** Right-button click (no drag): finish or cancel the current operation. */
  contextClick?(e: ToolPointer): void;
  /** Return true when the key was consumed. */
  keyDown?(e: KeyboardEvent): boolean;
  /** Esc: return true if an operation was cancelled. */
  cancel?(): boolean;
  /** True while an operation is in progress (typed lengths are captured, Backspace is consumed). */
  busy?(): boolean;
  /** Pointer left the canvas. */
  leave?(): void;
  /** The document changed (undo, other views). */
  modelChanged?(): void;
  handles?(): Handle[];
  hotHandle?(): string | null;
}
