import type { Model } from '../model';
import { ellipse, roundedRect } from '../poly2d';
import { FRONT_T, FRONT_ZONE, METAL, barHandle, fronts, knob, plinth, tap, type FurnitureBuilder } from './kit';

const KICK = 100;
const TOP_T = 40;
/** Extra height above the catalog height taken by taps on sink units (allowed by the bounds tests). */
export const TAP_RISE = 260;

interface BaseOptions {
  carcass: string;
  front: string;
  top?: string;
  /** Hollow carcass (side panels/back/bottom only) so a sink bowl can hang inside. */
  hollow?: boolean;
  drawerRow?: boolean;
  /** Width of the carcass zone (defaults to the full width). */
  x0?: number;
  x1?: number;
  /** Back of the carcass (defaults to d/2). */
  yBack?: number;
}

/** Floor cabinet run: recessed kick plinth, carcass, drawer row + doors, optional worktop. */
export function baseCabinet(m: Model, w: number, d: number, h: number, o: BaseOptions): void {
  const hw = w / 2;
  const hd = d / 2;
  const x0 = o.x0 ?? -hw;
  const x1 = o.x1 ?? hw;
  const yb = o.yBack ?? hd;
  const yf = -hd + FRONT_ZONE;
  const topZ = o.top || o.hollow ? h - TOP_T : h;
  plinth(m, x0 + 5, x1 - 5, yf + 50, yb - 5, KICK);
  m.use(o.carcass, 'body');
  if (o.hollow) {
    m.box(x0, yf, KICK, x0 + 18, yb, topZ);
    m.box(x1 - 18, yf, KICK, x1, yb, topZ);
    m.box(x0 + 18, yb - 12, KICK, x1 - 18, yb, topZ);
    m.box(x0 + 18, yf, KICK, x1 - 18, yb - 12, KICK + 18);
    m.box(x0 + 18, yf, topZ - 60, x1 - 18, yf + 18, topZ);
  } else m.box(x0, yf, KICK, x1, yb, topZ);
  const cols = Math.max(1, Math.round((x1 - x0) / 600));
  const drawerH = o.drawerRow === false ? 0 : Math.min(170, (topZ - KICK) * 0.25);
  if (drawerH > 0)
    fronts(m, { x0: x0 + 2, x1: x1 - 2, z0: topZ - drawerH - 2, z1: topZ - 3, yFace: yf, cols, rows: 1, frontMat: o.front, handleMat: METAL, handle: 'bar-h' });
  fronts(m, { x0: x0 + 2, x1: x1 - 2, z0: KICK + 3, z1: topZ - drawerH - 4, yFace: yf, cols, rows: 1, frontMat: o.front, handleMat: METAL, handle: 'bar-v', pairs: cols % 2 === 0 });
  if (o.top) {
    m.use(o.top, 'body', 'worktop');
    m.box(-hw, -hd, h - TOP_T, hw, hd, h);
  }
}

const base: FurnitureBuilder = (m, s) => baseCabinet(m, s.w, s.d, s.h, { carcass: s.primary, front: s.primary, top: s.secondary });

const sink: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  baseCabinet(m, s.w, s.d, s.h, { carcass: s.primary, front: s.primary, hollow: true });
  // Worktop with the bowl cut out, steel bowl and tap.
  const bw = Math.min(s.w - 200, 760) / 2;
  const by0 = -hd + 90;
  const by1 = hd - 130;
  const hole = roundedRect(-bw, by0, bw, by1, 40, 3);
  m.use(s.secondary, 'body', 'worktop');
  m.prism(
    [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ],
    s.h - TOP_T,
    s.h,
    [hole],
  );
  m.use('steel', 'body', 'bowl');
  m.tray(hole, roundedRect(-bw + 12, by0 + 12, bw - 12, by1 - 12, 30, 3), s.h - 210, s.h - 195, s.h - 1);
  m.use('steel', 'detail', 'drain');
  m.cylinder(0, (by0 + by1) / 2, s.h - 195, s.h - 193, 35, 12);
  tap(m, 0, hd - 65, s.h, TAP_RISE, Math.min(200, by1 - by0 - 40));
};

const stove: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const yf = -hd + FRONT_ZONE;
  plinth(m, -hw + 5, hw - 5, yf + 50, hd - 5, KICK);
  m.use(s.primary, 'body');
  m.box(-hw, yf, KICK, hw, hd, s.h - TOP_T);
  // Oven door with window and handle.
  const doorTop = Math.min(s.h - 220, 700);
  m.use(s.secondary, 'panel', 'oven-door');
  m.box(-hw + 10, yf - FRONT_T, KICK + 20, hw - 10, yf, doorTop);
  m.use('glass-tinted', 'glass', 'oven-window');
  m.box(-hw + 80, yf - FRONT_T - 3, KICK + 160, hw - 80, yf - FRONT_T, doorTop - 110);
  m.use(METAL, 'detail');
  barHandle(m, 0, doorTop - 50, Math.min(s.w - 140, 460), false, yf - FRONT_T);
  // Control panel with knobs.
  m.use(s.secondary, 'panel', 'controls');
  m.box(-hw + 10, yf - 10, doorTop + 15, hw - 10, yf, s.h - TOP_T - 10);
  m.use(METAL, 'detail');
  const kz = (doorTop + 15 + s.h - TOP_T - 10) / 2;
  for (let i = 0; i < 4; i++) knob(m, -hw + ((i + 0.5) * s.w) / 4, kz, yf - 10, 17, 25);
  // Glass cooktop with four burners.
  m.use(s.secondary, 'body', 'cooktop');
  m.box(-hw, -hd + 15, s.h - TOP_T, hw, hd, s.h - 6);
  const bx = s.w / 4;
  const by = (s.d - 15) / 4;
  for (const [x, y, r] of [
    [-bx, by, 90],
    [bx, by, 70],
    [-bx, -by + 8, 70],
    [bx, -by + 8, 90],
  ] as const) {
    const rr = Math.min(r, bx - 15, by - 15);
    m.use('steel', 'detail', 'burners');
    m.prism(ellipse(x, y, rr, rr, 16), s.h - 6, s.h - 2, [ellipse(x, y, rr * 0.55, rr * 0.55, 16)]);
    m.use('paint-charcoal', 'detail', 'burner-caps');
    m.cylinder(x, y, s.h - 6, s.h, rr * 0.4, 12);
  }
};

const fridge: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const yf = -hd + FRONT_ZONE;
  m.use('paint-charcoal', 'detail', 'grille');
  m.box(-hw + 20, yf - 4, 0, hw - 20, hd - 10, 45);
  m.use(s.primary, 'body');
  m.box(-hw, yf, 45, hw, hd, s.h);
  const split = s.h * 0.37;
  m.use(s.primary, 'panel', 'doors');
  m.box(-hw + 2, yf - FRONT_T, 48, hw - 2, yf, split - 3);
  m.box(-hw + 2, yf - FRONT_T, split + 3, hw - 2, yf, s.h - 3);
  m.use('steel', 'detail');
  barHandle(m, hw - 50, split - 160, Math.min(260, split * 0.5), true, yf - FRONT_T);
  barHandle(m, hw - 50, split + 330, Math.min(420, (s.h - split) * 0.4), true, yf - FRONT_T);
};

const island: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const end = 40;
  const overhang = Math.min(330, s.d * 0.35);
  baseCabinet(m, s.w, s.d, s.h, { carcass: s.primary, front: s.primary, x0: -hw + end, x1: hw - end, yBack: hd - overhang });
  // Waterfall worktop.
  m.use(s.secondary, 'body', 'worktop');
  m.box(-hw, -hd, s.h - TOP_T, hw, hd, s.h);
  m.box(-hw, -hd, 0, -hw + end, hd, s.h - TOP_T);
  m.box(hw - end, -hd, 0, hw, hd, s.h - TOP_T);
};

const wallCabinet: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const yf = -hd + FRONT_ZONE;
  m.use(s.primary, 'body');
  m.box(-hw, yf, 0, hw, hd, s.h);
  const cols = s.w > 700 ? 2 : 1;
  fronts(m, { x0: -hw + 2, x1: hw - 2, z0: 3, z1: s.h - 3, yFace: yf, cols, rows: 1, frontMat: s.primary, handleMat: METAL, handle: 'bar-v', handleAt: 'bottom', pairs: true });
};

const dishwasher: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const yf = -hd + FRONT_ZONE;
  plinth(m, -hw + 5, hw - 5, yf + 50, hd - 5, KICK);
  m.use(s.primary, 'body');
  m.box(-hw, yf, KICK, hw, hd, s.h);
  m.use(s.primary, 'panel', 'door');
  m.box(-hw + 3, yf - FRONT_T, KICK + 3, hw - 3, yf, s.h - 95);
  m.use('paint-black', 'panel', 'controls');
  m.box(-hw + 3, yf - FRONT_T, s.h - 90, hw - 3, yf, s.h - 5);
  m.use('light-warm', 'detail', 'display');
  m.box(hw - 120, yf - FRONT_T - 2, s.h - 60, hw - 50, yf - FRONT_T, s.h - 35);
  m.use(METAL, 'detail');
  barHandle(m, 0, s.h - 140, Math.min(s.w - 120, 420), false, yf - FRONT_T);
};

export const KITCHEN: Record<string, FurnitureBuilder> = {
  'kitchen-base': base,
  'kitchen-base-1200': base,
  'kitchen-sink': sink,
  stove,
  fridge,
  'kitchen-island': island,
  'wall-cabinet': wallCabinet,
  dishwasher,
};
