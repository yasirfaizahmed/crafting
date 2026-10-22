import { ellipse, roundedRect } from '../poly2d';
import { FRONT_ZONE, METAL, fronts, legs, softBox, tap, type FurnitureBuilder } from './kit';

/** Extra height above the catalog height taken by basin taps (allowed by the bounds tests). */
export const BASIN_TAP_RISE = 190;

const SEAT = 'plastic-white';

const toilet: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const cisternD = Math.min(180, s.d * 0.26);
  const seatZ = Math.min(400, h * 0.5);
  const bry = Math.min(260, (s.d - cisternD) / 2);
  const brx = hw - 5;
  const by = -hd + bry + 10;
  m.use(s.primary, 'body');
  // Cistern + lid + flush button.
  softBox(m, -hw + 5, hd - cisternD, seatZ - 20, hw - 5, hd, h - 25, 20, 2);
  softBox(m, -hw, hd - cisternD - 10, h - 25, hw, hd, h - 5, 20, 2);
  // Pan: pedestal, bowl and the neck to the cistern.
  const py = (by + hd - cisternD) / 2;
  m.cylinder(0, py, 0, seatZ - 100, brx * 0.6, 16, brx * 0.75, bry * 0.6);
  m.cylinder(0, by, seatZ - 100, seatZ - 10, brx, 20, brx, bry);
  m.box(-brx * 0.65, by, seatZ * 0.35, brx * 0.65, hd - cisternD + 5, seatZ - 10);
  // Seat ring and closed lid.
  m.use(SEAT, 'body', 'seat');
  m.prism(ellipse(0, by, brx, bry, 24), seatZ - 10, seatZ + 8, [ellipse(0, by + 15, brx * 0.62, bry * 0.62, 20)]);
  m.prism(ellipse(0, by + 5, brx - 6, bry - 8, 24), seatZ + 8, seatZ + 28);
  m.box(-60, hd - cisternD - 40, seatZ - 10, 60, hd - cisternD, seatZ + 30);
  m.use(METAL, 'detail');
  m.cylinder(0, hd - cisternD / 2, h - 20, h, 24, 12);
};

const washbasin: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const depth = Math.min(170, h * 0.2);
  m.use(s.primary, 'body');
  m.cylinder(0, hd - 140, 0, h - depth, Math.min(110, hw * 0.4), 16, Math.min(90, hw * 0.33), Math.min(80, hd * 0.35));
  m.tray(
    roundedRect(-hw, -hd, hw, hd, 70, 4),
    roundedRect(-hw + 45, -hd + 40, hw - 45, hd - 100, 60, 4),
    h - depth,
    h - depth + 20,
    h,
  );
  m.use('steel', 'detail');
  m.cylinder(0, -20, h - depth + 20, h - depth + 22, 22, 12);
  tap(m, 0, hd - 70, h, BASIN_TAP_RISE, 140);
};

const vanity: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const legH = Math.min(150, h * 0.18);
  const topT = 30;
  const bw = Math.min(260, (s.w - 300) / 2);
  const basin = roundedRect(-bw, -hd + 70, bw, hd - 140, 60, 4);
  m.use(METAL, 'detail');
  legs(m, hw, hd, 30, 0, legH, 30, true);
  m.use(s.primary, 'body');
  m.box(-hw, -hd + FRONT_ZONE, legH, hw, hd, h - 200);
  m.prism(
    [
      { x: -hw, y: -hd + FRONT_ZONE },
      { x: hw, y: -hd + FRONT_ZONE },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ],
    h - 200,
    h - topT,
    [basin],
  );
  fronts(m, { x0: -hw + 3, x1: hw - 3, z0: legH + 3, z1: h - topT - 3, yFace: -hd + FRONT_ZONE, cols: s.w > 900 ? 2 : 1, rows: 2, frontMat: s.primary, handleMat: METAL, handle: 'bar-h' });
  // Countertop with an integrated basin.
  m.use(s.secondary, 'body', 'basin');
  m.prism(
    [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ],
    h - topT,
    h,
    [basin],
  );
  m.tray(basin, roundedRect(-bw + 12, -hd + 82, bw - 12, hd - 152, 50, 4), h - 185, h - 170, h - 1);
  tap(m, 0, hd - 75, h, BASIN_TAP_RISE, 150);
};

const bathtub: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const wall = Math.min(70, s.d * 0.1);
  const floor = Math.min(120, h * 0.25);
  m.use(s.primary, 'body');
  m.tray(roundedRect(-hw, -hd, hw, hd, 30, 2), roundedRect(-hw + wall, -hd + wall, hw - wall, hd - wall, Math.min(200, s.d * 0.25), 4), 0, floor, h);
  m.use('steel', 'detail');
  m.cylinder(-hw + 260, 0, floor, floor + 2, 30, 12);
  m.cylinderX(-hw + wall - 4, -hw + wall, 0, h - 130, 32, 12);
  m.tube([-hw + wall, 0, h - 60], [-hw + wall + 130, 0, h - 60], 18, 10);
  m.tube([-hw + wall + 130, 0, h - 60], [-hw + wall + 130, 0, h - 100], 16, 10);
};

const shower: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const trayH = 60;
  m.use(s.primary, 'body');
  m.tray(
    [
      { x: -hw, y: -hd },
      { x: hw, y: -hd },
      { x: hw, y: hd },
      { x: -hw, y: hd },
    ],
    roundedRect(-hw + 40, -hd + 40, hw - 40, hd - 40, 30, 3),
    0,
    30,
    trayH,
  );
  m.use('steel', 'detail');
  m.cylinder(0, 0, 30, 32, 45, 12);
  // Glass screens on the front (−y) and left (−x) sides with aluminium profiles.
  m.use(s.secondary, 'glass');
  m.box(-hw + 35, -hd + 20, trayH, hw - 25, -hd + 30, h - 50);
  m.box(-hw + 20, -hd + 35, trayH, -hw + 30, hd - 25, h - 50);
  m.use(METAL, 'frame');
  m.box(-hw + 10, -hd + 10, trayH, -hw + 40, -hd + 40, h - 30);
  m.box(hw - 25, -hd + 12, trayH, hw, -hd + 38, h - 30);
  m.box(-hw + 12, hd - 25, trayH, -hw + 38, hd, h - 30);
  m.box(-hw + 40, -hd + 15, h - 50, hw - 25, -hd + 35, h - 30);
  m.box(-hw + 15, -hd + 40, h - 50, -hw + 35, hd - 25, h - 30);
  m.box(-10, -hd + 2, 900, 10, -hd + 20, 1250);
  // Shower riser, arm and rain head on the back wall; mixer valve.
  m.use('steel', 'detail');
  m.tube([0, hd - 30, 1000], [0, hd - 30, h - 150], 12, 8);
  m.tube([0, hd - 30, h - 150], [0, hd - 300, h - 150], 10, 8);
  m.cylinder(0, hd - 300, h - 175, h - 155, Math.min(110, hw - 60), 16);
  m.cylinderY(hd - 60, hd - 10, 0, 1100, 40, 12);
};

const washingMachine: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  m.use(s.primary, 'body');
  m.box(-hw, -hd + 30, 0, hw, hd, h);
  // Control panel, detergent drawer, display, knob.
  m.use(s.primary, 'panel', 'controls');
  m.box(-hw + 15, -hd + 25, h - 125, hw - 15, -hd + 30, h - 15);
  m.box(-hw + 30, -hd + 20, h - 105, -hw + 200, -hd + 25, h - 40);
  m.use('paint-black', 'detail', 'display');
  m.box(20, -hd + 22, h - 95, 150, -hd + 25, h - 50);
  m.use(METAL, 'detail');
  m.cylinderY(-hd + 5, -hd + 25, hw - 90, h - 70, 30, 16);
  // Porthole door.
  const R = Math.min(hw - 60, (h - 160) / 2 - 20, 230);
  const zc = Math.min(h * 0.43, h - 140 - R);
  m.prismY(ellipse(0, zc, R, R, 28), -hd + 5, -hd + 30, [ellipse(0, zc, R * 0.72, R * 0.72, 28)]);
  m.use('glass-tinted', 'glass', 'door');
  m.prismY(ellipse(0, zc, R * 0.72, R * 0.72, 28), -hd + 12, -hd + 30);
};

export const BATH: Record<string, FurnitureBuilder> = {
  toilet,
  washbasin,
  vanity,
  bathtub,
  shower,
  'washing-machine': washingMachine,
};
