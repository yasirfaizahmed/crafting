/**
 * Linear tools: beam (two clicks), railing (polyline), dimension (two points + offset; clicking a
 * wall dimensions it), measure (two-click readout) and text labels (inline input).
 */
import { angleDeg, distance, dot, normalize, perp, sub } from '../../core/math2d';
import type { Beam, Dimension, Label, Railing, Vec2 } from '../../core/types';
import type { OverlayItem } from '../editor-types';
import type { SnapResult } from '../snapping';
import { makeFromItem } from './common';
import type { PlanTool, ToolHost, ToolPointer } from './types';

function snapItems(s: SnapResult | null): OverlayItem[] {
  if (!s) return [];
  const items: OverlayItem[] = [];
  for (const g of s.guides) items.push(g.kind === 'angle' ? { t: 'line', a: g.from, b: g.to, dash: [2, 4], width: 1 } : { t: 'guide', a: g.from, b: g.to });
  if (s.kind !== 'none' && s.kind !== 'angle') items.push({ t: 'snap', p: s.point, kind: s.kind });
  else items.push({ t: 'point', p: s.point, r: 3 });
  return items;
}

export class BeamTool implements PlanTool {
  readonly name = 'beam';
  private start: Vec2 | null = null;
  private cur: SnapResult | null = null;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint(`${this.host.item.name}: click the start and the end of the beam`);
  }

  busy(): boolean {
    return !!this.start;
  }

  pointerMove(e: ToolPointer): void {
    const host = this.host;
    this.cur = host.snap(e.world, { from: this.start ?? undefined });
    const items = snapItems(this.cur);
    if (this.start && distance(this.start, this.cur.point) > 1) {
      host.setGhosts([{ ...makeFromItem<Beam>(host, { start: this.start, end: this.cur.point }), id: '__ghost_beam' }], 'neutral');
      items.push({ t: 'dim', a: this.start, b: this.cur.point, offset: 26, text: host.fmt(distance(this.start, this.cur.point)) });
    } else host.setGhosts([]);
    host.setOverlay(items);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const p = this.host.snap(e.world, { from: this.start ?? undefined }).point;
    if (!this.start) {
      this.start = p;
      return;
    }
    if (distance(this.start, p) < 1) return;
    const b = makeFromItem<Beam>(this.host, { start: this.start, end: p });
    this.start = null;
    this.host.transact('Place beam', (tx) => tx.add(b));
    this.host.setGhosts([]);
  }

  cancel(): boolean {
    if (!this.start) return false;
    this.start = null;
    this.host.setGhosts([]);
    return true;
  }

  contextClick(): void {
    this.cancel();
  }

  deactivate(): void {
    this.host.setGhosts([]);
  }
}

export class RailingTool implements PlanTool {
  readonly name = 'railing';
  private pts: Vec2[] = [];
  private cur: SnapResult | null = null;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint(`${this.host.item.name}: click points along the railing · double-click / Enter / right-click to finish`);
  }

  busy(): boolean {
    return this.pts.length > 0;
  }

  pointerMove(e: ToolPointer): void {
    const host = this.host;
    this.cur = host.snap(e.world, { from: this.pts[this.pts.length - 1], track: this.pts });
    const items = snapItems(this.cur);
    const path = [...this.pts, this.cur.point];
    if (path.length >= 2) {
      host.setGhosts([{ ...makeFromItem<Railing>(host, { path }), id: '__ghost_railing' }], 'neutral');
      const last = this.pts[this.pts.length - 1];
      items.push({ t: 'dim', a: last, b: this.cur.point, offset: 22, text: host.fmt(distance(last, this.cur.point)) });
    } else host.setGhosts([]);
    host.setOverlay(items);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const p = this.host.snap(e.world, { from: this.pts[this.pts.length - 1], track: this.pts }).point;
    const last = this.pts[this.pts.length - 1];
    if (!last || distance(last, p) > 1) this.pts.push(p);
  }

  doubleClick(): void {
    this.finish();
  }

  contextClick(): void {
    this.finish();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.pts.length) return false;
    if (e.key === 'Enter') {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace') {
      this.pts.pop();
      return true;
    }
    return false;
  }

  finish(): void {
    const pts = this.pts;
    this.pts = [];
    this.host.setGhosts([]);
    if (pts.length < 2) return;
    const r = makeFromItem<Railing>(this.host, { path: pts });
    this.host.transact('Place railing', (tx) => tx.add(r));
  }

  cancel(): boolean {
    if (!this.pts.length) return false;
    this.pts = [];
    this.host.setGhosts([]);
    return true;
  }

  deactivate(): void {
    this.host.setGhosts([]);
  }
}

export class DimensionTool implements PlanTool {
  readonly name = 'dimension';
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;
  private cur: SnapResult | null = null;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.hint();
  }

  private hint(): void {
    this.host.setHint(
      this.b ? 'Dimension: move to place the dimension line, click to finish' : this.a ? 'Dimension: click the second point' : 'Dimension: click two points (or click a wall to dimension it), then place the line',
    );
  }

  busy(): boolean {
    return !!this.a;
  }

  private ghost(offset: number, b: Vec2): Dimension {
    return { ...makeFromItem<Dimension>(this.host, { a: this.a!, b, offset }), id: '__ghost_dim' };
  }

  private offsetFor(p: Vec2): number {
    const n = perp(normalize(sub(this.b!, this.a!)));
    return Math.round(dot(sub(p, this.a!), n) / 10) * 10;
  }

  pointerMove(e: ToolPointer): void {
    const host = this.host;
    if (this.a && this.b) {
      host.setGhosts([this.ghost(this.offsetFor(e.world), this.b)], 'neutral');
      host.setOverlay([]);
      return;
    }
    this.cur = host.snap(e.world, { from: this.a ?? undefined, faces: true });
    const items = snapItems(this.cur);
    if (this.a && distance(this.a, this.cur.point) > 1) host.setGhosts([this.ghost(0, this.cur.point)], 'neutral');
    else {
      host.setGhosts([]);
      const w = !this.a && (this.cur.kind === 'nearest' || this.cur.kind === 'none' || this.cur.kind === 'grid') ? host.wallAt(e.world, 4) : undefined;
      if (w) items.push({ t: 'tag', p: e.world, text: 'Click to dimension this wall', sub: host.fmt(distance(w.wall.start, w.wall.end)), tone: 'info' });
    }
    host.setOverlay(items);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const host = this.host;
    if (this.a && this.b) {
      const d = makeFromItem<Dimension>(host, { a: this.a, b: this.b, offset: this.offsetFor(e.world) });
      this.reset();
      host.transact('Add dimension', (tx) => tx.add(d));
      return;
    }
    const s = host.snap(e.world, { from: this.a ?? undefined, faces: true });
    if (!this.a) {
      const w = s.kind === 'nearest' || s.kind === 'none' || s.kind === 'grid' ? host.wallAt(e.world, 4) : undefined;
      if (w) {
        this.a = { ...w.wall.start };
        this.b = { ...w.wall.end };
      } else this.a = s.point;
      this.hint();
      return;
    }
    if (distance(this.a, s.point) < 1) return;
    this.b = s.point;
    this.hint();
  }

  private reset(): void {
    this.a = null;
    this.b = null;
    this.host.setGhosts([]);
    this.host.setOverlay([]);
    this.hint();
  }

  cancel(): boolean {
    if (!this.a) return false;
    this.reset();
    return true;
  }

  contextClick(): void {
    this.cancel();
  }

  deactivate(): void {
    this.host.setGhosts([]);
  }
}

export class MeasureTool implements PlanTool {
  readonly name = 'measure';
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint('Measure: click two points');
  }

  busy(): boolean {
    return !!this.a && !this.b;
  }

  private show(a: Vec2, b: Vec2, extra: OverlayItem[] = []): void {
    const host = this.host;
    const d = distance(a, b);
    const v = sub(b, a);
    const ang = ((angleDeg(v) % 360) + 360) % 360;
    host.setOverlay([
      ...extra,
      { t: 'line', a, b, color: '#c2410c', width: 1.5 },
      { t: 'point', p: a, color: '#c2410c' },
      { t: 'point', p: b, color: '#c2410c' },
      { t: 'tag', p: b, text: host.fmt(d), sub: `Δx ${host.fmt(Math.abs(v.x))} · Δy ${host.fmt(Math.abs(v.y))} · ${ang.toFixed(1)}°`, tone: 'warning' },
    ]);
    host.setHint(`Distance ${host.fmt(d)}  (Δx ${host.fmt(Math.abs(v.x))}, Δy ${host.fmt(Math.abs(v.y))}, ${ang.toFixed(1)}°)`);
  }

  pointerMove(e: ToolPointer): void {
    if (this.b) return;
    const s = this.host.snap(e.world, { from: this.a ?? undefined, faces: true });
    if (this.a) this.show(this.a, s.point, snapItems(s));
    else this.host.setOverlay(snapItems(s));
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const s = this.host.snap(e.world, { from: this.a && !this.b ? this.a : undefined, faces: true });
    if (!this.a || this.b) {
      this.a = s.point;
      this.b = null;
      return;
    }
    this.b = s.point;
    this.show(this.a, this.b);
  }

  cancel(): boolean {
    if (!this.a) return false;
    this.a = null;
    this.b = null;
    this.host.setOverlay([]);
    this.activate();
    return true;
  }

  contextClick(): void {
    this.cancel();
  }
}

export class LabelTool implements PlanTool {
  readonly name = 'label';

  constructor(private host: ToolHost) {}

  activate(): void {
    this.host.setHint('Text: click where the label goes, type, Enter');
  }

  pointerMove(e: ToolPointer): void {
    const s = this.host.snap(e.world);
    this.host.setOverlay([{ t: 'point', p: s.point }, { t: 'tag', p: s.point, text: 'Click to add text', tone: 'info' }]);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const host = this.host;
    const p = host.snap(e.world).point;
    host.prompt({
      at: { x: e.screen.x + 8, y: e.screen.y - 18 },
      label: 'Label text',
      value: '',
      placeholder: String(host.item.template?.text ?? 'Label'),
      onSubmit: (v) => {
        const text = v.trim() || String(host.item.template?.text ?? 'Label');
        const l = makeFromItem<Label>(host, { position: p, text });
        host.transact('Add label', (tx) => tx.add(l));
      },
    });
  }
}
