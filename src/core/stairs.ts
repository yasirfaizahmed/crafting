/**
 * Stair layout in plan: treads, landings and walk line. Shared by geometry (3D), drawing (plan
 * symbols), plan editor, IFC export and 3D walk collision.
 *
 * A stair is a chain of straight flights joined by landings (`StairRuns`): each flight has its own
 * tread count, going and width; each landing its own turn (straight / quarter / half), depth, well
 * gap and extra platform on either side (and past the next flight on quarter turns). The `shape` presets (straight, L, U, open-well) are just generators of such a chain;
 * `stair.runs` overrides them with a fully custom one. Spirals are laid out separately.
 *
 * Conventions: `position` is the centre of the bottom edge of the first tread; `rotation` is the
 * direction of travel going up. A flight of n treads has n + 1 risers: its last riser lands on the
 * next landing or the floor above, so all risers are equal: riser height = rise / Σ(treads + 1).
 */
import { add, angleDeg, dirFromDeg, dot, perp, scale, sub } from './math2d';
import type { Stair, StairFlightSpec, StairLandingSpec, StairRuns, Vec2 } from './types';

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
  /** Straight runs of treads (empty for spirals), bottom to top. */
  flights?: StairFlight[];
  /** The resolved flights and landings this layout was built from (undefined for spirals). */
  runs?: ResolvedRuns;
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

/** Flights and landings with every default filled in. */
export interface ResolvedRuns {
  flights: Required<StairFlightSpec>[];
  landings: Required<StairLandingSpec>[];
}

export const SPIRAL_DEGREES_PER_TREAD = 27;
export const U_STAIR_GAP = 100;

export function stairRise(stair: Stair, levelHeight: number): number {
  return stair.rise ?? levelHeight;
}

/** Risers of a preset stair: enough to keep each one under `maxRiser`. */
function presetRiserCount(stair: Stair, rise: number): number {
  return Math.max(2, Math.ceil(rise / Math.max(50, stair.maxRiser)));
}

/**
 * The flights and landings a stair is made of: `stair.runs` when customised, otherwise the ones its
 * `shape` preset generates. Spirals return null.
 */
export function resolveStairRuns(stair: Stair, levelHeight: number): ResolvedRuns | null {
  if (stair.shape === 'spiral' && !stair.runs) return null;
  const w = stair.width;
  const g = stair.tread;
  if (stair.runs?.flights.length) {
    const flights = stair.runs.flights.map((f) => ({
      treads: Math.max(0, Math.round(f.treads)),
      going: f.going ?? g,
      width: f.width ?? w,
    }));
    const landings = flights.slice(1).map((_, i) => resolveLanding(stair.runs!.landings[i] ?? { turn: 'none' }, flights[i].width, flights[i + 1].width));
    return { flights, landings };
  }
  const T = presetRiserCount(stair, Math.max(1, stairRise(stair, levelHeight))) - 1;
  const fl = (treads: number) => ({ treads, going: g, width: w });
  if (stair.shape === 'straight' || T < 3) return { flights: [fl(T)], landings: [] };
  if (stair.shape === 'open-well' && T >= 5) {
    const n = T - 2;
    const a = clampInt(stair.firstFlightTreads ?? Math.ceil(n / 3), 1, n - 2);
    const b = clampInt(stair.secondFlightTreads ?? Math.ceil((n - a) / 2), 1, n - a - 1);
    const quarter = resolveLanding({ turn: stair.turn, angle: 90 }, w, w);
    return { flights: [fl(a), fl(b), fl(n - a - b)], landings: [quarter, { ...quarter }] };
  }
  const t1 = clampInt(stair.firstFlightTreads ?? Math.ceil((T - 1) / 2), 1, T - 2);
  const angle = stair.shape === 'l-shape' ? 90 : 180;
  return { flights: [fl(t1), fl(T - 1 - t1)], landings: [resolveLanding({ turn: stair.turn, angle, gap: U_STAIR_GAP }, w, w)] };
}

function resolveLanding(l: StairLandingSpec, wIn: number, wOut: number): Required<StairLandingSpec> {
  const angle = l.angle === 180 ? 180 : 90;
  const beyond = l.turn !== 'none' && angle === 90 ? Math.max(0, l.beyond ?? 0) : 0;
  const auto = l.turn === 'none' ? wIn : angle === 90 ? wOut + beyond : Math.max(wIn, wOut);
  return {
    turn: l.turn,
    angle,
    depth: Math.max(1, l.depth ?? auto),
    gap: Math.max(0, l.gap ?? U_STAIR_GAP),
    extendLeft: Math.max(0, l.extendLeft ?? 0),
    extendRight: Math.max(0, l.extendRight ?? 0),
    beyond,
  };
}

/**
 * A landing in the frame of the flight arriving on it: `f` along that flight from its top riser,
 * `l` to its left. The platform is the rectangle f ∈ [0, depth] × l ∈ [right, left]; the next
 * flight's first riser is centred on `next` and it climbs towards `nextDir`.
 */
export interface LandingFrame {
  depth: number;
  /** Lateral edges: right (≤ 0) and left (≥ 0). */
  right: number;
  left: number;
  next: { f: number; l: number };
  nextDir: { f: number; l: number };
}

export function landingFrame(l: Required<StairLandingSpec>, wIn: number, wOut: number): LandingFrame {
  const ext = (side: number) => (side > 0 ? l.extendLeft : l.extendRight);
  if (l.turn === 'none') {
    const h = Math.max(wIn, wOut) / 2;
    return { depth: l.depth, right: -(h + l.extendRight), left: h + l.extendLeft, next: { f: l.depth, l: 0 }, nextDir: { f: 1, l: 0 } };
  }
  const s = l.turn === 'left' ? 1 : -1;
  const edges = (turnSide: number, otherSide: number) => (s > 0 ? { left: turnSide, right: -otherSide } : { left: otherSide, right: -turnSide });
  if (l.angle === 90) {
    // As wide as the arriving flight (plus extras); the next flight leaves from the turn-side edge,
    // its far side `beyond` short of the far edge.
    const out = wIn / 2 + ext(s);
    return { depth: l.depth, ...edges(out, wIn / 2 + ext(-s)), next: { f: l.depth - l.beyond - wOut / 2, l: s * out }, nextDir: { f: 0, l: s } };
  }
  // Half turn: the next flight comes back alongside, beyond the well.
  const off = s * (wIn / 2 + l.gap + wOut / 2);
  return { depth: l.depth, ...edges(Math.abs(off) + wOut / 2 + ext(s), wIn / 2 + ext(-s)), next: { f: 0, l: off }, nextDir: { f: -1, l: 0 } };
}

/** Explicit runs for a stair (customised copy of its preset), ready to edit. Spirals: null. */
export function editableRuns(stair: Stair, levelHeight: number): StairRuns | null {
  const r = resolveStairRuns(stair, levelHeight);
  if (!r) return null;
  if (stair.runs) return structuredClone(stair.runs);
  return {
    flights: r.flights.map((f) => ({ treads: f.treads })),
    landings: r.landings.map((l) => ({ turn: l.turn, angle: l.angle, ...(l.angle === 180 ? { gap: l.gap } : {}) })),
  };
}

export function computeStairLayout(stair: Stair, levelHeight: number): StairLayout {
  const rise = Math.max(1, stairRise(stair, levelHeight));
  const runs = resolveStairRuns(stair, levelHeight);
  if (!runs) return spiralLayout(stair, rise);

  const riserCount = Math.max(1, runs.flights.reduce((s, f) => s + f.treads + 1, 0));
  const rh = rise / riserCount;
  const treads: StairStep[] = [];
  const landings: StairStep[] = [];
  const footprint: Vec2[][] = [];
  const flights: StairFlight[] = [];
  const walk: Vec2[] = [];

  let start = stair.position;
  let dir = dirFromDeg(stair.rotation);
  let base = 0;
  runs.flights.forEach((spec, i) => {
    const side = perp(dir);
    const { treads: n, going: g, width: w } = spec;
    // Point at `f` along the flight and `l` to its left.
    const at = (f: number, l: number): Vec2 => add(start, add(scale(dir, f), scale(side, l)));
    const rect = (f0: number, f1: number, l0: number, l1: number) => ccw([at(f0, l0), at(f1, l0), at(f1, l1), at(f0, l1)]);
    const first = treads.length;
    for (let k = 0; k < n; k++) treads.push({ polygon: rect(k * g, (k + 1) * g, -w / 2, w / 2), top: base + (k + 1) * rh });
    if (n > 0) footprint.push(rect(0, n * g, -w / 2, w / 2));
    flights.push({ start, direction: dir, width: w, going: g, riserHeight: rh, base, treadIndices: range(first, first + n) });
    walk.push(start, at(n * g, 0));
    base += (n + 1) * rh;

    const landing = runs.landings[i];
    if (!landing) return;
    const fr = landingFrame(landing, w, runs.flights[i + 1].width);
    const f0 = n * g;
    const poly = rect(f0, f0 + fr.depth, fr.right, fr.left);
    if (landing.turn !== 'none' && landing.angle === 90) walk.push(at(f0 + fr.next.f, 0));
    else if (landing.turn !== 'none') walk.push(at(f0 + fr.depth / 2, 0), at(f0 + fr.depth / 2, fr.next.l));
    start = at(f0 + fr.next.f, fr.next.l);
    dir = add(scale(dir, fr.nextDir.f), scale(side, fr.nextDir.l));
    landings.push({ polygon: poly, top: base });
    footprint.push(poly);
  });

  return { rise, riserCount, riserHeight: rh, treads, landings, walkline: simplifyPath(walk), footprint, flights, runs };
}

function spiralLayout(stair: Stair, rise: number): StairLayout {
  const riserCount = presetRiserCount(stair, rise);
  const rh = rise / riserCount;
  const T = riserCount - 1;
  const outer = stair.width;
  const inner = Math.min(outer * 0.6, stair.innerRadius ?? 100);
  const center = stair.position;
  const sign = stair.turn === 'right' ? -1 : 1;
  const step = SPIRAL_DEGREES_PER_TREAD;
  const arcPts = (r: number, a0: number, a1: number, n: number): Vec2[] =>
    Array.from({ length: n + 1 }, (_, i) => add(center, scale(dirFromDeg(a0 + ((a1 - a0) * i) / n), r)));
  const treads: StairStep[] = [];
  for (let i = 0; i < T; i++) {
    const a0 = stair.rotation + sign * i * step;
    const a1 = stair.rotation + sign * (i + 1) * step;
    treads.push({ polygon: ccw([...arcPts(inner, a0, a1, 1), ...arcPts(outer, a1, a0, 4)]), top: (i + 1) * rh });
  }
  const walkline = arcPts((inner + outer) / 2, stair.rotation, stair.rotation + sign * T * step, Math.max(2, T * 2));
  const footprint = [ccw(arcPts(outer, 0, 360, 48).slice(0, 48))];
  return { rise, riserCount, riserHeight: rh, treads, landings: [], walkline, footprint, flights: [] };
}

// -----------------------------------------------------------------------------
// Editing helpers
// -----------------------------------------------------------------------------

/**
 * Mirror image of a stair (left ↔ right), in place: the footprint keeps its position, every turn goes
 * the other way, spirals wind the other way from the same first step, one-sided handrails swap.
 */
export function mirrorStair(stair: Stair, levelHeight: number): Stair {
  const out: Stair = { ...stair, turn: otherSide(stair.turn), ...swappedRails(stair) };
  if (stair.runs) out.runs = { ...stair.runs, landings: stair.runs.landings.map((l) => ({ ...swapSides(l), turn: flipTurn(l.turn) })) };
  if (stair.shape === 'spiral' && !stair.runs) return out;
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
 * The same stair walked the other way (up ↔ down), in place: the top becomes the foot, flights and
 * landings are walked in reverse order (each turn going the other way), spirals start from the top.
 */
export function reverseStair(stair: Stair, levelHeight: number): Stair {
  const layout = computeStairLayout(stair, levelHeight);
  const rails = swappedRails(stair);
  if (stair.shape === 'spiral' && !stair.runs) {
    const sign = stair.turn === 'right' ? -1 : 1;
    const rotation = normDeg(stair.rotation + sign * layout.treads.length * SPIRAL_DEGREES_PER_TREAD);
    return { ...stair, ...rails, rotation, turn: otherSide(stair.turn) };
  }
  const flights = layout.flights ?? [];
  const last = flights[flights.length - 1];
  if (!last) return stair;
  const position = roundPoint(add(last.start, scale(last.direction, last.treadIndices.length * last.going)));
  const rotation = normDeg(angleDeg(scale(last.direction, -1)));
  if (stair.runs && layout.runs) {
    const n = stair.runs.flights.length;
    const { flights: rf, landings: rl } = layout.runs;
    const runs: StairRuns = {
      flights: [...stair.runs.flights].reverse(),
      landings: stair.runs.landings
        .slice(0, n - 1)
        .map((l, j) => reverseLanding(l, rl[j], rf[j].width, rf[j + 1].width))
        .reverse(),
    };
    return { ...stair, ...rails, position, rotation, turn: otherSide(stair.turn), runs };
  }
  if (flights.length === 1) return { ...stair, ...rails, position, rotation };
  // The flights are walked in reverse order: the old last flight comes first (open-well keeps its middle flight).
  return {
    ...stair,
    ...rails,
    position,
    rotation,
    turn: otherSide(stair.turn),
    firstFlightTreads: last.treadIndices.length,
    ...(flights.length === 3 ? { secondFlightTreads: flights[1].treadIndices.length } : {}),
  };
}

/** A landing's left and right extras swapped (only the ones that are set). */
function swapSides(l: StairLandingSpec): StairLandingSpec {
  const { extendLeft, extendRight, ...rest } = l;
  return { ...rest, ...(extendRight !== undefined ? { extendLeft: extendRight } : {}), ...(extendLeft !== undefined ? { extendRight: extendLeft } : {}) };
}

/**
 * The same landing walked the other way: `wIn` / `wOut` are the widths of the flights arriving on /
 * leaving it going up. Straight landings swap sides; half turns keep theirs (the frame faces the
 * same way); a quarter turn's frame turns 90°, so depth, extras and `beyond` trade places.
 */
function reverseLanding(spec: StairLandingSpec, r: Required<StairLandingSpec>, wIn: number, wOut: number): StairLandingSpec {
  const turn = flipTurn(spec.turn);
  if (spec.turn === 'none') return { ...swapSides(spec), turn };
  if (r.angle === 180) return { ...spec, turn };
  if (spec.depth === undefined && !spec.extendLeft && !spec.extendRight && !spec.beyond) return { ...spec, turn };
  const s = spec.turn === 'left' ? 1 : -1;
  const turnSide = s > 0 ? r.extendLeft : r.extendRight;
  const outer = s > 0 ? r.extendRight : r.extendLeft;
  // Walking down, the new turn side is the old back edge, the new outer side the old far edge.
  const newTurnSide = Math.max(0, Math.round((r.depth - r.beyond - wOut) * 1000) / 1000);
  const { extendLeft: _l, extendRight: _r, beyond: _b, depth: _d, ...rest } = spec;
  const out: StairLandingSpec = { ...rest, turn, depth: wIn + turnSide + outer };
  const [left, right] = turn === 'left' ? [newTurnSide, r.beyond] : [r.beyond, newTurnSide];
  if (left) out.extendLeft = left;
  if (right) out.extendRight = right;
  if (outer) out.beyond = outer;
  return out;
}

/** Handrail sides after a mirror or reversal (left ↔ right); {} when unchanged. */
function swappedRails(stair: Stair): Partial<Stair> {
  const out: Partial<Stair> = {};
  if (stair.handrails === 'left' || stair.handrails === 'right') out.handrails = otherSide(stair.handrails);
  const side = stair.props?.handrail;
  if (side === 'left' || side === 'right') out.props = { ...stair.props, handrail: otherSide(side) };
  return out;
}

// -----------------------------------------------------------------------------
// Building-code checks
// -----------------------------------------------------------------------------

export interface StairCheck {
  label: string;
  value: string;
  ok: boolean;
  /** Short rule of thumb shown as a tooltip. */
  rule: string;
}

/**
 * Common residential stair rules (IRC / UK Approved Document K / Blondel) as advisory checks:
 * riser height, going, 2R + G, width, risers per flight and landing depth.
 */
export function stairChecks(stair: Stair, levelHeight: number): StairCheck[] {
  const l = computeStairLayout(stair, levelHeight);
  const r = l.riserHeight;
  const checks: StairCheck[] = [
    { label: 'Riser height', value: `${r.toFixed(1)} mm`, ok: r >= 100 && r <= Math.max(100, stair.maxRiser) + 0.05, rule: `100 – ${stair.maxRiser} mm (your max riser setting)` },
  ];
  if (!l.runs) return checks;
  const { flights, landings } = l.runs;
  const goings = flights.map((f) => f.going);
  const gMin = Math.min(...goings);
  checks.push({ label: 'Going', value: `${Math.round(gMin)} mm`, ok: gMin >= 250, rule: '≥ 250 mm (IRC 254 mm, UK private 220 mm)' });
  const strides = goings.map((g) => 2 * r + g);
  const worst = strides.reduce((a, b) => (Math.abs(b - 625) > Math.abs(a - 625) ? b : a), strides[0]);
  checks.push({ label: '2R + G', value: `${Math.round(worst)} mm`, ok: worst >= 550 && worst <= 700, rule: '550 – 700 mm, ideally 600 – 650 (a comfortable stride)' });
  const wMin = Math.min(...flights.map((f) => f.width));
  checks.push({ label: 'Width', value: `${Math.round(wMin)} mm`, ok: wMin >= 860, rule: '≥ 860 mm clear (IRC 36", UK 800 – 900 mm)' });
  const maxRisers = Math.max(...flights.map((f) => f.treads + 1));
  checks.push({ label: 'Risers per flight', value: String(maxRisers), ok: maxRisers <= 16, rule: '≤ 16 risers between landings (UK); add a landing for long runs' });
  if (landings.length) {
    const short = landings.some((ld, i) => ld.depth < Math.min(flights[i].width, 1200) - 0.5);
    checks.push({ label: 'Landing depth', value: short ? 'Too short' : 'OK', ok: !short, rule: 'At least the stair width (1200 mm is always enough)' });
  }
  return checks;
}

// -----------------------------------------------------------------------------

function otherSide(s: 'left' | 'right'): 'left' | 'right' {
  return s === 'left' ? 'right' : 'left';
}

function flipTurn(t: StairLandingSpec['turn']): StairLandingSpec['turn'] {
  return t === 'none' ? 'none' : otherSide(t);
}

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

const ccw = (poly: Vec2[]): Vec2[] => (area(poly) < 0 ? [...poly].reverse() : poly);

/** Drop repeated and collinear interior points of a polyline. */
function simplifyPath(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1e-6) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const cross = (last.x - a.x) * (p.y - a.y) - (last.y - a.y) * (p.x - a.x);
      const fwd = (last.x - a.x) * (p.x - last.x) + (last.y - a.y) * (p.y - last.y);
      if (Math.abs(cross) < 1e-6 && fwd >= 0) out[out.length - 1] = p;
      else out.push(p);
    } else out.push(p);
  }
  return out;
}

const clampInt = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(v)));

const normDeg = (d: number): number => {
  const r = Math.round((((d % 360) + 360) % 360) * 1e6) / 1e6;
  return r === 360 ? 0 : r;
};

const roundPoint = (p: Vec2): Vec2 => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });
