/**
 * Types shared by the plan editor, its tools and the renderer.
 */
import type { Vec2 } from '../core/types';
import type { SnapKind } from './snapping';

export type Tone = 'info' | 'accent' | 'error' | 'success' | 'warning';

/** Declarative overlay drawn above the plan by the active tool (model mm unless noted). */
export type OverlayItem =
  | { t: 'snap'; p: Vec2; kind: SnapKind }
  | { t: 'guide'; a: Vec2; b: Vec2 }
  | { t: 'line'; a: Vec2; b: Vec2; color?: string; dash?: number[]; width?: number }
  | { t: 'poly'; pts: Vec2[]; closed?: boolean; color?: string; fill?: string; dash?: number[]; width?: number }
  /** Live dimension between a and b, offset `offset` px to the left of a→b. */
  | { t: 'dim'; a: Vec2; b: Vec2; offset: number; text: string; tone?: Tone }
  /** Pill label anchored at a model point, shifted by (dx, dy) px. */
  | { t: 'tag'; p: Vec2; text: string; dx?: number; dy?: number; tone?: Tone; sub?: string }
  /** Selection rectangle in SCREEN px. */
  | { t: 'box'; a: Vec2; b: Vec2; mode: 'window' | 'crossing' }
  /** Angle arc at c with screen radius r, from a0 to a1 degrees (CCW). */
  | { t: 'arc'; c: Vec2; r: number; a0: number; a1: number; color?: string }
  | { t: 'point'; p: Vec2; color?: string; r?: number };

export type HandleShape = 'square' | 'circle' | 'diamond';

export interface Handle {
  /** Stable id: `${elementId}:${kind}:${index}`. */
  id: string;
  elementId: string;
  kind: 'wall-start' | 'wall-end' | 'vertex' | 'insert' | 'rotate' | 'point-a' | 'point-b' | 'offset' | 'opening-a' | 'opening-b';
  p: Vec2;
  index?: number;
  shape: HandleShape;
  cursor?: string;
}

export type GhostState = 'valid' | 'invalid' | 'neutral';

export type HoverTone = 'normal' | 'erase' | 'pick' | 'paint';
