import { chain, rotateZ, translate, type P3 } from '../model';
import { roundedRect } from '../poly2d';
import { chair, roundTable } from './dining';
import { METAL, clamp, rng, type FurnitureBuilder } from './kit';

const tree: FurnitureBuilder = (m, s) => {
  const R = Math.min(s.w, s.d) / 2;
  const h = s.h;
  const rb = clamp(R * 0.09, 40, 400);
  m.use(s.secondary, 'body', 'trunk');
  m.cylinder(0, 0, 0, h * 0.52, rb, 10, rb * 0.6);
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + 0.4;
    m.tube([0, 0, h * 0.4], [Math.cos(a) * R * 0.38, Math.sin(a) * R * 0.38, h * 0.62], rb * 0.35, 6, rb * 0.2);
  }
  m.use(s.primary, 'body', 'canopy');
  const rand = rng(11);
  m.sphere(0, 0, h - h * 0.3, R * 0.76, R * 0.76, h * 0.3, 10, 7);
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5 + rand() * 0.5;
    const d = R * (0.36 + rand() * 0.06);
    m.sphere(Math.cos(a) * d, Math.sin(a) * d, h * (0.55 + rand() * 0.04), R * 0.48, R * 0.48, h * 0.17, 9, 6);
  }
  m.sphere(R * 0.1, -R * 0.08, h * 0.84, R * 0.44, R * 0.44, h * 0.14, 9, 6);
};

const conifer: FurnitureBuilder = (m, s) => {
  const R = Math.min(s.w, s.d) / 2;
  const h = s.h;
  m.use(s.secondary, 'body', 'trunk');
  m.cylinder(0, 0, 0, h * 0.3, clamp(R * 0.08, 40, 300), 8, clamp(R * 0.05, 25, 200));
  m.use(s.primary, 'body', 'canopy');
  for (let i = 0; i < 4; i++) {
    const z0 = h * (0.12 + i * 0.17);
    m.cylinder(0, 0, z0, z0 + h * 0.37, R * (0.98 - 0.18 * i), 12, 0, R * (0.98 - 0.18 * i), (i * Math.PI) / 12);
  }
};

const palm: FurnitureBuilder = (m, s) => {
  const R = Math.min(s.w, s.d) / 2;
  const h = s.h;
  const crown = h * 0.86;
  const lean = R * 0.12;
  const r0 = clamp(R * 0.1, 40, 300);
  m.use(s.secondary, 'body', 'trunk');
  const n = 7;
  const at = (t: number): P3 => [lean * t * t, 0, crown * t];
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    m.tube(at(t0), at(t1), r0 * (1 - 0.35 * t0), 8, r0 * (1 - 0.35 * t1) * 0.88);
  }
  const c = at(1);
  m.use(s.primary, 'body', 'fronds');
  const reach = R - lean - 120;
  for (let k = 0; k < 9; k++) {
    const a = (k * 2 * Math.PI) / 9 + 0.2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p1: P3 = [c[0] + ca * reach * 0.45, c[1] + sa * reach * 0.45, crown + h * 0.07];
    const p2: P3 = [c[0] + ca * reach, c[1] + sa * reach, crown - h * 0.06];
    m.bar([c[0], c[1], crown], p1, clamp(R * 0.17, 60, 300), 25);
    m.bar(p1, p2, clamp(R * 0.12, 40, 220), 20);
  }
  m.use('wood-walnut', 'detail', 'coconuts');
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    m.sphere(c[0] + Math.cos(a) * r0, c[1] + Math.sin(a) * r0, crown - r0 * 0.8, r0 * 0.6, r0 * 0.6, r0 * 0.6, 8, 6);
  }
};

const shrub: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  m.use(s.primary, 'body');
  m.sphere(0, 0, h * 0.45, hw * 0.8, hd * 0.8, h * 0.42, 10, 7);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    m.sphere(Math.cos(a) * hw * 0.36, Math.sin(a) * hd * 0.36, h * 0.4, hw * 0.58, hd * 0.58, h * 0.35, 9, 6);
  }
  m.sphere(hw * 0.1, hd * 0.06, h * 0.7, hw * 0.5, hd * 0.5, h * 0.3, 9, 6);
};

const car: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const L = s.d;
  const R = clamp(L * 0.072, 150, h * 0.3);
  const tw = s.w * 0.12;
  const yF = -hd + L * 0.19;
  const yR = hd - L * 0.2;
  // Body (side profile in y-z extruded across the width).
  m.use(s.primary, 'body');
  m.prismX(
    [
      [-hd + 100, h * 0.2],
      [hd - 100, h * 0.2],
      [hd, h * 0.4],
      [hd - 40, h * 0.64],
      [-hd + L * 0.2, h * 0.6],
      [-hd + 30, h * 0.54],
      [-hd, h * 0.42],
    ],
    -hw + 20,
    hw - 20,
  );
  // Glass cabin, roof panel and B-pillars.
  const c0 = -hd + L * 0.3;
  const c1 = hd - L * 0.22;
  const r0 = -hd + L * 0.5;
  const r1 = hd - L * 0.36;
  m.use(s.secondary, 'glass', 'cabin');
  m.prismX(
    [
      [c0, h * 0.59],
      [c1, h * 0.63],
      [r1, h * 0.97],
      [r0, h * 0.97],
    ],
    -hw + 110,
    hw - 110,
  );
  m.use(s.primary, 'body');
  m.prismX(
    [
      [r0 - 30, h * 0.955],
      [r1 + 30, h * 0.955],
      [r1 + 10, h],
      [r0 - 10, h],
    ],
    -hw + 100,
    hw - 100,
  );
  m.box(-hw + 105, r0 + L * 0.06, h * 0.6, hw - 105, r0 + L * 0.06 + 90, h * 0.96);
  // Wheels with hubs.
  for (const y of [yF, yR]) {
    for (const sx of [-1, 1]) {
      const x0 = sx > 0 ? hw - 15 - tw : -hw + 15;
      const x1 = x0 + tw;
      m.use('paint-black', 'detail', 'tyres');
      m.cylinderX(x0, x1, y, R, R, 18);
      m.use(METAL, 'detail', 'hubs');
      if (sx > 0) m.cylinderX(x1 - 4, x1 + 7, y, R, R * 0.6, 12);
      else m.cylinderX(x0 - 7, x0 + 4, y, R, R * 0.6, 12);
    }
  }
  // Lights, grille, mirrors.
  m.use('light-warm', 'detail', 'headlights');
  for (const sx of [-1, 1]) m.box(sx * (hw - 330), -hd + 12, h * 0.46, sx * (hw - 110), -hd + 60, h * 0.52);
  m.use('paint-terracotta', 'detail', 'taillights');
  for (const sx of [-1, 1]) m.box(sx * (hw - 300), hd - 45, h * 0.5, sx * (hw - 90), hd - 8, h * 0.58);
  m.use('paint-black', 'detail', 'grille');
  m.box(-hw + 380, -hd + 6, h * 0.3, hw - 380, -hd + 40, h * 0.42);
  m.use(s.primary, 'body');
  for (const sx of [-1, 1]) m.box(sx * (hw - 110), c0 + L * 0.02, h * 0.62, sx * hw, c0 + L * 0.02 + 110, h * 0.68);
};

const bench: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const seatZ = Math.min(450, h * 0.56);
  const armZ = Math.min(h - 120, seatZ + 200);
  m.use(s.secondary, 'body', 'frame');
  for (const sx of [-1, 1]) {
    const x = sx * (hw - 60);
    m.bar([x, -hd + 60, 0], [x, -hd + 60, armZ], 40);
    m.bar([x, hd - 110, 0], [x, hd - 110, seatZ], 40);
    m.bar([x, hd - 110, seatZ], [x, hd - 40, h - 20], 40);
    m.bar([x, -hd + 40, seatZ - 40], [x, hd - 90, seatZ - 40], 40);
    m.bar([x, -hd + 30, armZ], [x, hd - 70, armZ + 20], 45, 30);
  }
  m.use(s.primary, 'body');
  const depth = hd - 120 - (-hd + 40);
  const n = 5;
  const sw = depth / n;
  for (let i = 0; i < n; i++) {
    const y0 = -hd + 40 + i * sw;
    m.box(-hw + 20, y0 + 6, seatZ - 20, hw - 20, y0 + sw - 6, seatZ + 10);
  }
  for (let j = 0; j < 3; j++) {
    const z0 = seatZ + 70 + j * ((h - seatZ - 100) / 3);
    const z1 = z0 + (h - seatZ - 100) / 3 - 25;
    const yb = hd - 110 + (70 * ((z0 + z1) / 2 - seatZ)) / Math.max(1, h - 20 - seatZ);
    m.box(-hw + 20, yb - 45, z0, hw - 20, yb - 22, z1);
  }
};

const pool: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const c = Math.min(300, s.w * 0.08, s.d * 0.08);
  const outer = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  const inner = roundedRect(-hw + c, -hd + c, hw - c, hd - c, 150, 3);
  m.use('stone-sandstone', 'body', 'coping');
  m.prism(outer, h - 50, h, [inner]);
  m.use(s.secondary, 'body', 'tiles');
  m.prism(outer, 0, h - 50, [inner]);
  m.prism(inner, 0, 20);
  m.use(s.primary, 'glass', 'water');
  m.prism(roundedRect(-hw + c + 1, -hd + c + 1, hw - c - 1, hd - c - 1, 149, 3), 20, Math.max(30, h - 110));
};

const patioSet: FurnitureBuilder = (m, s) => {
  const S = Math.min(s.w, s.d);
  const h = s.h;
  roundTable(m, S * 0.56, S * 0.56, h, 'glass-tinted', s.primary);
  m.use(s.primary, 'body');
  m.prism(roundedRect(-S * 0.28, -S * 0.28, S * 0.28, S * 0.28, S * 0.28, 8), h - 45, h - 40);
  const cw = S * 0.27;
  const cd = S * 0.3;
  const Rc = S / 2 - cd / 2 - 10;
  for (let k = 0; k < 4; k++) {
    const th = (k * 90 * Math.PI) / 180;
    m.group(chain(translate(Math.cos(th) * Rc, Math.sin(th) * Rc), rotateZ(k * 90 - 90)), () =>
      chair(m, cw, cd, h - 5, { frame: s.primary, seat: s.secondary, metal: true, seatHeight: 430 }),
    );
  }
};

export const OUTDOOR: Record<string, FurnitureBuilder> = {
  tree,
  'tree-conifer': conifer,
  palm,
  shrub,
  car,
  bench,
  pool,
  'patio-set': patioSet,
};
