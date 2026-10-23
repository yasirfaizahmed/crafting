import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { rasterSize, renderDrawingToContext } from '../canvas';
import { generatePlanDrawing } from '../plan';

/** Minimal recording stand-in for CanvasRenderingContext2D. */
function recorder() {
  const calls: { op: string; args: unknown[] }[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ op: prop, args });
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      calls.push({ op: `set:${prop}`, args: [value] });
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('canvas renderer', () => {
  const sample = createSampleProject();
  const plan = generatePlanDrawing(sample, sample.levels[0].id);

  it('sizes the raster from the paper extent and dpi, within limits', () => {
    const s = rasterSize(plan, { dpi: 150 });
    expect(s.pxPerMm).toBeCloseTo(150 / 25.4, 6);
    expect(s.width).toBe(Math.round(s.paperW * s.pxPerMm));
    const small = rasterSize(plan, { dpi: 600, maxWidth: 800 });
    expect(small.width).toBeLessThanOrEqual(800);
    const huge = rasterSize({ ...plan, scale: 1 }, { dpi: 600 });
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(16384);
  });

  it('paints a white background then the drawing in mm units', () => {
    const { ctx, calls } = recorder();
    const size = renderDrawingToContext(ctx, plan, { dpi: 96 });
    const fillRect = calls.find((c) => c.op === 'fillRect')!;
    expect(fillRect.args).toEqual([0, 0, size.width, size.height]);
    const transforms = calls.filter((c) => c.op === 'setTransform');
    expect(transforms[1].args[0]).toBeCloseTo(96 / 25.4, 6);
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('KITCHEN');
    expect(texts).toContain('GROUND FLOOR PLAN');
    // Door swings are native arcs.
    expect(calls.filter((c) => c.op === 'arc' && c.args[5] === true).length).toBeGreaterThanOrEqual(4);
    expect(calls.some((c) => c.op === 'fill' && c.args[0] === 'evenodd')).toBe(true);
    expect(calls.some((c) => c.op === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(true);
  });
});
