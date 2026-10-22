/**
 * Adaptive grid spacing and scale-bar sizing for the plan view (pure).
 */

/**
 * Minor/major grid steps for the current zoom. The minor step is `gridSize` (the snap grid) when it
 * is at least `minPx` on screen; when zoomed out, steps grow through a 1-2-5 progression so the
 * grid never turns into noise.
 */
export function gridSteps(gridSize: number, scale: number, minPx = 8): { minor: number; major: number } {
  const g = gridSize > 0 ? gridSize : 500;
  const major0 = majorFor(g);
  const seq = [g, major0];
  // Grow 1-2-5 style from the first major step.
  let base = major0;
  while (seq.length < 24) {
    for (const f of [2, 5, 10]) {
      const v = base * f;
      if (v > seq[seq.length - 1]) seq.push(v);
    }
    base *= 10;
  }
  for (let i = 0; i < seq.length - 1; i++) {
    if (seq[i] * scale >= minPx) {
      const minor = seq[i];
      // Major lines every 5 minors (or the next natural step when it divides evenly).
      const major = i === 0 ? major0 : nextMultiple(seq, i);
      return { minor, major };
    }
  }
  return { minor: seq[seq.length - 2], major: seq[seq.length - 1] };
}

function majorFor(g: number): number {
  // Metric-friendly: 1 m major for sub-metre grids that divide a metre, else 5 minors.
  if (g < 1000 && 1000 % g === 0 && 1000 / g <= 10) return 1000 / g >= 2 ? 1000 : g * 5;
  return g * 5;
}

function nextMultiple(seq: number[], i: number): number {
  for (let j = i + 1; j < seq.length; j++) if (seq[j] % seq[i] === 0 && seq[j] / seq[i] >= 4) return seq[j];
  return seq[i] * 5;
}

/** A "nice" scale-bar length (mm) close to `targetPx` on screen, with its subdivisions. */
export function scaleBar(scale: number, targetPx = 120): { length: number; divisions: number } {
  const target = targetPx / scale;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  let best = pow;
  for (const f of [1, 2, 5, 10]) if (pow * f <= target) best = pow * f;
  const lead = best / pow;
  return { length: best, divisions: lead === 2 ? 4 : lead === 5 ? 5 : lead === 1 || lead === 10 ? 5 : 4 };
}

/** Compact length label for scale bars / grid annotations: "500 mm", "2 m", "1 km". */
export function shortLength(mm: number): string {
  if (mm >= 1_000_000) return `${+(mm / 1_000_000).toFixed(2)} km`;
  if (mm >= 1000) return `${+(mm / 1000).toFixed(2)} m`;
  return `${+mm.toFixed(1)} mm`;
}
