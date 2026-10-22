import { rng, WHITE, METAL, type FurnitureBuilder } from './kit';

const plantPot: FurnitureBuilder = (m, s) => {
  const R = Math.min(s.w, s.d) / 2;
  const h = s.h;
  const potH = h * 0.3;
  m.use(s.secondary, 'body', 'pot');
  m.cylinder(0, 0, 0, potH - 30, R * 0.66, 16, R * 0.9);
  m.prism(ringPts(R * 0.96, 16), potH - 30, potH, [ringPts(R * 0.84, 16)]);
  m.use('soil', 'detail', 'soil');
  m.cylinder(0, 0, potH - 30, potH - 18, R * 0.84, 16);
  m.use('wood-pine', 'detail', 'stems');
  const rand = rng(5);
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    m.tube([0, 0, potH - 20], [Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, h * 0.62], 10, 5);
  }
  m.use(s.primary, 'body', 'leaves');
  for (let k = 0; k < 7; k++) {
    const a = (k * 2 * Math.PI) / 7 + rand() * 0.4;
    const r = R * (0.2 + rand() * 0.3);
    const rx = R * (0.42 + rand() * 0.06);
    const z = h * (0.55 + (k / 7) * 0.28);
    const rz = Math.min(h * 0.12, h - z);
    m.sphere(Math.cos(a) * r, Math.sin(a) * r, z, Math.min(rx, R - r - 2), Math.min(rx, R - r - 2), rz, 8, 5);
  }
};

function ringPts(r: number, n: number) {
  return Array.from({ length: n }, (_, i) => ({ x: Math.cos((i / n) * Math.PI * 2) * r, y: Math.sin((i / n) * Math.PI * 2) * r }));
}

const rect = (x0: number, z0: number, x1: number, z1: number) => [
  { x: x0, y: z0 },
  { x: x1, y: z0 },
  { x: x1, y: z1 },
  { x: x0, y: z1 },
];

const mirror: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const f = Math.min(50, s.w * 0.08, s.h * 0.08);
  m.use(s.secondary, 'frame');
  m.prismY(rect(-hw, 0, hw, s.h), -hd, hd, [rect(-hw + f, f, hw - f, s.h - f)]);
  m.use(METAL, 'detail', 'silvering');
  m.box(-hw + f, -hd + 12, f, hw - f, hd - 4, s.h - f);
  m.use(s.primary, 'glass');
  m.box(-hw + f, -hd + 8, f, hw - f, -hd + 12, s.h - f);
};

const artwork: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const f = Math.min(45, s.w * 0.06, h * 0.06);
  const mat = Math.min(80, s.w * 0.08, h * 0.1);
  m.use(s.secondary, 'frame');
  m.prismY(rect(-hw, 0, hw, h), -hd, hd, [rect(-hw + f, f, hw - f, h - f)]);
  m.use(WHITE, 'detail', 'mat');
  m.box(-hw + f, -hd + 14, f, hw - f, hd - 4, h - f);
  // Canvas: a simple landscape (sky, sea, hills, sun) in layers.
  const x0 = -hw + f + mat;
  const x1 = hw - f - mat;
  const z0 = f + mat;
  const z1 = h - f - mat;
  if (x1 - x0 < 40 || z1 - z0 < 40) return;
  const H = z1 - z0;
  const W = x1 - x0;
  m.use(s.primary, 'detail', 'canvas');
  m.box(x0, -hd + 10, z0, x1, -hd + 14, z1);
  m.use('paint-teal', 'detail', 'sea');
  m.box(x0, -hd + 8, z0, x1, -hd + 10, z0 + H * 0.3);
  m.use('paint-sage', 'detail', 'hills');
  m.prismY(
    [
      { x: x0, y: z0 },
      { x: x0 + W * 0.62, y: z0 },
      { x: x0 + W * 0.3, y: z0 + H * 0.55 },
      { x: x0, y: z0 + H * 0.42 },
    ],
    -hd + 6,
    -hd + 8,
  );
  m.prismY(
    [
      { x: x0 + W * 0.45, y: z0 },
      { x: x1, y: z0 },
      { x: x1, y: z0 + H * 0.35 },
      { x: x0 + W * 0.72, y: z0 + H * 0.46 },
    ],
    -hd + 4,
    -hd + 6,
  );
  m.use('paint-mustard', 'detail', 'sun');
  m.cylinderY(-hd + 6, -hd + 8, x0 + W * 0.75, z0 + H * 0.75, Math.min(W, H) * 0.1, 16);
};

export const DECOR: Record<string, FurnitureBuilder> = {
  'plant-pot': plantPot,
  mirror,
  artwork,
};
