/**
 * Temporary tools for blueprint images: two-point calibration and dragging the image.
 */
import { distance, pointInPolygon, sub } from '../../core/math2d';
import type { LevelUnderlay, Vec2 } from '../../core/types';
import { parseLength } from '../../core/units';
import { calibrateUnderlay, underlayOutline } from '../underlay';
import type { PlanTool, ToolHost, ToolPointer } from './types';

export interface UnderlayHost extends ToolHost {
  underlayPreview: LevelUnderlay | null;
  endOverride(): void;
  underlaySize(): { w: number; h: number } | null;
}

export class CalibrateTool implements PlanTool {
  readonly name = 'calibrate';
  private a: Vec2 | null = null;
  private b: Vec2 | null = null;

  constructor(private host: UnderlayHost) {}

  activate(): void {
    this.host.setHint('Calibrate image: click the first point of a known distance on the image');
    this.host.setCursor('crosshair');
  }

  busy(): boolean {
    return !!this.a;
  }

  pointerMove(e: ToolPointer): void {
    this.host.setCursor('crosshair');
    const host = this.host;
    if (this.b) return;
    if (!this.a) {
      host.setOverlay([{ t: 'point', p: e.world, color: '#c2410c' }, { t: 'tag', p: e.world, text: 'Click the first reference point', tone: 'warning' }]);
      return;
    }
    host.setOverlay([
      { t: 'line', a: this.a, b: e.world, color: '#c2410c', width: 1.5 },
      { t: 'point', p: this.a, color: '#c2410c' },
      { t: 'point', p: e.world, color: '#c2410c' },
      { t: 'tag', p: e.world, text: 'Click the second reference point', sub: `currently ${host.fmt(distance(this.a, e.world))}`, tone: 'warning' },
    ]);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0 || this.b) return;
    const host = this.host;
    if (!this.a) {
      this.a = { ...e.world };
      host.setHint('Calibrate image: click the second point');
      return;
    }
    if (distance(this.a, e.world) < host.tol(4)) return;
    this.b = { ...e.world };
    const a = this.a;
    const b = this.b;
    host.setOverlay([
      { t: 'line', a, b, color: '#c2410c', width: 1.5 },
      { t: 'point', p: a, color: '#c2410c' },
      { t: 'point', p: b, color: '#c2410c' },
    ]);
    host.prompt({
      at: { x: e.screen.x + 10, y: e.screen.y + 10 },
      label: 'Real distance between the points',
      placeholder: 'e.g. 5m, 5000, 16\'4"',
      onSubmit: (v) => {
        const real = parseLength(v, host.app.ui.get().displayUnits);
        if (!real || real <= 0) return false;
        this.apply(a, b, real);
      },
      onCancel: () => this.reset(),
    });
  }

  /** Apply a calibration (also used by tests). */
  apply(a: Vec2, b: Vec2, real: number): void {
    const host = this.host;
    const u = host.level.underlay;
    if (!u) return;
    const next = calibrateUnderlay(u, a, b, real);
    host.transact('Calibrate underlay', (tx) => tx.updateLevel(host.levelId, { underlay: next }));
    host.toast(`Image scaled: ${host.fmt(real)} between the points`, 'success');
    this.reset();
    host.endOverride();
  }

  private reset(): void {
    this.a = null;
    this.b = null;
    this.host.setOverlay([]);
    this.activate();
  }

  cancel(): boolean {
    if (!this.a) return false;
    this.reset();
    return true;
  }
}

export class MoveUnderlayTool implements PlanTool {
  readonly name = 'move-underlay';
  private start: { world: Vec2; u: LevelUnderlay } | null = null;

  constructor(private host: UnderlayHost) {}

  activate(): void {
    this.host.setHint('Move image: drag the image · Esc when done');
  }

  busy(): boolean {
    return !!this.start;
  }

  private overImage(p: Vec2): boolean {
    const u = this.host.level.underlay;
    const size = this.host.underlaySize();
    return !!u && !!size && pointInPolygon(p, underlayOutline(u, size.w, size.h));
  }

  pointerMove(e: ToolPointer): void {
    const host = this.host;
    if (!this.start) {
      host.setCursor(this.overImage(e.world) ? 'grab' : 'default');
      return;
    }
    host.setCursor('grabbing');
    const d = sub(e.world, this.start.world);
    host.underlayPreview = { ...this.start.u, x: Math.round(this.start.u.x + d.x), y: Math.round(this.start.u.y + d.y) };
    host.invalidate();
  }

  pointerDown(e: ToolPointer): void {
    const u = this.host.level.underlay;
    if (e.button !== 0 || !u) return;
    this.start = { world: e.world, u };
  }

  pointerUp(): void {
    const host = this.host;
    const next = host.underlayPreview;
    this.start = null;
    host.underlayPreview = null;
    if (next) host.transact('Move underlay', (tx) => tx.updateLevel(host.levelId, { underlay: next }));
  }

  cancel(): boolean {
    if (!this.start) return false;
    this.start = null;
    this.host.underlayPreview = null;
    this.host.invalidate();
    return true;
  }

  contextClick(): void {
    this.host.endOverride();
  }

  deactivate(): void {
    this.host.underlayPreview = null;
  }
}
