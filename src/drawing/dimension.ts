/**
 * Dimension rendering rules (ISO 129-1 style, architectural oblique ticks) shared by every output:
 * a DimensionEntity is exploded into extension lines, the dimension line, 45° ticks and text.
 */
import { add, length, normalize, perp, scale, sub } from '../core/math2d';
import type { UnitSystem, Vec2 } from '../core/types';
import { formatLength } from '../core/units';
import type { Segment } from './geom';
import { TEXT } from './layers';
import { textWidth } from './text';
import type { DimensionEntity } from './types';

/** Paper-mm dimension style. */
export const DIM_STYLE = {
  textHeight: TEXT.small,
  /** Gap between the measured point and the start of the extension line. */
  extensionGap: 1.5,
  /** Extension line overshoot beyond the dimension line. */
  extensionBeyond: 1.5,
  /** Dimension line overshoot beyond the extension lines. */
  lineBeyond: 1.2,
  /** Length of the oblique tick. */
  tick: 2.6,
  /** Gap between the dimension line and the text baseline. */
  textGap: 0.9,
  /** Lineweight of ticks, paper mm. */
  tickWeight: 0.35,
};

/** Dimension text: whole millimetres (metric) or feet-inches (imperial). */
export function formatDimension(mm: number, units: UnitSystem): string {
  if (units === 'imperial') return formatLength(mm, 'imperial');
  return `${Math.round(mm)}`;
}

export interface DimensionText {
  position: Vec2;
  text: string;
  height: number;
  rotation: number;
  valign: 'baseline' | 'middle';
}

export interface ExplodedDimension {
  extensions: Segment[];
  line: Segment;
  ticks: Segment[];
  text: DimensionText | null;
}

/** Readable text angle for a direction: (−90°, 90°]. */
export function readableAngle(deg: number): number {
  let a = deg;
  while (a > 90 + 1e-9) a -= 180;
  while (a <= -90 + 1e-9) a += 180;
  return a;
}

/** Explode a dimension into primitives in model space (`scale` = drawing scale denominator). */
export function explodeDimension(d: DimensionEntity, drawingScale: number, units: UnitSystem): ExplodedDimension {
  const s = drawingScale;
  const span = sub(d.b, d.a);
  const len = length(span);
  const u = len > 1e-9 ? scale(span, 1 / len) : { x: 1, y: 0 };
  const n = perp(u);
  const A = add(d.a, scale(n, d.offset));
  const B = add(d.b, scale(n, d.offset));
  const side = d.offset >= 0 ? 1 : -1;
  const extensions: Segment[] = [];
  const gap = DIM_STYLE.extensionGap * s;
  if (Math.abs(d.offset) > gap + 1e-6) {
    const beyond = DIM_STYLE.extensionBeyond * s;
    const fixed = d.extensionLength !== undefined ? Math.min(d.extensionLength * s, Math.abs(d.offset) - gap) : null;
    for (const [p, q] of [
      [d.a, A],
      [d.b, B],
    ] as const) {
      const start = fixed !== null ? sub(q, scale(n, side * fixed)) : add(p, scale(n, side * gap));
      extensions.push([start, add(q, scale(n, side * beyond))]);
    }
  }
  const ext = DIM_STYLE.lineBeyond * s;
  const line: Segment = [sub(A, scale(u, ext)), add(B, scale(u, ext))];
  const t = (DIM_STYLE.tick * s) / 2;
  const diag = normalize(add(u, n));
  const ticks: Segment[] = [A, B].map((p) => [sub(p, scale(diag, t)), add(p, scale(diag, t))] as Segment);
  const label = d.text ?? formatDimension(len, units);
  let text: DimensionText | null = null;
  if (label) {
    const angle = readableAngle((Math.atan2(u.y, u.x) * 180) / Math.PI);
    const rad = ((angle + 90) * Math.PI) / 180;
    const up = { x: Math.cos(rad), y: Math.sin(rad) };
    const mid = scale(add(A, B), 0.5);
    text = d.textPosition
      ? { position: d.textPosition, text: label, height: DIM_STYLE.textHeight, rotation: angle, valign: 'middle' }
      : { position: add(mid, scale(up, DIM_STYLE.textGap * s)), text: label, height: DIM_STYLE.textHeight, rotation: angle, valign: 'baseline' };
  }
  return { extensions, line, ticks, text };
}

/** True if the default text of a dimension fits between its extension lines. */
export function dimensionTextFits(d: Pick<DimensionEntity, 'a' | 'b' | 'text'>, drawingScale: number, units: UnitSystem): boolean {
  const len = length(sub(d.b, d.a));
  const label = d.text ?? formatDimension(len, units);
  return (textWidth(label, DIM_STYLE.textHeight) + 1.2) * drawingScale < len;
}

/** Where to put text that does not fit: beyond the `end` of the dimension line, outside it. */
export function outsideTextPosition(
  d: Pick<DimensionEntity, 'a' | 'b' | 'offset' | 'text'>,
  end: 'a' | 'b',
  drawingScale: number,
  units: UnitSystem,
): Vec2 {
  const span = sub(d.b, d.a);
  const len = length(span);
  const u = len > 1e-9 ? scale(span, 1 / len) : { x: 1, y: 0 };
  const n = perp(u);
  const label = d.text ?? formatDimension(len, units);
  const w = textWidth(label, DIM_STYLE.textHeight) * drawingScale;
  const along = end === 'b' ? len + w / 2 + 2 * drawingScale : -w / 2 - 2 * drawingScale;
  const angle = readableAngle((Math.atan2(u.y, u.x) * 180) / Math.PI);
  const rad = ((angle + 90) * Math.PI) / 180;
  const up = { x: Math.cos(rad), y: Math.sin(rad) };
  const lift = (DIM_STYLE.textGap + DIM_STYLE.textHeight / 2) * drawingScale;
  return add(add(add(d.a, scale(n, d.offset)), scale(u, along)), scale(up, lift));
}
