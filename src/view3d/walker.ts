/**
 * First-person walking physics (pure, renderer-agnostic), tuned to feel like Minecraft: gravity,
 * jumping about 1.25 m high, sliding collision against obstacles, step-up onto surfaces up to
 * STEP_UP high (so stairs can be climbed) and sneaking that never walks off an edge.
 * World units: metres, Y up. `y` is the FEET height; the eye is EYE_HEIGHT above it.
 */

export const EYE_HEIGHT = 1.62;
/** Eye height while sneaking (Shift). */
export const SNEAK_EYE_HEIGHT = 1.27;
export const STEP_UP = 0.4;
export const BODY_RADIUS = 0.3;
export const BODY_HEIGHT = 1.8;
export const GRAVITY = 32;
/** √(2 g h) for a ~1.25 m jump. */
export const JUMP_SPEED = 8.9;
export const MAX_FALL_SPEED = 50;

export interface WalkProbe {
  /** Highest walkable surface at (x, z) at or below `fromY` (world Y, m), or null. */
  groundAt(x: number, z: number, fromY: number): number | null;
  /** Distance to the first obstacle from (x, y, z) along horizontal unit (dx, dz), up to `maxDist`, or null. */
  obstacle(x: number, y: number, z: number, dx: number, dz: number, maxDist: number): number | null;
}

export interface WalkState {
  x: number;
  /** Feet height. */
  y: number;
  z: number;
  vy: number;
  onGround: boolean;
}

/** Probe heights above the feet used for horizontal collision (all above the step-up height). */
const PROBE_HEIGHTS = [STEP_UP + 0.05, 0.95, 1.5];

/** How far the body can move from (x, y, z) along unit (dx, dz) before touching an obstacle. */
function freeDistance(s: WalkState, dx: number, dz: number, want: number, probe: WalkProbe): number {
  let allowed = want;
  for (const h of PROBE_HEIGHTS) {
    const d = probe.obstacle(s.x, s.y + h, s.z, dx, dz, want + BODY_RADIUS);
    if (d !== null) allowed = Math.min(allowed, Math.max(0, d - BODY_RADIUS));
  }
  return allowed;
}

/**
 * Advance the walker by one frame. `move` is the desired horizontal displacement (m) for this
 * frame; movement slides along obstacles axis by axis.
 */
export function walkStep(s: WalkState, move: { dx: number; dz: number }, dt: number, probe: WalkProbe, jump = false, sneak = false): WalkState {
  const next: WalkState = { ...s };
  // Horizontal: try X then Z so the body slides along walls.
  for (const axis of ['x', 'z'] as const) {
    const m = axis === 'x' ? move.dx : move.dz;
    if (Math.abs(m) < 1e-9) continue;
    const dir = Math.sign(m);
    const free = freeDistance(next, axis === 'x' ? dir : 0, axis === 'z' ? dir : 0, Math.abs(m), probe);
    const nx = axis === 'x' ? next.x + dir * free : next.x;
    const nz = axis === 'z' ? next.z + dir * free : next.z;
    // Sneaking on the ground never steps off an edge (a drop deeper than a step).
    if (sneak && s.onGround) {
      const g = probe.groundAt(nx, nz, next.y + STEP_UP);
      if (g === null || g < next.y - STEP_UP) continue;
    }
    next.x = nx;
    next.z = nz;
  }
  // Vertical.
  const ground = probe.groundAt(next.x, next.z, next.y + STEP_UP);
  if (jump && next.onGround) {
    next.vy = JUMP_SPEED;
    next.onGround = false;
  }
  if (next.onGround && next.vy <= 0 && ground !== null && ground >= next.y - STEP_UP && ground <= next.y + STEP_UP) {
    // Walk up steps / down small drops without leaving the ground.
    next.y = ground;
    next.vy = 0;
    return next;
  }
  next.vy = Math.max(-MAX_FALL_SPEED, next.vy - GRAVITY * dt);
  next.y += next.vy * dt;
  if (next.vy <= 0 && ground !== null && next.y <= ground) {
    next.y = ground;
    next.vy = 0;
    next.onGround = true;
  } else {
    next.onGround = false;
  }
  return next;
}
