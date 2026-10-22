import { chain, rotateZ, translate, type Model } from '../model';
import { FRONT_T, clamp, cushion, fronts, legs, rng, type FurnitureBuilder } from './kit';

interface SectionOptions {
  len: number;
  depth: number;
  height: number;
  armLeft: boolean;
  armRight: boolean;
  seats: number;
  fabric: string;
  wood: string;
  /** Draw legs (false when another section provides them). */
  legs?: boolean;
}

/** Straight upholstered section centred on the origin: back along +y, front at −y. */
function sofaSection(m: Model, o: SectionOptions): void {
  const hw = o.len / 2;
  const hd = o.depth / 2;
  const h = o.height;
  const legH = clamp(h * 0.1, 40, 100);
  const armW = clamp(o.len * 0.08, 90, 190);
  const armH = clamp(h * 0.72, 250, h);
  const backT = clamp(o.depth * 0.2, 110, 240);
  const seatZ = clamp(h * 0.3, legH + 60, 320);
  const cushT = clamp(h * 0.17, 60, 160);
  if (o.legs !== false) {
    m.use(o.wood, 'detail');
    legs(m, hw, hd, 35, 0, legH, 45);
  }
  m.use(o.fabric, 'body');
  const xl = o.armLeft ? -hw + armW : -hw;
  const xr = o.armRight ? hw - armW : hw;
  // Base platform and back with a rounded top.
  m.box(xl, -hd + 25, legH, xr, hd - backT, seatZ);
  m.box(-hw, hd - backT, legH, hw, hd, h - backT / 2);
  m.cylinderX(-hw, hw, hd - backT / 2, h - backT / 2, backT / 2, 10);
  // Arms with rolled tops.
  for (const [on, x0] of [
    [o.armLeft, -hw],
    [o.armRight, hw - armW],
  ] as const) {
    if (!on) continue;
    m.box(x0, -hd, legH, x0 + armW, hd - backT / 2, armH - armW / 2);
    m.cylinderY(-hd, hd - backT / 2, x0 + armW / 2, armH - armW / 2, armW / 2, 10);
  }
  // Seat and back cushions.
  const n = Math.max(1, o.seats);
  const gap = 8;
  const cw = (xr - xl - (n - 1) * gap) / n;
  const bcT = clamp(o.depth * 0.17, 90, 190);
  for (let i = 0; i < n; i++) {
    const x0 = xl + i * (cw + gap);
    cushion(m, x0, x0 + cw, -hd + 12, hd - backT, seatZ, seatZ + cushT, 45);
    cushion(m, x0 + 10, x0 + cw - 10, hd - backT - bcT, hd - backT + 5, seatZ + cushT, h - 35, 50);
  }
}

const seatsFor = (len: number) => Math.max(1, Math.min(4, Math.round(len / 700)));

const sofa: FurnitureBuilder = (m, s) => {
  const armW = clamp(s.w * 0.08, 90, 190);
  sofaSection(m, {
    len: s.w,
    depth: s.d,
    height: s.h,
    armLeft: true,
    armRight: true,
    seats: seatsFor(s.w - 2 * armW),
    fabric: s.primary,
    wood: s.secondary,
  });
};

const sofaL: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const D = Math.min(950, s.d * 0.55, s.w * 0.5);
  const common = { depth: D, height: s.h, fabric: s.primary, wood: s.secondary };
  m.group(translate(0, hd - D / 2), () =>
    sofaSection(m, { ...common, len: s.w, armLeft: false, armRight: true, seats: seatsFor(s.w - D) + 1 }),
  );
  const retLen = s.d - D;
  if (retLen > 200) {
    m.group(chain(translate(-hw + D / 2, -D / 2), rotateZ(90)), () =>
      sofaSection(m, { ...common, len: retLen, armLeft: true, armRight: false, seats: seatsFor(retLen) }),
    );
  }
  // Corner back piece continuing the return's back.
  const backT = clamp(D * 0.2, 110, 240);
  m.use(s.primary, 'body');
  m.box(-hw, hd - D, clamp(s.h * 0.1, 40, 100), -hw + backT, hd, s.h - backT / 2);
  m.cylinderY(hd - D, hd, -hw + backT / 2, s.h - backT / 2, backT / 2, 10);
};

const armchair: FurnitureBuilder = (m, s) => {
  sofaSection(m, { len: s.w, depth: s.d, height: s.h, armLeft: true, armRight: true, seats: 1, fabric: s.primary, wood: s.secondary });
};

const coffeeTable: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const t = clamp(s.h * 0.09, 20, 45);
  m.use(s.primary, 'body');
  m.box(-hw, -hd, s.h - t, hw, hd, s.h);
  legs(m, hw, hd, 40, 0, s.h - t, 45);
  if (s.h > 250) m.box(-hw + 60, -hd + 60, s.h * 0.22, hw - 60, hd - 60, s.h * 0.22 + 18);
};

const tvUnit: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const cabH = Math.min(s.h * 0.4, 480);
  m.use('paint-charcoal', 'detail');
  m.box(-hw + 30, -hd + 50, 0, hw - 30, hd - 10, 60);
  m.use(s.primary, 'body');
  m.box(-hw, -hd + FRONT_T, 60, hw, hd, cabH);
  fronts(m, { x0: -hw + 4, x1: hw - 4, z0: 64, z1: cabH - 4, yFace: -hd + FRONT_T, cols: Math.max(2, Math.round(s.w / 600)), rows: 1, frontMat: s.primary, handleMat: s.primary, handle: 'none', gap: 5 });
  // Television on a stand.
  const tv = s.secondary;
  const tvH = Math.max(100, Math.min(((s.w * 0.8) * 9) / 16, s.h - cabH - 90));
  const tvW = Math.min(s.w * 0.8, (tvH * 16) / 9);
  m.use(tv, 'body');
  m.box(-tvW * 0.12, -hd * 0.5, cabH, tvW * 0.12, hd * 0.4, cabH + 15);
  m.box(-30, 0, cabH + 15, 30, 30, s.h - tvH + 20);
  m.box(-tvW / 2, 30, s.h - tvH, tvW / 2, 70, s.h);
  m.use('paint-charcoal', 'detail', 'screen');
  m.box(-tvW / 2 + 12, 26, s.h - tvH + 12, tvW / 2 - 12, 30, s.h - 12);
};

const BOOK_COLORS = ['paint-navy', 'paint-terracotta', 'paint-sage', 'paint-mustard', 'paint-teal', 'paint-blush', 'paint-charcoal', 'paint-warm-white', 'leather-brown'];

const bookshelf: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const t = 22;
  m.use(s.primary, 'body');
  m.box(-hw, -hd, 0, -hw + t, hd, s.h);
  m.box(hw - t, -hd, 0, hw, hd, s.h);
  m.box(-hw + t, -hd, s.h - t, hw - t, hd, s.h);
  m.box(-hw + t, -hd + 20, 0, hw - t, hd, 70);
  m.box(-hw + t, hd - 8, 70, hw - t, hd, s.h - t);
  const shelves = Math.max(2, Math.round(s.h / 380));
  const pitch = (s.h - t - 70) / shelves;
  const rand = rng(7);
  for (let i = 0; i < shelves; i++) {
    const z = 70 + i * pitch;
    if (i > 0) {
      m.use(s.primary, 'body');
      m.box(-hw + t, -hd, z - t, hw - t, hd - 8, z);
    }
    // Books.
    let x = -hw + t + 6;
    const maxH = pitch - t - 25;
    while (x < hw - t - 40 && maxH > 60) {
      const bw = 18 + rand() * 30;
      const bh = maxH * (0.62 + rand() * 0.35);
      const bd = Math.min(s.d - 40, 150 + rand() * 90);
      if (x + bw > hw - t - 6) break;
      if (rand() < 0.12) {
        x += bw + 10;
        continue;
      }
      m.use(BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)], 'detail', 'books');
      m.box(x, hd - 8 - bd, z, x + bw, hd - 8, z + bh);
      x += bw + 1.5;
    }
  }
};

const rug: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const b = Math.min(120, s.w * 0.08, s.d * 0.08);
  m.use(s.primary, 'body');
  m.box(-hw + b, -hd + b, 0, hw - b, hd - b, s.h * 0.8);
  m.use(s.primary === 'fabric-grey' ? 'fabric-beige' : 'fabric-grey', 'detail', 'border');
  const outer = [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ];
  const inner = [
    { x: -hw + b, y: -hd + b },
    { x: hw - b, y: -hd + b },
    { x: hw - b, y: hd - b },
    { x: -hw + b, y: hd - b },
  ];
  m.prism(outer, 0, s.h, [inner]);
};

const fireplace: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const pier = clamp(s.w * 0.17, 120, 320);
  const mantelT = clamp(h * 0.065, 40, 90);
  const lintel = clamp(h * 0.22, 120, 300);
  const openTop = h - mantelT - lintel;
  m.use(s.primary, 'body');
  m.box(-hw, -hd, 0, hw, hd, 50); // hearth
  m.box(-hw + 40, -hd + 90, 50, -hw + 40 + pier, hd, openTop);
  m.box(hw - 40 - pier, -hd + 90, 50, hw - 40, hd, openTop);
  m.box(-hw + 40, -hd + 90, openTop, hw - 40, hd, h - mantelT);
  m.box(-hw, -hd + 40, h - mantelT, hw, hd, h); // mantel shelf
  // Firebox (dark recess) with logs and embers.
  const fx0 = -hw + 40 + pier;
  const fx1 = hw - 40 - pier;
  m.use(s.secondary, 'body', 'firebox');
  m.box(fx0, -hd + 170, 50, fx1, hd, openTop);
  if (fx1 - fx0 > 200) {
    m.use('wood-walnut', 'detail', 'logs');
    const cx = (fx0 + fx1) / 2;
    const lw = (fx1 - fx0) * 0.36;
    m.tube([cx - lw, -hd + 130, 80], [cx + lw * 0.2, -hd + 130, 80], 30, 7);
    m.tube([cx - lw * 0.2, -hd + 125, 80], [cx + lw, -hd + 125, 80], 30, 7);
    m.tube([cx - lw * 0.6, -hd + 130, 130], [cx + lw * 0.6, -hd + 130, 130], 26, 7);
    m.use('light-warm', 'light', 'embers');
    m.box(cx - lw, -hd + 150, 50, cx + lw, -hd + 168, 75);
  }
};

const piano: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const caseD = Math.min(s.d * 0.5, 320);
  const kz = clamp(h * 0.55, 400, 760);
  m.use(s.primary, 'body');
  m.box(-hw, hd - caseD, 40, hw, hd, h - 25); // case
  m.box(-hw - 0, hd - caseD - 20, h - 25, hw, hd, h); // lid
  m.box(-hw, -hd + 40, 0, hw, hd, 40); // plinth / toe rail
  m.box(-hw + 50, -hd + 60, kz - 70, hw - 50, hd - caseD, kz); // key bed
  for (const sx of [-1, 1]) {
    m.box(sx > 0 ? hw - 50 : -hw, -hd + 40, 40, sx > 0 ? hw : -hw + 50, hd - caseD, kz + 60); // cheeks
    m.boxC(sx * (hw - 25), -hd + 70, 0, 50, 60, kz - 70); // legs
  }
  m.box(-hw + 50, hd - caseD - 25, kz + 80, hw - 50, hd - caseD, h - 120); // upper panel
  m.box(-hw * 0.45, hd - caseD - 60, kz + 140, hw * 0.45, hd - caseD - 25, kz + 330); // music desk
  // Keyboard: white keys strip + black keys in the 2-3 pattern.
  const kx0 = -hw + 60;
  const kx1 = hw - 60;
  m.use('plastic-white', 'detail', 'keys');
  m.box(kx0, -hd + 70, kz, kx1, hd - caseD, kz + 22);
  const whites = Math.max(7, Math.floor((kx1 - kx0) / 23.5));
  const kw = (kx1 - kx0) / whites;
  m.use('paint-black', 'detail', 'black-keys');
  const pattern = [1, 1, 0, 1, 1, 1, 0];
  for (let i = 0; i < whites - 1; i++) {
    if (!pattern[i % 7]) continue;
    const x = kx0 + (i + 1) * kw;
    m.box(x - kw * 0.3, -hd + 120, kz + 22, x + kw * 0.3, hd - caseD, kz + 34);
  }
  // Pedals.
  m.use('copper', 'detail', 'pedals');
  for (const x of [-70, 0, 70]) m.box(x - 15, hd - caseD - 70, 45, x + 15, hd - caseD, 60);
};

export const LIVING: Record<string, FurnitureBuilder> = {
  'sofa-3': sofa,
  'sofa-2': sofa,
  'sofa-l': sofaL,
  armchair,
  'coffee-table': coffeeTable,
  'tv-unit': tvUnit,
  bookshelf,
  rug,
  fireplace,
  piano,
};
