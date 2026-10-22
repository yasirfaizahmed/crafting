import type { P3 } from '../model';
import { DARK_METAL, FRONT_ZONE, METAL, WHITE, clamp, cushion, fronts, type FurnitureBuilder } from './kit';

const desk: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const t = 30;
  m.use(s.primary, 'body');
  m.box(-hw, -hd, s.h - t, hw, hd, s.h);
  // Sled frames on both ends plus a rear rail.
  m.use(s.secondary, 'body', 'frame');
  const fx = hw - 60;
  const fy = hd - 50;
  for (const sx of [-1, 1]) {
    const x = sx * fx;
    m.box(x - 20, -fy, 0, x + 20, -fy + 40, s.h - t);
    m.box(x - 20, fy - 40, 0, x + 20, fy, s.h - t);
    m.box(x - 20, -fy, 0, x + 20, fy, 30);
    m.box(x - 20, -fy, s.h - t - 50, x + 20, fy, s.h - t);
  }
  m.box(-fx, fy - 40, s.h - t - 80, fx, fy - 20, s.h - t);
  // Modesty panel.
  m.box(-fx + 20, fy - 18, s.h - t - 380, fx - 20, fy - 12, s.h - t - 80);
};

const officeChair: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const R = Math.min(hw, hd) - 30;
  const seatZ = clamp(s.h * 0.42, 380, 520);
  m.use(s.secondary, 'body', 'base');
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 2 + (k * 2 * Math.PI) / 5;
    const end: P3 = [Math.cos(a) * (R - 10), Math.sin(a) * (R - 10), 55];
    m.bar([0, 0, 55], end, 40, 30);
    m.sphere(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97, 25, 25, 25, 25, 8, 6);
  }
  m.cylinder(0, 0, 40, 75, 45, 12);
  m.cylinder(0, 0, 75, seatZ - 120, 32, 12);
  m.use(METAL, 'detail');
  m.cylinder(0, 0, seatZ - 120, seatZ - 60, 20, 10);
  m.use(s.secondary, 'body', 'base');
  m.box(-120, -120, seatZ - 70, 120, 120, seatZ - 50);
  // Seat.
  m.use(s.primary, 'body');
  const sw = Math.min(hw - 25, 255);
  cushion(m, -sw, sw, -Math.min(hd - 30, 250), Math.min(hd - 120, 210), seatZ - 50, seatZ + 30, 35);
  // Back support and backrest leaning back slightly.
  m.use(s.secondary, 'body', 'base');
  m.box(-30, Math.min(hd - 120, 210) - 40, seatZ - 60, 30, hd - 70, seatZ - 30);
  m.box(-30, hd - 95, seatZ - 60, 30, hd - 70, seatZ + 220);
  m.use(s.primary, 'body');
  const bw = Math.min(hw - 40, 230);
  m.prismX(
    [
      [hd - 115, seatZ + 120],
      [hd - 55, seatZ + 120],
      [hd - 15, s.h - 10],
      [hd - 75, s.h - 10],
    ],
    -bw,
    bw,
  );
  // Armrests.
  m.use(s.secondary, 'body', 'base');
  for (const sx of [-1, 1]) {
    const x = sx * (sw + 20);
    m.box(x - 12, -40, seatZ - 30, x + 12, 0, seatZ + 200);
    m.use(s.primary, 'body');
    m.box(x - 30, -170, seatZ + 200, x + 30, 120, seatZ + 230);
    m.use(s.secondary, 'body', 'base');
  }
};

const filingCabinet: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  m.use(s.primary, 'body');
  m.box(-hw, -hd + FRONT_ZONE, 0, hw, hd, s.h);
  const rows = Math.max(2, Math.round(s.h / 330));
  fronts(m, { x0: -hw + 3, x1: hw - 3, z0: 30, z1: s.h - 10, yFace: -hd + FRONT_ZONE, cols: 1, rows, frontMat: s.primary, handleMat: METAL, handle: 'bar-h' });
  // Label holders above each handle.
  m.use(WHITE, 'detail', 'labels');
  const rh = (s.h - 40) / rows;
  for (let r = 0; r < rows; r++) {
    const z = 30 + (r + 1) * rh - 100;
    m.box(-50, -hd + FRONT_ZONE - 21, z - 18, 50, -hd + FRONT_ZONE - 18, z + 18);
  }
};

const meetingTable: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const t = 40;
  m.use(s.primary, 'body');
  m.box(-hw, -hd, s.h - t, hw, hd, s.h);
  const lx = Math.max(hw - 380, hw * 0.4);
  for (const sx of [-1, 1]) m.box(sx * lx - 35, -hd + 180, 0, sx * lx + 35, hd - 180, s.h - t);
  m.box(-lx, -40, s.h - t - 140, lx, 40, s.h - t);
  // Cable tray under the top.
  m.use(DARK_METAL, 'detail', 'cable-tray');
  m.box(-lx + 60, -120, s.h - t - 100, lx - 60, -40, s.h - t - 90);
};

export const OFFICE: Record<string, FurnitureBuilder> = {
  desk,
  'office-chair': officeChair,
  'filing-cabinet': filingCabinet,
  'meeting-table': meetingTable,
};
