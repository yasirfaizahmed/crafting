/**
 * Shared types of the 3D builder tools. Tools are renderer-agnostic: they receive pick hits in
 * plan coordinates and talk to the scene only through `GhostSink`, so their logic runs in Node tests.
 */
import type { AppContext } from '../../app/state';
import type { CatalogItem } from '../../core/catalog';
import type { Element, Level, Vec2, Vec3 } from '../../core/types';

/** Result of picking the 3D scene (crosshair in fly mode, mouse cursor in orbit mode). */
export interface PickHit {
  /** Element under the pointer; undefined for the floor plane / ground. */
  elementId?: string;
  /** Plan position, mm. */
  point: Vec2;
  /** Absolute elevation of the hit point, mm. */
  elevation: number;
  /** Unit surface normal in plan axes (x east, y north, z up), facing the viewer. */
  normal: Vec3;
  /** Level of the hit element, the active level (floor plane) or the ground level. */
  levelId: string;
  kind: 'element' | 'floor' | 'ground';
  /** Distance from the eye, metres. */
  distance: number;
  /** Material of the hit part, when known. */
  materialId?: string;
}

/** Where the player (camera) is and which way it looks. */
export interface PlayerView {
  /** Eye position in plan, mm. */
  position: Vec2;
  /** Eye elevation, mm. */
  elevation: number;
  /** Horizontal facing direction, degrees CCW from +x (plan). */
  yaw: number;
}

/** A plan point at an absolute elevation (mm). */
export interface PlanPoint {
  point: Vec2;
  elevation: number;
}

export interface GhostOptions {
  /** Render with the real materials (drag preview) instead of translucent ghost materials. */
  solid?: boolean;
  /** Element ids hidden while the preview is shown (the originals being moved). */
  hide?: string[];
  /** Levels that do not exist yet (auto-created on commit). */
  extraLevels?: Level[];
  /** Elements in the list rendered with their real materials even when the rest is ghosted. */
  solidIds?: string[];
}

/** Scene feedback a tool can draw: ghost elements, rubber-band lines, snap marker, a floating label. */
export interface GhostSink {
  show(elements: Element[], valid: boolean, options?: GhostOptions): void;
  line(points: PlanPoint[] | null, valid?: boolean): void;
  marker(at: PlanPoint | null, valid?: boolean): void;
  label(text: string | null, at?: PlanPoint): void;
  clear(): void;
}

export interface KeyInput {
  key: string;
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

/** Everything a tool may use. Implemented by the viewport (and by fakes in tests). */
export interface ToolEnv {
  ctx: AppContext;
  /** The catalog item in hand when the tool was created. */
  item: CatalogItem;
  ghost: GhostSink;
  player(): PlayerView;
  /** Increments whenever the document changes (cache key for derived data such as rooms). */
  revision(): number;
  /** Status-bar hint (ui.toolHint). */
  hint(text: string): void;
  toast(message: string, kind?: 'info' | 'success' | 'warning' | 'error'): void;
  /** Visual feedback (particles); no-op in tests. */
  effect(kind: 'place' | 'break', at: PlanPoint, materialId?: string): void;
}

/**
 * A 3D builder tool. Mouse semantics: `use` = right click (place / use), `primary` = left click
 * (return false to fall back to "break"). Drag hooks are only implemented by the select tool.
 */
export interface Tool {
  hover(hit: PickHit | null): void;
  use(hit: PickHit | null): void;
  primary?(hit: PickHit | null, mods?: { shift: boolean }): boolean;
  /** Return true when the key was consumed. */
  key?(e: KeyInput): boolean;
  /** Abort the operation in progress (Esc). Returns true when something was cancelled. */
  cancel(): boolean;
  dispose(): void;
  beginDrag?(hit: PickHit, additive: boolean): boolean;
  dragTo?(point: Vec2): void;
  endDrag?(commit: boolean): void;
}
