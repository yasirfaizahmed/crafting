import { describe, expect, it } from 'vitest';
import { STEP_UP, walkStep, type WalkProbe, type WalkState } from './walker';

/** Analytic world for tests: a list of axis-aligned solid boxes in world metres. */
interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

function probeFor(boxes: Box[]): WalkProbe {
  return {
    groundAt(x, z, fromY) {
      let best: number | null = fromY >= 0 ? 0 : null;
      for (const b of boxes) {
        if (x < b.min[0] || x > b.max[0] || z < b.min[2] || z > b.max[2]) continue;
        const top = b.max[1];
        if (top <= fromY + 1e-9 && (best === null || top > best)) best = top;
      }
      return best;
    },
    obstacle(x, y, z, dx, dz, maxDist) {
      let best: number | null = null;
      for (const b of boxes) {
        if (y < b.min[1] || y > b.max[1]) continue;
        // Slab test in x/z.
        let t0 = 0;
        let t1 = maxDist;
        const o = [x, z];
        const d = [dx, dz];
        const lo = [b.min[0], b.min[2]];
        const hi = [b.max[0], b.max[2]];
        let ok = true;
        for (let i = 0; i < 2; i++) {
          if (Math.abs(d[i]) < 1e-12) {
            if (o[i] < lo[i] || o[i] > hi[i]) ok = false;
            continue;
          }
          let a = (lo[i] - o[i]) / d[i];
          let c = (hi[i] - o[i]) / d[i];
          if (a > c) [a, c] = [c, a];
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, c);
        }
        if (ok && t0 <= t1 && t0 > 0 && (best === null || t0 < best)) best = t0;
      }
      return best;
    },
  };
}

function walk(s: WalkState, probe: WalkProbe, dx: number, dz: number, seconds: number): WalkState {
  const dt = 1 / 60;
  let st = s;
  for (let t = 0; t < seconds; t += dt) st = walkStep(st, { dx: dx * dt, dz: dz * dt }, dt, probe);
  return st;
}

/** Straight stair rising along −z: 17 risers of 0.176 m, 0.28 m goings, starting at z = 0. */
function stair(): Box[] {
  const boxes: Box[] = [];
  for (let i = 0; i < 17; i++) boxes.push({ min: [-0.5, 0, -(i + 1) * 0.28], max: [0.5, (i + 1) * 0.176, -i * 0.28] });
  boxes.push({ min: [-0.5, 2.82, -12], max: [0.5, 3.0, -17 * 0.28] }); // landing / upper floor
  return boxes;
}

describe('walker physics', () => {
  it('falls with gravity and lands on the ground', () => {
    const probe = probeFor([]);
    const s = walk({ x: 0, y: 5, z: 0, vy: 0, onGround: false }, probe, 0, 0, 2);
    expect(s.y).toBe(0);
    expect(s.onGround).toBe(true);
    expect(s.vy).toBe(0);
  });

  it('climbs stairs because each riser is below the step-up height', () => {
    expect(0.176).toBeLessThan(STEP_UP);
    const probe = probeFor(stair());
    const s = walk({ x: 0, y: 0, z: 1, vy: 0, onGround: true }, probe, 0, -4, 3);
    expect(s.z).toBeLessThan(-5);
    expect(s.y).toBeCloseTo(3.0, 5);
    expect(s.onGround).toBe(true);
  });

  it('is blocked by walls taller than a step and slides along them', () => {
    const wall: Box = { min: [-5, 0, -2.1], max: [5, 3, -1.9] };
    const probe = probeFor([wall]);
    const s = walk({ x: 0, y: 0, z: 0, vy: 0, onGround: true }, probe, 2, -4, 2);
    expect(s.z).toBeGreaterThan(-1.9);
    expect(s.z).toBeCloseTo(-1.9 + 0.3, 1);
    expect(s.x).toBeGreaterThan(3); // slid along x
  });

  it('steps onto a low kerb but not onto a 0.6 m block', () => {
    const kerb: Box = { min: [-5, 0, -3], max: [5, 0.3, -1] };
    const s = walk({ x: 0, y: 0, z: 0, vy: 0, onGround: true }, probeFor([kerb]), 0, -3, 1);
    expect(s.y).toBeCloseTo(0.3, 6);
    const block: Box = { min: [-5, 0, -3], max: [5, 0.6, -1] };
    const s2 = walk({ x: 0, y: 0, z: 0, vy: 0, onGround: true }, probeFor([block]), 0, -3, 1);
    expect(s2.y).toBe(0);
    expect(s2.z).toBeGreaterThan(-1);
  });

  it('jumps and lands again', () => {
    const probe = probeFor([]);
    const s1 = walkStep({ x: 0, y: 0, z: 0, vy: 0, onGround: true }, { dx: 0, dz: 0 }, 1 / 60, probe, true);
    expect(s1.vy).toBeGreaterThan(0);
    expect(s1.onGround).toBe(false);
    let s = s1;
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      s = walkStep(s, { dx: 0, dz: 0 }, 1 / 60, probe);
      peak = Math.max(peak, s.y);
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(s.y).toBe(0);
    expect(s.onGround).toBe(true);
  });
});
