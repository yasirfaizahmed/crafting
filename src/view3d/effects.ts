/** Short-lived visual feedback: a puff of debris when breaking, a ring pulse when placing. */
import * as THREE from 'three';

const PARTICLES = 16;
const BREAK_LIFE = 0.75;
const PLACE_LIFE = 0.35;

interface Puff {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  pos: Float32Array;
  vel: Float32Array;
  spin: Float32Array;
  age: number;
}

interface Pulse {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
}

export class Effects {
  readonly group = new THREE.Group();
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly ring = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);
  private puffs: Puff[] = [];
  private pulses: Pulse[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private seed = 1;

  constructor() {
    this.group.name = 'effects';
  }

  get active(): boolean {
    return this.puffs.length > 0 || this.pulses.length > 0;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Debris puff at world position `at` in `color`. */
  burst(at: THREE.Vector3, color: string): void {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: true });
    const mesh = new THREE.InstancedMesh(this.cube, material, PARTICLES);
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    const pos = new Float32Array(PARTICLES * 3);
    const vel = new Float32Array(PARTICLES * 3);
    const spin = new Float32Array(PARTICLES);
    for (let i = 0; i < PARTICLES; i++) {
      pos[i * 3] = at.x + (this.rand() - 0.5) * 0.25;
      pos[i * 3 + 1] = at.y + (this.rand() - 0.5) * 0.25;
      pos[i * 3 + 2] = at.z + (this.rand() - 0.5) * 0.25;
      vel[i * 3] = (this.rand() - 0.5) * 3.2;
      vel[i * 3 + 1] = 1.2 + this.rand() * 2.6;
      vel[i * 3 + 2] = (this.rand() - 0.5) * 3.2;
      spin[i] = (this.rand() - 0.5) * 12;
    }
    this.group.add(mesh);
    this.puffs.push({ mesh, material, pos, vel, spin, age: 0 });
    this.writePuff(this.puffs[this.puffs.length - 1]);
  }

  /** Expanding ring on the surface where something was placed. */
  pulse(at: THREE.Vector3): void {
    const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
    const mesh = new THREE.Mesh(this.ring, material);
    mesh.position.copy(at);
    mesh.position.y += 0.01;
    mesh.raycast = () => {};
    mesh.renderOrder = 20;
    this.group.add(mesh);
    this.pulses.push({ mesh, material, age: 0 });
  }

  /** Advance animations; returns true while anything is animating. */
  update(dt: number): boolean {
    if (!this.active) return false;
    for (const f of this.puffs) {
      f.age += dt;
      for (let i = 0; i < PARTICLES; i++) {
        f.vel[i * 3 + 1] -= 9.8 * dt;
        f.pos[i * 3] += f.vel[i * 3] * dt;
        f.pos[i * 3 + 1] += f.vel[i * 3 + 1] * dt;
        f.pos[i * 3 + 2] += f.vel[i * 3 + 2] * dt;
      }
      f.material.opacity = Math.max(0, 1 - f.age / BREAK_LIFE);
      this.writePuff(f);
    }
    for (const p of this.pulses) {
      p.age += dt;
      const k = Math.min(1, p.age / PLACE_LIFE);
      const r = 0.25 + k * 0.75;
      p.mesh.scale.set(r, 1, r);
      p.material.opacity = 0.8 * (1 - k);
    }
    this.puffs = this.puffs.filter((f) => {
      if (f.age < BREAK_LIFE) return true;
      this.group.remove(f.mesh);
      f.mesh.dispose();
      f.material.dispose();
      return false;
    });
    this.pulses = this.pulses.filter((p) => {
      if (p.age < PLACE_LIFE) return true;
      this.group.remove(p.mesh);
      p.material.dispose();
      return false;
    });
    return true;
  }

  private writePuff(f: Puff): void {
    const size = 0.09 * (1 - 0.5 * Math.min(1, f.age / BREAK_LIFE));
    for (let i = 0; i < PARTICLES; i++) {
      const a = f.spin[i] * f.age;
      this.e.set(a, a * 0.7, a * 0.3);
      this.q.setFromEuler(this.e);
      this.p.set(f.pos[i * 3], f.pos[i * 3 + 1], f.pos[i * 3 + 2]);
      this.s.setScalar(size);
      this.m.compose(this.p, this.q, this.s);
      f.mesh.setMatrixAt(i, this.m);
    }
    f.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const f of this.puffs) {
      f.mesh.dispose();
      f.material.dispose();
    }
    for (const p of this.pulses) p.material.dispose();
    this.puffs = [];
    this.pulses = [];
    this.group.clear();
    this.cube.dispose();
    this.ring.dispose();
  }
}
