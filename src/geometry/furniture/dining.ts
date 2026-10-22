import type { Model, P3 } from '../model';
import { clamp, cushion, legs, type FurnitureBuilder } from './kit';

/** Rectangular table: top, four legs and an apron. */
export function rectTable(m: Model, w: number, d: number, h: number, top: string, frame = top, legSize = 70): void {
  const hw = w / 2;
  const hd = d / 2;
  const t = clamp(h * 0.055, 25, 45);
  m.use(top, 'body');
  m.box(-hw, -hd, h - t, hw, hd, h);
  m.use(frame, 'body');
  const ls = Math.min(legSize, w / 6, d / 6);
  const inset = Math.min(50, w * 0.05, d * 0.05);
  legs(m, hw, hd, inset, 0, h - t, ls);
  const ax = hw - inset - ls / 2;
  const ay = hd - inset - ls / 2;
  const az0 = h - t - clamp(h * 0.12, 40, 100);
  const at = 22;
  if (ax > ls && ay > ls) {
    m.box(-ax, -ay - at / 2, az0, ax, -ay + at / 2, h - t);
    m.box(-ax, ay - at / 2, az0, ax, ay + at / 2, h - t);
    m.box(-ax - at / 2, -ay, az0, -ax + at / 2, ay, h - t);
    m.box(ax - at / 2, -ay, az0, ax + at / 2, ay, h - t);
  }
}

/** Round (or elliptical) pedestal table. */
export function roundTable(m: Model, w: number, d: number, h: number, top: string, base = top): void {
  const t = clamp(h * 0.055, 25, 45);
  m.use(top, 'body');
  m.cylinder(0, 0, h - t, h, w / 2, 40, w / 2, d / 2);
  m.use(base, 'body');
  const r = Math.min(w, d);
  m.cylinder(0, 0, 50, h - t, clamp(r * 0.07, 25, 80), 16);
  m.cylinder(0, 0, 0, 50, clamp(r * 0.4, 100, 450), 24, clamp(r * 0.1, 40, 100));
}

export interface ChairOptions {
  frame: string;
  seat: string;
  /** Round metal tube legs instead of square timber legs. */
  metal?: boolean;
  seatHeight?: number;
}

/** Side chair: four legs, seat with cushion, back posts and an upholstered back panel. */
export function chair(m: Model, w: number, d: number, h: number, o: ChairOptions): void {
  const hw = w / 2;
  const hd = d / 2;
  const seat = Math.min(o.seatHeight ?? 460, h * 0.55);
  const leg = clamp(w * 0.08, 22, 40);
  const li = 10;
  m.use(o.frame, 'body');
  const lx = hw - li - leg / 2;
  const ly = hd - li - leg / 2;
  for (const sx of [-1, 1]) {
    if (o.metal) {
      m.cylinder(sx * lx, -ly, 0, seat - 40, leg / 2, 8);
      m.cylinder(sx * lx, ly, 0, h - 10, leg / 2, 8);
    } else {
      m.boxC(sx * lx, -ly, 0, leg, leg, seat - 40);
      m.boxC(sx * lx, ly, 0, leg, leg, h);
    }
    // Side stretcher.
    m.box(sx * lx - leg / 4, -ly, 150, sx * lx + leg / 4, ly, 175);
  }
  // Seat frame and cushion.
  m.box(-hw + li, -hd + li, seat - 75, hw - li, hd - li, seat - 35);
  m.use(o.seat, 'body', 'seat');
  cushion(m, -hw + li + 5, hw - li - 5, -hd + li + 5, hd - li - leg, seat - 35, seat, 18);
  // Back: top rail and panel between the back posts.
  m.use(o.frame, 'body');
  m.box(-lx, ly - leg / 2, h - 90, lx, ly + leg / 2 - 5, h - 10);
  m.use(o.seat, 'body', 'seat');
  if (h - 110 > seat + 100) m.box(-lx + leg / 2, ly - leg / 2 - 10, seat + 90, lx - leg / 2, ly - leg / 2 + 12, h - 110);
}

const dining6: FurnitureBuilder = (m, s) => rectTable(m, s.w, s.d, s.h, s.primary);

const diningRound: FurnitureBuilder = (m, s) => roundTable(m, s.w, s.d, s.h, s.primary);

const diningChair: FurnitureBuilder = (m, s) => chair(m, s.w, s.d, s.h, { frame: s.primary, seat: s.secondary });

const barStool: FurnitureBuilder = (m, s) => {
  const r = Math.min(s.w, s.d) / 2;
  const top = s.h;
  m.use(s.secondary, 'body', 'seat');
  m.cylinder(0, 0, top - 70, top - 20, r - 5, 20, r - 5);
  m.cylinder(0, 0, top - 20, top, r - 5, 20, r - 30);
  m.use(s.primary, 'body');
  m.cylinder(0, 0, top - 90, top - 70, r * 0.7, 16);
  const rt = r * 0.55;
  const rb = r - 25;
  const zt = top - 80;
  const leg = (k: number, z: number): P3 => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const rr = rb + ((rt - rb) * z) / zt;
    return [Math.cos(a) * rr, Math.sin(a) * rr, z];
  };
  for (let k = 0; k < 4; k++) m.tube(leg(k, 0), leg(k, zt), 12, 8);
  const zr = Math.min(300, top * 0.4);
  for (let k = 0; k < 4; k++) m.tube(leg(k, zr), leg((k + 1) % 4, zr), 9, 6);
};

export const DINING: Record<string, FurnitureBuilder> = {
  'dining-table-6': dining6,
  'dining-table-4': dining6,
  'dining-table-round': diningRound,
  'dining-chair': diningChair,
  'bar-stool': barStool,
};
