// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraController, DOUBLE_TAP_MS } from './camera';
import { EYE_HEIGHT, type WalkProbe } from './walker';

const flatGround: WalkProbe = {
  groundAt: (_x, _z, fromY) => (fromY >= 0 ? 0 : null),
  obstacle: () => null,
};

function make(): CameraController {
  const el = document.createElement('div');
  const cam = new CameraController(el, { probe: flatGround, centerDistance: () => 12 });
  cam.setAspect(1600, 900);
  return cam;
}

function run(cam: CameraController, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) cam.update(1 / 60);
}

describe('camera controller', () => {
  it('reports the player position and plan yaw', () => {
    const cam = make();
    cam.setMode('fly');
    cam.flyTo(new THREE.Vector3(0, 1.62, 0), new THREE.Vector3(10, 1.62, 0), 0);
    const p = cam.player();
    expect(p.position.x).toBeCloseTo(0, 6);
    expect(p.elevation).toBeCloseTo(1620, 3);
    expect(p.yaw).toBeCloseTo(0, 3); // looking along plan +x (east)
    expect(cam.heading()).toBeCloseTo(90, 3);
    cam.flyTo(new THREE.Vector3(0, 1.62, 0), new THREE.Vector3(0, 1.62, -10), 0);
    expect(cam.player().yaw).toBeCloseTo(90, 3); // world −z = plan north
    expect(cam.heading()).toBeCloseTo(0, 3);
  });

  it('switches orbit ⇄ fly keeping the view, and orbits around a point ahead when leaving fly', () => {
    const cam = make();
    cam.flyTo(new THREE.Vector3(10, 5, 10), new THREE.Vector3(0, 0, 0), 0);
    const dir = cam.camera.getWorldDirection(new THREE.Vector3());
    cam.setMode('fly');
    expect(cam.orbit.enabled).toBe(false);
    expect(cam.camera.getWorldDirection(new THREE.Vector3()).dot(dir)).toBeGreaterThan(0.9999);
    cam.setMode('orbit');
    expect(cam.orbit.enabled).toBe(true);
    expect(cam.orbit.target.distanceTo(cam.camera.position)).toBeCloseTo(12, 3);
  });

  it('pivots orbiting at the depth of the pointed surface without moving the view', () => {
    const cam = make();
    cam.flyTo(new THREE.Vector3(0, 10, 20), new THREE.Vector3(0, 0, 0), 0);
    const dir = cam.camera.getWorldDirection(new THREE.Vector3());
    cam.pivotAt(new THREE.Vector3(3, 0, 0));
    const toTarget = cam.orbit.target.clone().sub(cam.camera.position).normalize();
    expect(toTarget.dot(dir)).toBeGreaterThan(0.9999);
    expect(cam.orbit.target.distanceTo(cam.camera.position)).toBeCloseTo(new THREE.Vector3(3, -10, -20).dot(dir), 3);
  });

  it('frames boxes with an eased transition', () => {
    const cam = make();
    const box = new THREE.Box3(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 6, 5));
    cam.frameBox(box, 0.5);
    expect(cam.moving).toBe(true);
    run(cam, 1);
    expect(cam.moving).toBe(false);
    expect(cam.orbit.target.distanceTo(new THREE.Vector3(0, 3, 0))).toBeLessThan(1e-6);
    const d = cam.camera.position.distanceTo(cam.orbit.target);
    expect(d).toBeCloseTo(cam.fitDistance(box.getBoundingSphere(new THREE.Sphere()).radius) * 1.05, 3);
    cam.topView(box, 0);
    expect(cam.camera.getWorldDirection(new THREE.Vector3()).y).toBeLessThan(-0.999);
  });

  it('flies with WASD/Space and clamps mouse look', () => {
    const cam = make();
    cam.flyTo(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, -10), 0);
    cam.setMode('fly');
    expect(cam.keyDown('KeyW')).toBe(true);
    run(cam, 1);
    cam.keyUp('KeyW');
    expect(cam.camera.position.z).toBeLessThan(-4);
    expect(Math.abs(cam.camera.position.x)).toBeLessThan(1e-6);
    cam.keyDown('Space', false, 0);
    run(cam, 0.5);
    cam.keyUp('Space');
    expect(cam.camera.position.y).toBeGreaterThan(3);
    cam.look(0, -1e6);
    const up = cam.camera.getWorldDirection(new THREE.Vector3()).y;
    expect(up).toBeGreaterThan(0.99);
    expect(up).toBeLessThan(1);
    expect(cam.keyDown('KeyQ')).toBe(false);
  });

  it('double-tap Space toggles walking: gravity lands the eye at 1.62 m', () => {
    const cam = make();
    cam.flyTo(new THREE.Vector3(0, 8, 0), new THREE.Vector3(0, 8, -10), 0);
    cam.setMode('fly');
    let toggled: boolean | null = null;
    cam.onFlyingChange = (f) => (toggled = f);
    cam.keyDown('Space', false, 1000);
    cam.keyUp('Space');
    cam.keyDown('Space', false, 1000 + DOUBLE_TAP_MS / 2);
    cam.keyUp('Space');
    expect(cam.flying).toBe(false);
    expect(toggled).toBe(false);
    run(cam, 3);
    expect(cam.camera.position.y).toBeCloseTo(EYE_HEIGHT, 5);
    // Slow taps do not toggle.
    cam.keyDown('Space', false, 5000);
    cam.keyUp('Space');
    cam.keyDown('Space', false, 5000 + DOUBLE_TAP_MS * 2);
    cam.keyUp('Space');
    expect(cam.flying).toBe(false);
    cam.dispose();
  });

  it('WASD glides the orbit target in orbit mode', () => {
    const cam = make();
    cam.flyTo(new THREE.Vector3(0, 10, 10), new THREE.Vector3(0, 0, 0), 0);
    const t0 = cam.orbit.target.clone();
    expect(cam.keyDown('KeyD')).toBe(true);
    expect(cam.moving).toBe(true);
    run(cam, 0.5);
    cam.keyUp('KeyD');
    expect(cam.orbit.target.x).toBeGreaterThan(t0.x + 1);
    expect(cam.keyDown('Space')).toBe(false);
  });
});
