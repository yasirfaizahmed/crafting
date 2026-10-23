/**
 * Plan renderer: draws one level as an architectural floor plan plus the editor overlays.
 * Stateless: everything comes in through RenderScene.
 */
import type { Element, Level, LevelUnderlay, Opening, Room, UnitSystem, Vec2, Wall } from '../../core/types';
import { formatLength } from '../../core/units';
import type { WallFootprint } from '../../core/walls';
import type { GhostState, Handle, HoverTone, OverlayItem } from '../editor-types';
import { elementPolygons } from '../shapes';
import type { Viewport } from '../viewport';
import {
  type DrawCtx,
  drawBeam,
  drawBlock,
  drawColumn,
  drawDimension,
  drawElement,
  drawFurniture,
  drawLabel,
  drawOpening,
  drawRailing,
  drawRoof,
  drawRoomFill,
  drawRoomTag,
  drawStair,
  drawWalls,
} from './elements';
import { drawGrid, drawHandles, drawHUD, drawLiveDim, drawOverlay, drawUnderlay } from './overlay';
import { Painter } from './painter';
import { BELOW_PAL, ghostPalette, HOVER_COLORS, hexA, PAL, UI } from './style';

export interface RenderScene {
  /** Elements to draw (store elements merged with live previews). */
  elements: Record<string, Element>;
  level: Level;
  footprints: Map<string, WallFootprint>;
  below?: { level: Level; elements: Element[]; footprints: Map<string, WallFootprint> } | null;
  selection: ReadonlySet<string>;
  hoverId: string | null;
  hoverTone: HoverTone;
  /** Element hovered in the 3D view (cross-highlight). */
  externalHoverId: string | null;
  ghosts: Element[];
  ghostState: GhostState;
  /** Footprints for ghost walls (computed together with the level's walls). */
  ghostFootprints?: Map<string, WallFootprint> | null;
  overlay: OverlayItem[];
  handles: Handle[];
  hotHandleId: string | null;
  underlay?: { image: CanvasImageSource; u: LevelUnderlay } | null;
  units: UnitSystem;
  showGrid: boolean;
  gridSize: number;
  cursor: Vec2 | null;
  northAngle: number;
  /** All project levels (automatic stairwell openings). */
  levels?: readonly Level[];
}

const ORDER: Partial<Record<Element['type'], number>> = {
  slab: 0,
  room: 1,
  block: 2,
  furniture: 3,
  stair: 4,
  railing: 5,
};

export function renderPlan(g: CanvasRenderingContext2D, view: Viewport, dpr: number, scene: RenderScene): void {
  const p = new Painter(g, view, dpr);
  p.screen();
  g.globalAlpha = 1;
  g.fillStyle = UI.background;
  g.fillRect(0, 0, view.width, view.height);

  if (scene.underlay?.u.visible) drawUnderlay(p, scene.underlay.image, scene.underlay.u);
  if (scene.showGrid) drawGrid(p, scene.gridSize);

  if (scene.below) {
    const bdc: DrawCtx = { p, pal: BELOW_PAL, elements: scene.elements, footprints: scene.below.footprints, level: scene.below.level, units: scene.units, levels: scene.levels };
    drawWalls(bdc, scene.below.elements.filter((e): e is Wall => e.type === 'wall' && !e.hidden), []);
  }

  const levelEls = Object.values(scene.elements).filter((e) => e.levelId === scene.level.id && !e.hidden);
  const dc: DrawCtx = { p, pal: PAL, elements: scene.elements, footprints: scene.footprints, level: scene.level, units: scene.units, levels: scene.levels };

  // Floors, spaces and loose items under the walls.
  const under = levelEls.filter((e) => ORDER[e.type] !== undefined).sort((a, b) => ORDER[a.type]! - ORDER[b.type]!);
  for (const el of under) drawElement(dc, el);

  const walls = levelEls.filter((e): e is Wall => e.type === 'wall');
  const openings = levelEls.filter((e): e is Opening => e.type === 'door' || e.type === 'window');
  drawWalls(dc, walls, openings);
  for (const op of openings) drawOpening(dc, op);
  for (const el of levelEls) if (el.type === 'column') drawColumn(dc, el);
  // Overhead elements, dashed.
  for (const el of levelEls) {
    if (el.type === 'beam') drawBeam(dc, el);
    else if (el.type === 'roof') drawRoof(dc, el);
  }

  // Highlights.
  const highlight = (id: string, color: string, fillAlpha: number, width: number) => {
    const el = scene.elements[id];
    if (!el || el.levelId !== scene.level.id) return;
    p.world();
    g.setLineDash([]);
    g.lineJoin = 'round';
    for (const poly of elementPolygons(el, { elements: scene.elements, footprints: scene.footprints, level: scene.level })) {
      if (poly.length < 2) continue;
      p.path(poly, poly.length > 2);
      if (fillAlpha > 0 && poly.length > 2) {
        g.fillStyle = hexA(color, fillAlpha);
        g.fill();
      }
      g.strokeStyle = color;
      p.lw(width);
      g.stroke();
    }
    if (el.type === 'wall') {
      p.dash([6, 4]);
      p.lw(1);
      p.line(el.start, el.end);
      p.dash(null);
    }
  };
  if (scene.externalHoverId && !scene.selection.has(scene.externalHoverId)) highlight(scene.externalHoverId, HOVER_COLORS.pick, 0.1, 1.5);
  for (const id of scene.selection) highlight(id, UI.accent, 0.12, 2);
  // Length of selected walls, CAD-style, outside the wall.
  if (scene.selection.size <= 6) {
    for (const id of scene.selection) {
      const w = scene.elements[id];
      if (w?.type !== 'wall' || w.levelId !== scene.level.id) continue;
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      if (len * view.scale < 40) continue;
      drawLiveDim(p, w.start, w.end, -((w.thickness / 2) * view.scale + 18), formatLength(len, scene.units), 'accent');
    }
  }
  if (scene.hoverId && (!scene.selection.has(scene.hoverId) || scene.hoverTone !== 'normal')) {
    const color = HOVER_COLORS[scene.hoverTone];
    highlight(scene.hoverId, color, scene.hoverTone === 'normal' ? 0.07 : 0.16, 1.5);
  }

  // Ghost previews.
  if (scene.ghosts.length) {
    const gpal = ghostPalette(scene.ghostState);
    const gdc: DrawCtx = { ...dc, pal: gpal, footprints: scene.ghostFootprints ?? scene.footprints };
    const elements = { ...scene.elements };
    for (const gh of scene.ghosts) elements[gh.id] = gh;
    gdc.elements = elements;
    const gWalls = scene.ghosts.filter((e): e is Wall => e.type === 'wall');
    if (gWalls.length) drawWalls(gdc, gWalls, []);
    for (const gh of scene.ghosts) {
      if (gh.type === 'wall') continue;
      if (gh.type === 'door' || gh.type === 'window') drawOpening(gdc, gh, true);
      else if (gh.type === 'room') {
        drawRoomFill(gdc, gh);
        p.world();
        p.path(gh.outline);
        g.strokeStyle = gpal.line;
        p.lw(1.2);
        p.dash([6, 4]);
        g.stroke();
        p.dash(null);
      } else if (gh.type === 'slab') {
        p.world();
        p.path(gh.outline);
        g.fillStyle = gpal.furnitureFill;
        g.fill();
        g.strokeStyle = gpal.line;
        p.lw(1.2);
        g.stroke();
      } else if (gh.type === 'stair') drawStair(gdc, gh, false);
      else if (gh.type === 'column') drawColumn(gdc, gh);
      else if (gh.type === 'beam') drawBeam(gdc, gh);
      else if (gh.type === 'railing') drawRailing(gdc, gh);
      else if (gh.type === 'furniture') drawFurniture(gdc, gh);
      else if (gh.type === 'block') drawBlock(gdc, gh);
      else if (gh.type === 'roof') drawRoof(gdc, gh);
      else drawElement(gdc, gh);
    }
  }

  // Text layer.
  for (const el of levelEls) if (el.type === 'room') drawRoomTag(dc, el as Room);
  for (const el of levelEls) {
    if (el.type === 'dimension') drawDimension(dc, el);
    else if (el.type === 'label') drawLabel(dc, el);
  }

  drawHandles(p, scene.handles, scene.hotHandleId);
  drawOverlay(p, scene.overlay, scene.units);
  drawHUD(p, { units: scene.units, cursor: scene.cursor, northAngle: scene.northAngle });
  p.screen();
}

