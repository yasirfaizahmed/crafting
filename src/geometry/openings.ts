/**
 * Doors and windows, modelled in an opening-local frame:
 *   x along the host wall (0 = opening centre), y across the thickness towards the wall's LEFT side
 *   (0 = middle of the wall body), z up from the bottom of the opening.
 * The opening is clipped to the host wall like the cut in the wall itself, so frames always fit
 * the hole.
 */
import { angleDeg, dot, sub } from '../core/math2d';
import { getMaterial, hasMaterial } from '../core/materials';
import type { Door, Opening, Window } from '../core/types';
import { levelCenter } from './cache';
import { Model, placement } from './model';
import type { GeometryContext, GeometryPart } from './types';
import { openingRect, wallFrame, wallPoint, type WallFrame } from './walls';

export interface OpeningFrame {
  wall: WallFrame;
  /** Clipped opening width / height and wall thickness (mm). */
  width: number;
  height: number;
  thickness: number;
  /** Room left between the opening and the wall ends / top (for casings). */
  marginStart: number;
  marginEnd: number;
  marginTop: number;
  /** +1 if the wall's left side (+y) faces the building interior, else −1. */
  interior: 1 | -1;
  model: Model;
}

const isGlass = (id: string | undefined): id is string => !!id && hasMaterial(id) && getMaterial(id).category === 'glass';
const valid = (id: string | undefined): id is string => !!id && hasMaterial(id);

export function openingFrame(ctx: GeometryContext, op: Opening): OpeningFrame | null {
  const host = ctx.project.elements[op.hostId];
  if (!host || host.type !== 'wall') return null;
  const wf = wallFrame(ctx, host);
  if (!wf) return null;
  const r = openingRect(op, wf.height);
  if (!r) return null;
  const x0 = Math.max(0, r.x0);
  const x1 = Math.min(wf.length, r.x1);
  if (x1 - x0 < 20 || r.y1 - r.y0 < 20) return null;
  const thickness = wf.left - wf.right;
  const mid = (wf.left + wf.right) / 2;
  const c = wallPoint(wf, (x0 + x1) / 2, mid, r.y0);
  const center = levelCenter(ctx, host.levelId);
  let interior: 1 | -1 = 1;
  if (center) {
    const s = dot(sub(center, { x: c[0], y: c[1] }), wf.nrm);
    if (s < -1e-6) interior = -1;
  }
  return {
    wall: wf,
    width: x1 - x0,
    height: r.y1 - r.y0,
    thickness,
    marginStart: x0,
    marginEnd: wf.length - x1,
    marginTop: wf.height - r.y1,
    interior,
    model: new Model(placement(c[0], c[1], c[2], angleDeg(wf.dir))),
  };
}

// -----------------------------------------------------------------------------
// Doors
// -----------------------------------------------------------------------------

const FRAME = 35; // lining thickness along x
const HANDLE_MAT = 'aluminium';

export function buildDoor(ctx: GeometryContext, d: Door): GeometryPart[] {
  if (d.style === 'opening') return [];
  const f = openingFrame(ctx, d);
  if (!f) return [];
  const metalFrame = d.style === 'sliding' || d.style === 'garage';
  const frameMat = valid(d.frameMaterialId) ? d.frameMaterialId : metalFrame ? 'aluminium' : 'paint-white';
  const glassMat = isGlass(d.materialId) ? d.materialId : 'glass-clear';
  const leafMat = valid(d.materialId) ? d.materialId : d.style === 'garage' ? 'aluminium' : 'wood-oak';
  switch (d.style) {
    case 'sliding':
      slidingDoor(f, frameMat, glassMat, d);
      break;
    case 'garage':
      garageDoor(f, frameMat, isGlass(leafMat) ? 'aluminium' : leafMat);
      break;
    case 'pocket':
      lining(f, frameMat, true);
      pocketLeaf(f, leafMat);
      break;
    case 'double':
      lining(f, frameMat, true);
      swingLeaves(f, d, leafMat, 2);
      break;
    default:
      lining(f, frameMat, true);
      swingLeaves(f, d, leafMat, 1);
  }
  return f.model.parts();
}

/** Jambs + head through the full wall thickness, plus architraves on both faces. */
function lining(f: OpeningFrame, mat: string, casings: boolean, fw = FRAME): void {
  const m = f.model;
  const W = f.width / 2;
  const T = f.thickness / 2;
  const H = f.height;
  m.use(mat, 'frame');
  m.box(-W, -T, 0, -W + fw, T, H);
  m.box(W - fw, -T, 0, W, T, H);
  m.box(-W + fw, -T, H - fw, W - fw, T, H);
  if (!casings || f.thickness < 60) return;
  const cw = 65;
  const ct = 15;
  const left = Math.min(cw - 10, f.marginStart);
  const right = Math.min(cw - 10, f.marginEnd);
  const top = Math.min(cw - 10, f.marginTop);
  for (const s of [1, -1]) {
    const y0 = s * T;
    const y1 = s * (T + ct);
    m.box(-W - left, y0, 0, -W + 10, y1, H + top);
    m.box(W - 10, y0, 0, W + right, y1, H + top);
    m.box(-W + 10, y0, H - 10, W - 10, y1, H + top);
  }
}

/** Raised panels on both faces of a leaf spanning x0..x1, y0..y1, z0..z1. */
function leafWithPanels(m: Model, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: string): void {
  if (isGlass(mat)) {
    m.use(mat, 'glass');
    m.box(x0, y0, z0, x1, y1, z1);
    return;
  }
  m.use(mat, 'panel');
  m.box(x0, y0, z0, x1, y1, z1);
  const wdt = x1 - x0;
  const hgt = z1 - z0;
  const inset = Math.min(110, wdt * 0.18);
  if (wdt - 2 * inset < 80 || hgt < 900) return;
  const zs: [number, number][] = [
    [z0 + hgt * 0.1, z0 + hgt * 0.45],
    [z0 + hgt * 0.53, z0 + hgt * 0.9],
  ];
  for (const [a, b] of zs) {
    m.box(x0 + inset, y0 - 6, a, x1 - inset, y0, b);
    m.box(x0 + inset, y1, a, x1 - inset, y1 + 6, b);
  }
}

function leverHandle(m: Model, x: number, towards: number, y0: number, y1: number, z: number): void {
  m.use(HANDLE_MAT, 'detail');
  for (const [face, s] of [
    [y0, -1],
    [y1, 1],
  ] as const) {
    m.cylinderY(Math.min(face, face + s * 10), Math.max(face, face + s * 10), x, z, 26, 12);
    const yo = face + s * 10;
    m.cylinderY(Math.min(yo, yo + s * 45), Math.max(yo, yo + s * 45), x, z, 9, 8);
    const ye = yo + s * 45;
    m.box(x, Math.min(ye - s * 18, ye), z - 9, x + towards * 125, Math.max(ye - s * 18, ye), z + 9);
  }
}

/** Swing leaves (1 or 2) in the closed position, on the side they swing towards. */
function swingLeaves(f: OpeningFrame, d: Door, mat: string, count: 1 | 2): void {
  const m = f.model;
  const W = f.width / 2 - FRAME;
  const T = f.thickness / 2;
  const lt = Math.min(40, f.thickness * 0.6);
  const swing = d.flip ? -1 : 1; // leaf sits toward the side it opens to
  const inset = Math.max(0, Math.min(12, T - lt));
  const yA = swing > 0 ? T - inset - lt : -T + inset;
  const yB = yA + lt;
  const z0 = 10;
  const z1 = f.height - FRAME - 3;
  if (z1 - z0 < 100 || W < 50) return;
  const hingeSide = d.hinge === 'left' ? 1 : -1; // hinge 'left' (seen from the left side) is at +x
  const gap = 3;
  const leaves: { x0: number; x1: number; hinge: number }[] =
    count === 1
      ? [{ x0: -W + gap, x1: W - gap, hinge: hingeSide }]
      : [
          { x0: -W + gap, x1: -gap / 2, hinge: -1 },
          { x0: gap / 2, x1: W - gap, hinge: 1 },
        ];
  const zh = Math.min(1000, z0 + (z1 - z0) * 0.48);
  for (const l of leaves) {
    leafWithPanels(m, l.x0, l.x1, yA, yB, z0, z1, mat);
    const handleX = l.hinge > 0 ? l.x0 + 65 : l.x1 - 65;
    if (l.x1 - l.x0 > 250) leverHandle(m, handleX, l.hinge, yA, yB, zh);
    // Hinge knuckles on the swing face at the hinge edge.
    m.use(HANDLE_MAT, 'detail');
    const hx = l.hinge > 0 ? l.x1 : l.x0;
    const hy = swing > 0 ? yB : yA;
    for (const z of [z0 + 200, (z0 + z1) / 2, z1 - 250]) m.cylinder(hx, hy, z, z + 100, 8, 8);
  }
}

function pocketLeaf(f: OpeningFrame, mat: string): void {
  const m = f.model;
  const W = f.width / 2 - FRAME;
  const lt = Math.min(40, f.thickness * 0.5);
  const z1 = f.height - FRAME - 3;
  if (z1 < 150 || W < 50) return;
  leafWithPanels(m, -W + 2, W - 2, -lt / 2, lt / 2, 10, z1, mat);
  // Recessed flush pulls (shown as small plates) near the leading edge on both faces.
  m.use(HANDLE_MAT, 'detail');
  const x = W - 70;
  const z = Math.min(1000, z1 * 0.48);
  m.box(x - 15, -lt / 2 - 3, z - 60, x + 15, -lt / 2, z + 60);
  m.box(x - 15, lt / 2, z - 60, x + 15, lt / 2 + 3, z + 60);
}

/** Aluminium sash with a glass infill. */
function glazedSash(
  m: Model,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  frameMat: string,
  glassMat: string,
  stile: number,
  bottomRail = stile,
): void {
  const s = Math.min(stile, (x1 - x0) / 3, (z1 - z0) / 3);
  const br = Math.min(bottomRail, (z1 - z0) / 3);
  m.use(frameMat, 'frame');
  m.box(x0, y0, z0, x0 + s, y1, z1);
  m.box(x1 - s, y0, z0, x1, y1, z1);
  m.box(x0 + s, y0, z0, x1 - s, y1, z0 + br);
  m.box(x0 + s, y0, z1 - s, x1 - s, y1, z1);
  const gy = (y0 + y1) / 2;
  const gt = Math.min(10, (y1 - y0) * 0.5);
  m.use(glassMat, 'glass');
  m.box(x0 + s, gy - gt / 2, z0 + br, x1 - s, gy + gt / 2, z1 - s);
}

function slidingDoor(f: OpeningFrame, frameMat: string, glassMat: string, d: Door): void {
  const m = f.model;
  const fw = 50;
  lining(f, frameMat, false, fw);
  const W = f.width / 2 - fw;
  const T = f.thickness / 2;
  const H = f.height;
  // Bottom track.
  m.use(frameMat, 'frame');
  m.box(-W, -T, 0, W, T, 18);
  const depth = Math.min(40, f.thickness / 2 - 6);
  const gap = Math.min(10, f.thickness / 2 - depth);
  const overlap = 60;
  const pw = Math.min(W * 2, W + overlap / 2);
  const z0 = 18;
  const z1 = H - fw;
  if (z1 - z0 < 100 || W < 60 || depth < 4) return;
  // Panel A slides on the left (+y) track, panel B on the right (−y) track.
  const fixedFirst = d.hinge === 'left';
  const panels = [
    { x0: -W, x1: -W + pw, y0: gap / 2, y1: gap / 2 + depth },
    { x0: W - pw, x1: W, y0: -gap / 2 - depth, y1: -gap / 2 },
  ];
  if (!fixedFirst) {
    panels[0].y0 = -gap / 2 - depth;
    panels[0].y1 = -gap / 2;
    panels[1].y0 = gap / 2;
    panels[1].y1 = gap / 2 + depth;
  }
  for (const p of panels) glazedSash(m, p.x0, p.x1, p.y0, p.y1, z0, z1, frameMat, glassMat, 55, 90);
  // Vertical pull bars on the meeting stiles, on the outer face of each panel.
  m.use('metal-black', 'detail');
  const zp0 = Math.min(z1 - 100, 750);
  const zp1 = Math.min(z1 - 20, 1350);
  if (zp1 > zp0) {
    const a = panels[0];
    const b = panels[1];
    const ya = a.y0 > 0 ? a.y1 : a.y0;
    const yb = b.y0 > 0 ? b.y1 : b.y0;
    m.box(a.x1 - 45, Math.min(ya, ya + Math.sign(ya) * 22), zp0, a.x1 - 25, Math.max(ya, ya + Math.sign(ya) * 22), zp1);
    m.box(b.x0 + 25, Math.min(yb, yb + Math.sign(yb) * 22), zp0, b.x0 + 45, Math.max(yb, yb + Math.sign(yb) * 22), zp1);
  }
}

/** Sectional garage door: horizontal panels with grooves, mounted near the interior face. */
function garageDoor(f: OpeningFrame, frameMat: string, panelMat: string): void {
  const m = f.model;
  const fw = 60;
  lining(f, frameMat, false, fw);
  const W = f.width / 2 - fw;
  const T = f.thickness / 2;
  const H = f.height - fw;
  if (W < 50 || H < 200) return;
  const depth = Math.min(45, f.thickness * 0.4);
  const back = f.interior > 0 ? T - Math.min(15, T - depth) : -T + Math.min(15, T - depth);
  const yb0 = Math.min(back, back - f.interior * depth);
  const yb1 = Math.max(back, back - f.interior * depth);
  const n = Math.max(3, Math.round(H / 550));
  const sh = H / n;
  const groove = 10;
  const recess = Math.min(16, depth / 2);
  m.use(panelMat, 'panel');
  // Backing skin (groove bottoms) + proud section faces.
  const skin0 = f.interior > 0 ? yb0 + recess : yb0;
  const skin1 = f.interior > 0 ? yb1 : yb1 - recess;
  m.box(-W, skin0, 0, W, skin1, H);
  for (let i = 0; i < n; i++) {
    const z0 = i * sh + (i === 0 ? 0 : groove / 2);
    const z1 = (i + 1) * sh - (i === n - 1 ? 0 : groove / 2);
    if (f.interior > 0) m.box(-W, yb0, z0, W, yb0 + recess, z1);
    else m.box(-W, yb1 - recess, z0, W, yb1, z1);
  }
  // Lift handle on the exterior face of the bottom section.
  m.use('metal-black', 'detail');
  const yOut = f.interior > 0 ? yb0 : yb1;
  const s = -f.interior;
  m.box(-90, Math.min(yOut, yOut + s * 25), sh * 0.45, 90, Math.max(yOut, yOut + s * 25), sh * 0.45 + 30);
}

// -----------------------------------------------------------------------------
// Windows
// -----------------------------------------------------------------------------

export function buildWindow(ctx: GeometryContext, win: Window): GeometryPart[] {
  const f = openingFrame(ctx, win);
  if (!f) return [];
  const m = f.model;
  const frameMat = valid(win.frameMaterialId) ? win.frameMaterialId : valid(win.materialId) && !isGlass(win.materialId) ? win.materialId : 'paint-white';
  const glassMat = isGlass(win.materialId) ? win.materialId : 'glass-clear';
  const W = f.width / 2;
  const H = f.height;
  const T = f.thickness / 2;
  const fd = Math.min(90, f.thickness);
  const fy0 = -fd / 2;
  const fy1 = fd / 2;
  const fw = Math.min(60, f.width / 6, H / 6);

  // Outer frame.
  m.use(frameMat, 'frame');
  m.box(-W, fy0, 0, -W + fw, fy1, H);
  m.box(W - fw, fy0, 0, W, fy1, H);
  m.box(-W + fw, fy0, 0, W - fw, fy1, fw);
  m.box(-W + fw, fy0, H - fw, W - fw, fy1, H);
  const ix0 = -W + fw;
  const ix1 = W - fw;
  const iz0 = fw;
  const iz1 = H - fw;
  const sd = Math.min(56, fd * 0.6);
  const sash = (x0: number, x1: number, z0: number, z1: number, y0 = -sd / 2, y1 = sd / 2) =>
    glazedSash(m, x0, x1, y0, y1, z0, z1, frameMat, glassMat, Math.min(55, (x1 - x0) / 4));
  const mullion = (x: number) => {
    m.use(frameMat, 'frame');
    m.box(x - fw / 2, fy0, iz0, x + fw / 2, fy1, iz1);
  };
  const handle = (x: number, z: number) => {
    m.use(HANDLE_MAT, 'detail');
    const yi = f.interior * (sd / 2);
    m.box(x - 12, Math.min(yi, yi + f.interior * 30), z - 60, x + 12, Math.max(yi, yi + f.interior * 30), z + 60);
  };

  if (ix1 - ix0 > 40 && iz1 - iz0 > 40) {
    const iw = ix1 - ix0;
    switch (win.style) {
      case 'fixed': {
        const n = Math.max(1, Math.ceil(iw / 1200));
        const pw = (iw - (n - 1) * fw) / n;
        for (let i = 0; i < n; i++) {
          const x0 = ix0 + i * (pw + fw);
          m.use(glassMat, 'glass');
          m.box(x0, -5, iz0, x0 + pw, 5, iz1);
          if (i > 0) mullion(x0 - fw / 2);
        }
        break;
      }
      case 'sliding': {
        const overlap = 40;
        const pw = Math.min(iw, (iw + overlap) / 2);
        const g = 4;
        const half = Math.min(sd / 2, fd / 2 - g);
        sash(ix0, ix0 + pw, iz0, iz1, g / 2, g / 2 + half);
        sash(ix1 - pw, ix1, iz0, iz1, -g / 2 - half, -g / 2);
        // Latch on the meeting stile of the interior-side sash.
        m.use(HANDLE_MAT, 'detail');
        const hx = f.interior > 0 ? ix0 + pw - 30 : ix1 - pw + 30;
        const yi = f.interior * (g / 2 + half);
        const zc = (iz0 + iz1) / 2;
        m.box(hx - 10, Math.min(yi, yi + f.interior * 25), zc - 50, hx + 10, Math.max(yi, yi + f.interior * 25), zc + 50);
        break;
      }
      case 'double-hung': {
        const overlap = 40;
        const ph = Math.min(iz1 - iz0, (iz1 - iz0 + overlap) / 2);
        const g = 4;
        const half = Math.min(sd / 2, fd / 2 - g);
        sash(ix0, ix1, iz0, iz0 + ph, f.interior > 0 ? g / 2 : -g / 2 - half, f.interior > 0 ? g / 2 + half : -g / 2);
        sash(ix0, ix1, iz1 - ph, iz1, f.interior > 0 ? -g / 2 - half : g / 2, f.interior > 0 ? -g / 2 : g / 2 + half);
        m.use(HANDLE_MAT, 'detail');
        const yi = f.interior * (g / 2 + half);
        const zc = iz0 + ph - 30;
        m.box(-40, Math.min(yi, yi + f.interior * 18), zc - 10, 40, Math.max(yi, yi + f.interior * 18), zc + 10);
        break;
      }
      case 'awning': {
        sash(ix0, ix1, iz0, iz1);
        handle(0, iz0 + 90);
        break;
      }
      default: {
        // Casement: one sash up to ~900 mm wide, otherwise two (or more) with mullions.
        const n = Math.max(1, Math.round(iw / 800));
        const pw = (iw - (n - 1) * fw) / n;
        for (let i = 0; i < n; i++) {
          const x0 = ix0 + i * (pw + fw);
          sash(x0 + 2, x0 + pw - 2, iz0 + 2, iz1 - 2);
          if (i > 0) mullion(x0 - fw / 2);
          // Handle on the opening edge: away from the frame jamb it is hinged on.
          const hingeLeft = n === 1 || i < n / 2;
          handle(hingeLeft ? x0 + pw - 40 : x0 + 40, (iz0 + iz1) / 2);
        }
      }
    }
  }

  // Interior sill board and exterior sill.
  if (f.thickness - fd > 10) {
    m.use(frameMat, 'frame');
    const s = f.interior;
    const inner = s > 0 ? fy1 : fy0;
    const outer = -inner;
    const ext = 40;
    const horn = (side: 'start' | 'end') => Math.min(40, side === 'start' ? f.marginStart : f.marginEnd);
    m.box(-W - horn('start'), Math.min(inner, s * (T + 25)), 0, W + horn('end'), Math.max(inner, s * (T + 25)), 25);
    m.box(-W - horn('start'), Math.min(outer, -s * (T + ext)), 0, W + horn('end'), Math.max(outer, -s * (T + ext)), 20);
  }
  return m.parts();
}
