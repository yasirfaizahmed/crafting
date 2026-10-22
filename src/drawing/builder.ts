/**
 * DrawingBuilder: collects entities into per-layer buckets so the final entity list follows the
 * layer painter's order, and computes model-space extents (including text and dimension boxes).
 */
import { emptyBounds, extendBounds, type Bounds2 } from '../core/math2d';
import type { UnitSystem, Vec2 } from '../core/types';
import { explodeDimension } from './dimension';
import { arcPoints } from './geom';
import { baselineDrop, textWidth } from './text';
import type {
  ArcEntity,
  CircleEntity,
  DimensionEntity,
  Drawing,
  DrawingEntity,
  DrawingLayer,
  FillEntity,
  LineEntity,
  PolylineEntity,
  TextEntity,
} from './types';

type Extra<T> = Partial<Omit<T, 'kind' | 'layer'>>;

export class DrawingBuilder {
  private readonly buckets = new Map<string, DrawingEntity[]>();

  constructor(
    /** Scale denominator (text heights/lineweights are paper mm × scale in model space). */
    readonly scale: number,
    readonly units: UnitSystem = 'metric',
  ) {}

  add<T extends DrawingEntity>(e: T): T {
    const list = this.buckets.get(e.layer);
    if (list) list.push(e);
    else this.buckets.set(e.layer, [e]);
    return e;
  }

  line(layer: string, a: Vec2, b: Vec2, extra: Extra<LineEntity> = {}): LineEntity {
    return this.add({ kind: 'line', layer, a, b, ...extra });
  }

  polyline(layer: string, points: Vec2[], closed: boolean, extra: Extra<PolylineEntity> = {}): PolylineEntity | null {
    if (points.length < 2) return null;
    return this.add({ kind: 'polyline', layer, points, closed, ...extra });
  }

  fill(layer: string, outline: Vec2[], fill: string, extra: Extra<FillEntity> = {}): FillEntity | null {
    if (outline.length < 3) return null;
    return this.add({ kind: 'fill', layer, outline, fill, ...extra });
  }

  arc(layer: string, center: Vec2, radius: number, startAngle: number, endAngle: number, extra: Extra<ArcEntity> = {}): ArcEntity {
    return this.add({ kind: 'arc', layer, center, radius, startAngle, endAngle, ...extra });
  }

  circle(layer: string, center: Vec2, radius: number, extra: Extra<CircleEntity> = {}): CircleEntity {
    return this.add({ kind: 'circle', layer, center, radius, ...extra });
  }

  text(layer: string, position: Vec2, text: string, height: number, extra: Extra<TextEntity> = {}): TextEntity {
    return this.add({ kind: 'text', layer, position, text, height, rotation: 0, align: 'center', valign: 'middle', ...extra });
  }

  dimension(layer: string, a: Vec2, b: Vec2, offset: number, extra: Extra<DimensionEntity> = {}): DimensionEntity {
    return this.add({ kind: 'dimension', layer, a, b, offset, ...extra });
  }

  /** Entities on the named layers only (in the given order). */
  only(names: string[]): DrawingEntity[] {
    return names.flatMap((n) => this.buckets.get(n) ?? []);
  }

  /** Entities of one layer so far. */
  entitiesOn(layer: string): DrawingEntity[] {
    return this.buckets.get(layer) ?? [];
  }

  /** Entities in layer order (layers missing from `layers` follow in insertion order). */
  entities(layers: DrawingLayer[]): DrawingEntity[] {
    const out: DrawingEntity[] = [];
    const done = new Set<string>();
    for (const l of layers) {
      out.push(...(this.buckets.get(l.name) ?? []));
      done.add(l.name);
    }
    for (const [name, list] of this.buckets) if (!done.has(name)) out.push(...list);
    return out;
  }

  build(title: string, layers: DrawingLayer[]): Drawing {
    const entities = this.entities(layers);
    return { title, scale: this.scale, units: this.units, layers, entities, bounds: drawingBounds(entities, this.scale, this.units) };
  }
}

/** Model-space corners of a text entity's box. */
export function textCorners(t: Pick<TextEntity, 'position' | 'text' | 'height' | 'rotation' | 'align' | 'valign' | 'bold'>, drawingScale: number): Vec2[] {
  const h = t.height * drawingScale;
  const w = textWidth(t.text, t.height, t.bold) * drawingScale;
  const x0 = t.align === 'left' ? 0 : t.align === 'right' ? -w : -w / 2;
  const base = -baselineDrop(t.valign, h);
  const y0 = base - h * 0.3;
  const y1 = base + h * 1.05;
  const r = (t.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y1],
    [x0, y1],
  ].map(([x, y]) => ({ x: t.position.x + x * c - y * s, y: t.position.y + x * s + y * c }));
}

/** Model-space extents of entities (text and dimension geometry included). */
export function drawingBounds(entities: DrawingEntity[], drawingScale: number, units: UnitSystem): Bounds2 {
  const b = emptyBounds();
  const ext = (p: Vec2) => extendBounds(b, p);
  for (const e of entities) {
    switch (e.kind) {
      case 'line':
        ext(e.a);
        ext(e.b);
        break;
      case 'polyline':
        e.points.forEach(ext);
        break;
      case 'fill':
        e.outline.forEach(ext);
        break;
      case 'arc':
        arcPoints(e.center, e.radius, e.startAngle, e.endAngle, 15).forEach(ext);
        break;
      case 'circle':
        ext({ x: e.center.x - e.radius, y: e.center.y - e.radius });
        ext({ x: e.center.x + e.radius, y: e.center.y + e.radius });
        break;
      case 'text':
        textCorners(e, drawingScale).forEach(ext);
        break;
      case 'dimension': {
        const x = explodeDimension(e, drawingScale, units);
        for (const s of [...x.extensions, x.line, ...x.ticks]) {
          ext(s[0]);
          ext(s[1]);
        }
        if (x.text)
          textCorners({ position: x.text.position, text: x.text.text, height: x.text.height, rotation: x.text.rotation, align: 'center', valign: x.text.valign }, drawingScale).forEach(ext);
        break;
      }
    }
  }
  return b;
}
