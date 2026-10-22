import { WHITE, type FurnitureBuilder } from './kit';

const ceilingLight: FurnitureBuilder = (m, s) => {
  const r = Math.min(s.w, s.d) / 2;
  m.use(WHITE, 'body', 'mount');
  m.cylinder(0, 0, s.h - 20, s.h, r * 0.6, 20);
  m.use(s.primary, 'light', 'diffuser');
  m.cylinder(0, 0, 0, s.h * 0.35, r * 0.78, 24, r * 0.97);
  m.cylinder(0, 0, s.h * 0.35, s.h - 20, r * 0.97, 24, r * 0.85);
  return { light: [0, 0, -60] };
};

const pendantLight: FurnitureBuilder = (m, s) => {
  const r = Math.min(s.w, s.d) / 2;
  const h = s.h;
  const shadeBottom = Math.min(110, h * 0.2);
  const shadeTop = Math.min(h - 60, shadeBottom + r * 1.1);
  m.use(s.primary, 'body');
  m.cylinder(0, 0, h - 25, h, Math.min(60, r * 0.4), 16);
  m.cylinder(0, 0, (shadeBottom + shadeTop) / 2, shadeTop, r * 0.78, 20, r * 0.3);
  m.cylinder(0, 0, shadeBottom, (shadeBottom + shadeTop) / 2, r, 20, r * 0.78);
  m.use('paint-black', 'detail', 'cord');
  m.cylinder(0, 0, shadeTop, h - 25, 4, 6);
  const glow = s.secondary;
  m.use(glow, 'light', 'bulb');
  m.cylinder(0, 0, shadeBottom - 8, shadeBottom, r - 10, 20);
  m.sphere(0, 0, shadeBottom - 25, Math.min(45, r * 0.4), Math.min(45, r * 0.4), Math.min(45, shadeBottom - 30), 12, 8);
  return { light: [0, 0, Math.max(0, shadeBottom - 80)] };
};

const floorLamp: FurnitureBuilder = (m, s) => {
  const r = Math.min(s.w, s.d) / 2;
  const h = s.h;
  const shadeH = Math.min(330, h * 0.22);
  m.use(s.primary, 'body');
  m.cylinder(0, 0, 0, 25, r * 0.85, 24, r * 0.75);
  m.cylinder(0, 0, 25, h - shadeH + 40, 12, 10);
  m.use(s.secondary, 'light', 'shade');
  m.cylinder(0, 0, h - shadeH, h, r - 2, 24, (r - 2) * 0.72);
  return { light: [0, 0, h - shadeH - 60] };
};

const wallLight: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  m.use(s.primary, 'body');
  m.box(-Math.min(45, hw), hd - 15, h * 0.2, Math.min(45, hw), hd, h * 0.6);
  m.bar([0, hd - 15, h * 0.4], [0, -8, h * 0.4], 22);
  const rTop = Math.min(hw - 2, (hd + hd - 15) / 2 - 2);
  const cy = -hd + rTop + 2;
  m.cylinder(0, cy, h * 0.3, h * 0.42, rTop * 0.55, 16, rTop * 0.75);
  m.use(s.secondary, 'light', 'shade');
  m.cylinder(0, cy, h * 0.42, h, rTop * 0.75, 20, rTop);
  return { light: [0, -hd - 80, h * 0.6] };
};

export const LIGHTING: Record<string, FurnitureBuilder> = {
  'ceiling-light': ceilingLight,
  'pendant-light': pendantLight,
  'floor-lamp': floorLamp,
  'wall-light': wallLight,
};
