/**
 * Camera modes for the 3D builder:
 *  - ORBIT: OrbitControls with RIGHT-drag orbit, MIDDLE-drag (or Shift+RIGHT) pan, wheel zoom.
 *    LMB stays free for clicks. WASD glides the orbit target.
 *  - FLY: first person (pointer lock driven by the viewport). WASD move, Space up, Shift down,
 *    Ctrl sprint; double-tap Space toggles flying ⇄ walking (gravity + collision, see walker.ts).
 * Includes eased camera transitions (frame / reset / top view).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { M_TO_MM } from '../core/coords';
import type { CameraMode } from '../app/state';
import type { PlayerView } from './tools/types';
import { EYE_HEIGHT, walkStep, type WalkProbe, type WalkState } from './walker';

export const FLY_SPEED = 7;
export const FLY_SPRINT = 18;
export const WALK_SPEED = 4.3;
export const WALK_SPRINT = 6.8;
export const LOOK_SENSITIVITY = 0.0023;
export const DOUBLE_TAP_MS = 300;

interface Tween {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
}

const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export interface CameraHost {
  probe: WalkProbe;
  /** Distance (m) to whatever is under the screen centre, used when leaving fly mode. */
  centerDistance?: () => number | null;
}

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  mode: CameraMode = 'orbit';
  /** Fly sub-mode: true = flying, false = walking with gravity. */
  flying = true;
  private yaw = 0;
  private pitch = 0;
  private readonly vel = new THREE.Vector3();
  private walk: WalkState | null = null;
  private readonly keys = new Set<string>();
  private tween: Tween | null = null;
  private lastSpace = 0;
  private jumpQueued = false;
  // Scratch objects (no per-frame allocations).
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  /** Called when walking/flying toggles. */
  onFlyingChange?: (flying: boolean) => void;

  constructor(
    dom: HTMLElement,
    private readonly host: CameraHost,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 3000);
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(22, 14, 18);
    this.orbit = new OrbitControls(this.camera, dom);
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.14;
    this.orbit.zoomToCursor = true;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 0.6;
    this.orbit.maxDistance = 900;
    this.orbit.maxPolarAngle = Math.PI * 0.497;
    this.orbit.rotateSpeed = 0.8;
    this.orbit.target.set(6, 2, -4);
    this.orbit.update();
  }

  setAspect(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.tween = null;
    if (mode === 'fly') {
      const dir = this.camera.getWorldDirection(this.v1);
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      this.orbit.enabled = false;
      this.vel.set(0, 0, 0);
      this.applyLook();
      if (!this.flying) this.startWalking();
    } else {
      const dir = this.camera.getWorldDirection(this.v1);
      const dist = THREE.MathUtils.clamp(this.host.centerDistance?.() ?? 10, 1.5, 60);
      this.orbit.target.copy(this.camera.position).addScaledVector(dir, dist);
      this.orbit.enabled = true;
      this.walk = null;
      this.orbit.update();
    }
    this.mode = mode;
    this.keys.clear();
  }

  /** Toggle flying ⇄ walking (fly mode only). */
  toggleFlying(): void {
    this.flying = !this.flying;
    if (this.flying) this.walk = null;
    else this.startWalking();
    this.onFlyingChange?.(this.flying);
  }

  private startWalking(): void {
    const p = this.camera.position;
    this.walk = { x: p.x, y: p.y - EYE_HEIGHT, z: p.z, vy: 0, onGround: false };
  }

  /** Returns true when the key drives the camera (so the caller can consume it). */
  keyDown(code: string, repeat = false, time = performance.now()): boolean {
    const movement = MOVE_CODES.has(code);
    if (!movement) return false;
    if (this.mode === 'fly' && code === 'Space' && !repeat) {
      // Event timestamps keep double-taps reliable even when frames are slow.
      const now = time;
      if (now - this.lastSpace < DOUBLE_TAP_MS) {
        this.lastSpace = 0;
        this.toggleFlying();
      } else {
        this.lastSpace = now;
        if (!this.flying) this.jumpQueued = true;
      }
    }
    this.keys.add(code);
    return this.mode === 'fly' || ORBIT_CODES.has(code);
  }

  keyUp(code: string): void {
    this.keys.delete(code);
  }

  releaseKeys(): void {
    this.keys.clear();
  }

  /** True while the camera may still move without new input (keys held, inertia, tween, falling). */
  get moving(): boolean {
    if (this.tween) return true;
    if (this.mode === 'orbit') {
      for (const c of ORBIT_CODES) if (this.keys.has(c)) return true;
      return false;
    }
    return this.keys.size > 0 || this.vel.lengthSq() > 1e-6 || (!!this.walk && !this.walk.onGround);
  }

  /** Mouse look in fly mode (pixel deltas). */
  look(dx: number, dy: number): void {
    if (this.mode !== 'fly') return;
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SENSITIVITY, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.applyLook();
  }

  private applyLook(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  /** Advance one frame. Returns true when the camera moved. */
  update(dt: number): boolean {
    const d = Math.min(dt, 0.1);
    if (this.tween) return this.updateTween(d);
    if (this.mode === 'orbit') {
      let moved = false;
      if (this.keys.size) moved = this.glideOrbit(d);
      return this.orbit.update(d) || moved;
    }
    return this.updateFly(d);
  }

  private has(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  private inputVector(out: THREE.Vector3): THREE.Vector3 {
    const f = (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    const r = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // Forward = (−sin yaw, 0, −cos yaw); right = (cos yaw, 0, −sin yaw).
    out.set(-sy * f + cy * r, 0, -cy * f - sy * r);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  private updateFly(dt: number): boolean {
    const sprint = this.has('ControlLeft', 'ControlRight');
    const wish = this.inputVector(this.v1);
    const before = this.v3.copy(this.camera.position);
    if (this.flying || !this.walk) {
      const speed = sprint ? FLY_SPRINT : FLY_SPEED;
      const up = (this.has('Space') ? 1 : 0) - (this.has('ShiftLeft', 'ShiftRight') ? 1 : 0);
      wish.multiplyScalar(speed);
      wish.y = up * speed * 0.75;
      this.vel.lerp(wish, 1 - Math.exp(-dt * 10));
      if (this.vel.lengthSq() < 1e-6 && !this.keys.size) this.vel.set(0, 0, 0);
      this.camera.position.addScaledVector(this.vel, dt);
      if (this.camera.position.y < 0.3) this.camera.position.y = 0.3;
    } else {
      const speed = sprint ? WALK_SPRINT : WALK_SPEED;
      wish.multiplyScalar(speed);
      wish.y = 0;
      this.vel.lerp(wish, 1 - Math.exp(-dt * 14));
      if (this.vel.lengthSq() < 1e-6 && !this.keys.size) this.vel.set(0, 0, 0);
      this.walk = walkStep(this.walk, { dx: this.vel.x * dt, dz: this.vel.z * dt }, dt, this.host.probe, this.jumpQueued);
      this.jumpQueued = false;
      this.camera.position.set(this.walk.x, this.walk.y + EYE_HEIGHT, this.walk.z);
    }
    this.camera.updateMatrixWorld();
    return before.distanceToSquared(this.camera.position) > 1e-10;
  }

  private glideOrbit(dt: number): boolean {
    const f = (this.has('KeyW', 'ArrowUp') ? 1 : 0) - (this.has('KeyS', 'ArrowDown') ? 1 : 0);
    const r = (this.has('KeyD', 'ArrowRight') ? 1 : 0) - (this.has('KeyA', 'ArrowLeft') ? 1 : 0);
    if (!f && !r) return false;
    const dir = this.camera.getWorldDirection(this.v1);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const right = this.v2.set(-dir.z, 0, dir.x);
    const dist = this.camera.position.distanceTo(this.orbit.target);
    const step = Math.max(2, dist * 0.6) * dt * (this.has('ControlLeft', 'ControlRight') ? 3 : 1);
    const move = this.v3.set(0, 0, 0).addScaledVector(dir, f * step).addScaledVector(right, r * step);
    this.camera.position.add(move);
    this.orbit.target.add(move);
    return true;
  }

  private updateTween(dt: number): boolean {
    const tw = this.tween!;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const k = ease(tw.t);
    const pos = this.v1.lerpVectors(tw.fromPos, tw.toPos, k);
    const target = this.v2.lerpVectors(tw.fromTarget, tw.toTarget, k);
    this.camera.position.copy(pos);
    if (this.mode === 'orbit') {
      this.orbit.target.copy(target);
      this.camera.lookAt(target);
    } else {
      const dir = this.v3.subVectors(target, pos).normalize();
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      this.applyLook();
    }
    this.camera.updateMatrixWorld();
    if (tw.t >= 1) {
      this.tween = null;
      if (this.mode === 'orbit') this.orbit.update();
      if (this.walk) this.startWalking();
    }
    return true;
  }

  /** Animate (or jump) to a camera position looking at `target`. */
  flyTo(position: THREE.Vector3, target: THREE.Vector3, duration = 0.7): void {
    const fromTarget =
      this.mode === 'orbit' ? this.orbit.target.clone() : this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(position.distanceTo(target)));
    if (duration <= 0) {
      this.tween = { fromPos: position.clone(), toPos: position.clone(), fromTarget: target.clone(), toTarget: target.clone(), t: 0, duration: 1e-3 };
      this.updateTween(1);
      return;
    }
    this.tween = { fromPos: this.camera.position.clone(), toPos: position.clone(), fromTarget, toTarget: target.clone(), t: 0, duration };
  }

  /** Distance needed to fit a sphere of `radius` in view. */
  fitDistance(radius: number): number {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFov, hFov);
    return Math.max(2, radius / Math.sin(fov / 2));
  }

  /** Frame a box keeping the current viewing direction. */
  frameBox(box: THREE.Box3, duration = 0.7): void {
    const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10) : box.getBoundingSphere(new THREE.Sphere());
    const dir =
      this.mode === 'orbit'
        ? new THREE.Vector3().subVectors(this.camera.position, this.orbit.target).normalize()
        : this.camera.getWorldDirection(new THREE.Vector3()).negate();
    if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(0.6, 0.5, 0.62).normalize();
    const dist = this.fitDistance(Math.max(0.5, sphere.radius)) * 1.05;
    this.flyTo(sphere.center.clone().addScaledVector(dir, dist), sphere.center, duration);
  }

  /** Classic three-quarter view from the south-east. */
  resetView(box: THREE.Box3, duration = 0.8): void {
    const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10) : box.getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(0.62, 0.48, 0.62).normalize();
    const dist = this.fitDistance(Math.max(2, sphere.radius)) * 0.95;
    const target = sphere.center.clone();
    target.y = Math.max(0, box.isEmpty() ? 0 : Math.min(sphere.center.y, box.min.y + (box.max.y - box.min.y) * 0.35));
    this.flyTo(target.clone().addScaledVector(dir, dist), target, duration);
  }

  /** Straight down onto the plan (north up). */
  topView(box: THREE.Box3, duration = 0.8): void {
    const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10) : box.getBoundingSphere(new THREE.Sphere());
    const dist = this.fitDistance(Math.max(2, sphere.radius)) * 1.05;
    const target = sphere.center.clone();
    this.flyTo(target.clone().add(new THREE.Vector3(0, dist, 0.001)), target, duration);
  }

  /** Player position/facing in plan terms. */
  player(): PlayerView {
    const p = this.camera.position;
    const dir = this.camera.getWorldDirection(this.v1);
    let yawDeg = (Math.atan2(-dir.z, dir.x) * 180) / Math.PI;
    if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.z) < 1e-6) yawDeg = 90;
    return { position: { x: p.x * M_TO_MM, y: -p.z * M_TO_MM }, elevation: p.y * M_TO_MM, yaw: yawDeg };
  }

  /** Compass heading in degrees clockwise from plan north (+y). */
  heading(): number {
    const dir = this.camera.getWorldDirection(this.v1);
    const deg = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  dispose(): void {
    this.orbit.dispose();
  }
}

const MOVE_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
]);
const ORBIT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
