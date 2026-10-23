/**
 * Stair layout in plan: treads, landings and walk line for straight / L / U / spiral stairs.
 * Shared by geometry (3D), drawing (plan symbols), plan editor, IFC export and 3D walk collision.
 *
 * Conventions: `position` is the centre of the bottom edge of the first tread; `rotation` is the
 * direction of travel going up. Treads = risers − 1 (the last riser lands on the floor above).
 */
import { add, angleDeg, dirFromDeg, dot, perp, scale, sub } from './math2d';
import type { Stair, Vec2 } from './types';

export interface StairStep {
  polygon: Vec2[];
  /** Top of the tread relative to the level elevation, mm. */
  top: number;
}

export interface StairLayout {
  rise: number;
  riserCount: number;
  riserHeight: number;
  treads: StairStep[];
  landings: StairStep[];
  /** Centre path from bottom to top (for the UP arrow). */
  walkline: Vec2[];
  /** Polygons covering the whole stair footprint (flights + landings). */
  footprint: Vec2[][];
  /** Straight runs of treads (straight / L / U stairs; empty for spirals), bottom to top. */
  flights?: StairFlight[];
}

/** One straight run of treads, rising from a floor or landing to the next landing or floor. */
export interface StairFlight {
  /** Centre of the bottom edge of the flight's first tread (plan, mm). */
  start: Vec2;
  /** Unit plan direction of travel going up. */
  direction: Vec2;
  width: number;
  /** Tread going (mm). */
  going: number;
  riserHeight: number;
  /** Top of the floor or landing the flight starts from, relative to the level elevation (mm). */
  base: number;
  /** Indices into `treads`, bottom to top. The flight ends with one more riser up to the next landing/floor. */
  treadIndices: number[];
}

export const SPIRAL_DEGREES_PER_TREAD = 27;
export const U_STAIR_GAP = 100;

export function stairRise(stair: Stair, levelHeight: number): number {
  return stair.rise ?? levelHeight;
}

export function computeStairLayout(stair: Stair, levelHeight: number): StairLayout {
  const rise = Math.max(1, stairRise(stair, levelHeight));
  const riserCount = Math.max(2, Math.ceil(rise / Math.max(50, stair.maxRiser)));
  const rh = rise / riserCount;
  const T = riserCount - 1;
  const f = dirFromDeg(stair.rotation);
  const s = perp(f);
  const w = stair.width;
  const g = stair.tread;
  const P = (fwd: number, lat: number): Vec2 => add(stair.position, add(scale(f, fwd), scale(s, lat)));
  const rect = (f0: number, f1: number, l0: number, l1: number): Vec2[] => [P(f0, l0), P(f1, l0), P(f1, l1), P(f0, l1)];
  const ccw = (poly: Vec2[]): Vec2[] => (area(poly) < 0 ? [...poly].reverse() : poly);

  const treads: StairStep[] = [];
  const landings: StairStep[] = [];
  const footprint: Vec2[][] = [];
  let walkline: Vec2[] = [];

  if (stair.shape === 'spiral') {
    const outer = w;
    const inner = Math.min(outer * 0.6, stair.innerRadius ?? 100);
    const center = stair.position;
    const sign = stair.turn === 'right' ? -1 : 1;
    const step = SPIRAL_DEGREES_PER_TREAD;
    const arcPts = (r: number, a0: number, a1: number, n: number): Vec2[] =>
      Array.from({ length: n + 1 }, (_, i) => add(center, scale(dirFromDeg(a0 + ((a1 - a0) * i) / n), r)));
    for (let i = 0; i < T; i++) {
      const a0 = stair.rotation + sign * i * step;
      const a1 = stair.rotation + sign * (i + 1) * step;
      const poly = [...arcPts(inner, a0, a1, 1), ...arcPts(outer, a1, a0, 4)];
      treads.push({ polygon: ccw(poly), top: (i + 1) * rh });
    }
    const rw = (inner + outer) / 2;
    walkline = arcPts(rw, stair.rotation, stair.rotation + sign * T * step, Math.max(2, T * 2));
    footprint.push(ccw(arcPts(outer, 0, 360, 48).slice(0, 48)));
    return { rise, riserCount, riserHeight: rh, treads, landings, walkline, footprint, flights: [] };
  }

  const flight = (start: Vec2, direction: Vec2, base: number, treadIndices: number[]): StairFlight => ({
    start,
    direction,
    width: w,
    going: g,
    riserHeight: rh,
    base,
    treadIndices,
  });

  if (stair.shape === 'straight' || T < 3) {
    for (let i = 0; i < T; i++) treads.push({ polygon: ccw(rect(i * g, (i + 1) * g, -w / 2, w / 2)), top: (i + 1) * rh });
    footprint.push(ccw(rect(0, Math.max(g, T * g), -w / 2, w / 2)));
    walkline = [P(0, 0), P(T * g, 0)];
    const flights = [flight(P(0, 0), f, 0, range(0, T))];
    return { rise, riserCount, riserHeight: rh, treads, landings, walkline, footprint, flights };
  }

  if (stair.shape === 'open-well' && T >= 5) {
    // Three flights around an open well, with a corner landing at each turn (each counts as a tread level).
    const n = T - 2;
    const a = clampInt(stair.firstFlightTreads ?? Math.ceil(n / 3), 1, n - 2);
    const b = clampInt(stair.secondFlightTreads ?? Math.ceil((n - a) / 2), 1, n - a - 1);
    const c = n - a - b;
    const side = stair.turn === 'left' ? 1 : -1;
    const run1 = a * g;
    for (let i = 0; i < a; i++) treads.push({ polygon: ccw(rect(i * g, (i + 1) * g, -w / 2, w / 2)), top: (i + 1) * rh });
    footprint.push(ccw(rect(0, run1, -w / 2, w / 2)));
    const flights = [flight(P(0, 0), f, 0, range(0, a))];
    // First corner landing, then flight 2 across the head of the well (sideways, towards `side`).
    const land1Top = (a + 1) * rh;
    const landing1 = ccw(rect(run1, run1 + w, -w / 2, w / 2));
    landings.push({ polygon: landing1, top: land1Top });
    footprint.push(landing1);
    const lat0 = (side * w) / 2;
    for (let i = 0; i < b; i++) {
      const l0 = lat0 + side * i * g;
      const l1 = lat0 + side * (i + 1) * g;
      treads.push({ polygon: ccw(rect(run1, run1 + w, Math.min(l0, l1), Math.max(l0, l1))), top: land1Top + (i + 1) * rh });
    }
    const latB = lat0 + side * b * g;
    footprint.push(ccw(rect(run1, run1 + w, Math.min(lat0, latB), Math.max(lat0, latB))));
    flights.push(flight(P(run1 + w / 2, lat0), scale(s, side), land1Top, range(a, a + b)));
    // Second corner landing, then flight 3 back along the far side of the well.
    const land2Top = land1Top + (b + 1) * rh;
    const latC = latB + side * w;
    const landing2 = ccw(rect(run1, run1 + w, Math.min(latB, latC), Math.max(latB, latC)));
    landings.push({ polygon: landing2, top: land2Top });
    footprint.push(landing2);
    const off = side * (w + b * g);
    for (let i = 0; i < c; i++) treads.push({ polygon: ccw(rect(run1 - (i + 1) * g, run1 - i * g, off - w / 2, off + w / 2)), top: land2Top + (i + 1) * rh });
    footprint.push(ccw(rect(run1 - c * g, run1, off - w / 2, off + w / 2)));
    flights.push(flight(P(run1, off), scale(f, -1), land2Top, range(a + b, a + b + c)));
    walkline = [P(0, 0), P(run1 + w / 2, 0), P(run1 + w / 2, off), P(run1 - c * g, off)];
    return { rise, riserCount, riserHeight: rh, treads, landings, walkline, footprint, flights };
  }

  // Two flights with a landing that counts as one tread level.
  const t1 = clampInt(stair.firstFlightTreads ?? Math.ceil((T - 1) / 2), 1, T - 2);
  const t2 = T - 1 - t1;
  const landTop = (t1 + 1) * rh;
  const side = stair.turn === 'left' ? 1 : -1;
  for (let i = 0; i < t1; i++) treads.push({ polygon: ccw(rect(i * g, (i + 1) * g, -w / 2, w / 2)), top: (i + 1) * rh });
  const run1 = t1 * g;
  footprint.push(ccw(rect(0, Math.max(run1, 1), -w / 2, w / 2)));
  const flights = [flight(P(0, 0), f, 0, range(0, t1))];

  if (stair.shape === 'l-shape') {
    const landing = ccw(rect(run1, run1 + w, -w / 2, w / 2));
    landings.push({ polygon: landing, top: landTop });
    footprint.push(landing);
    // Flight 2 runs sideways (towards `side`), spanning forward run1..run1+w.
    const lat0 = (side * w) / 2;
    for (let i = 0; i < t2; i++) {
      const a = lat0 + side * i * g;
      const b = lat0 + side * (i + 1) * g;
      treads.push({ polygon: ccw(rect(run1, run1 + w, Math.min(a, b), Math.max(a, b))), top: landTop + (i + 1) * rh });
    }
    const end = lat0 + side * t2 * g;
    footprint.push(ccw(rect(run1, run1 + w, Math.min(lat0, end), Math.max(lat0, end))));
    walkline = [P(0, 0), P(run1 + w / 2, 0), P(run1 + w / 2, end)];
    flights.push(flight(P(run1 + w / 2, lat0), scale(s, side), landTop, range(t1, t1 + t2)));
  } else {
    // U-shape: flight 2 returns alongside flight 1.
    const off = side * (w + U_STAIR_GAP);
    const l0 = Math.min(-w / 2, off - w / 2);
    const l1 = Math.max(w / 2, off + w / 2);
    const landing = ccw(rect(run1, run1 + w, l0, l1));
    landings.push({ polygon: landing, top: landTop });
    footprint.push(landing);
    for (let i = 0; i < t2; i++) {
      const a = run1 - i * g;
      const b = run1 - (i + 1) * g;
      treads.push({ polygon: ccw(rect(b, a, off - w / 2, off + w / 2)), top: landTop + (i + 1) * rh });
    }
    footprint.push(ccw(rect(run1 - t2 * g, Math.max(run1, run1 - t2 * g + 1), off - w / 2, off + w / 2)));
    walkline = [P(0, 0), P(run1 + w / 2, 0), P(run1 + w / 2, off), P(run1 - t2 * g, off)];
    flights.push(flight(P(run1, off), scale(f, -1), landTop, range(t1, t1 + t2)));
  }
  return { rise, riserCount, riserHeight: rh, treads, landings, walkline, footprint, flights };
}

/**
 * Mirror image of a stair (left ↔ right), in place: the footprint keeps its position, L/U stairs turn
 * the other way, spirals wind the other way from the same first step, one-sided handrails swap.
 */
export function mirrorStair(stair: Stair, levelHeight: number): Stair {
  const out: Stair = { ...stair, turn: stair.turn === 'left' ? 'right' : 'left', ...swappedRails(stair) };
  if (stair.shape === 'spiral') return out;
  // Reflect across the footprint's centre line along the direction of travel: lateral l → l0 + l1 − l.
  const s = perp(dirFromDeg(stair.rotation));
  let l0 = Infinity;
  let l1 = -Infinity;
  for (const poly of computeStairLayout(stair, levelHeight).footprint)
    for (const p of poly) {
      const l = dot(sub(p, stair.position), s);
      l0 = Math.min(l0, l);
      l1 = Math.max(l1, l);
    }
  return { ...out, position: roundPoint(add(stair.position, scale(s, l0 + l1))) };
}

/**
 * The same stair walked the other way (up ↔ down), in place: the top becomes the foot, L/U stairs
 * keep their landing (the flights swap lengths), spirals start from the old top step.
 */
export function reverseStair(stair: Stair, levelHeight: number): Stair {
  const layout = computeStairLayout(stair, levelHeight);
  const rails = swappedRails(stair);
  if (stair.shape === 'spiral') {
    const sign = stair.turn === 'right' ? -1 : 1;
    const rotation = normDeg(stair.rotation + sign * layout.treads.length * SPIRAL_DEGREES_PER_TREAD);
    return { ...stair, ...rails, rotation, turn: stair.turn === 'left' ? 'right' : 'left' };
  }
  const flights = layout.flights ?? [];
  const last = flights[flights.length - 1];
  if (!last) return stair;
  const position = roundPoint(add(last.start, scale(last.direction, last.treadIndices.length * last.going)));
  const rotation = normDeg(angleDeg(scale(last.direction, -1)));
  if (flights.length === 1) return { ...stair, ...rails, position, rotation };
  // The flights are walked in reverse order: the old last flight comes first (open-well keeps its middle flight).
  return {
    ...stair,
    ...rails,
    position,
    rotation,
    turn: stair.turn === 'left' ? 'right' : 'left',
    firstFlightTreads: last.treadIndices.length,
    ...(flights.length === 3 ? { secondFlightTreads: flights[1].treadIndices.length } : {}),
  };
}

/** A one-sided handrail (`props.handrail` 'left' / 'right') on the other side; {} when unchanged. */
function swappedRails(stair: Stair): Partial<Stair> {
  const side = stair.props?.handrail;
  if (side !== 'left' && side !== 'right') return {};
  return { props: { ...stair.props, handrail: side === 'left' ? 'right' : 'left' } };
}

const normDeg = (d: number): number => {
  const r = Math.round((((d % 360) + 360) % 360) * 1e6) / 1e6;
  return r === 360 ? 0 : r;
};

const clampInt = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(v)));

const roundPoint = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

function range(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
}

function area(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
