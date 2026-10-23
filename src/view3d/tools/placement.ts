/**
 * Single-click placement tools with a live ghost: furniture, stairs, columns and voxel blocks.
 * R rotates the ghost 90° (Shift+R −15°).
 */
import { getFurniture } from '../../core/catalog';
import { createFromCatalog } from '../../core/defaults';
import { add, normalize, radToDeg, rotate, scale, sub } from '../../core/math2d';
import type { Block, Element, Project, Vec2, Vec3 } from '../../core/types';
import { formatLength } from '../../core/units';
import { pointAtOffset, projectOntoWall, wallFaceOffsets, wallLength, wallNormal, wallsOnLevel } from '../../core/walls';
import { commitPlacement, resolveBuildTarget, targetLevelId, type BuildTarget } from './levels';
import { snapDeg, snapToGrid } from './snapping';
import type { KeyInput, PickHit, Tool, ToolEnv } from './types';

export interface Placement {
  element: Element;
  target: BuildTarget;
  valid: boolean;
  reason?: string;
  /** Short text for the floating label. */
  info?: string;
}

const norm360 = (d: number): number => ((Math.round(d * 1000) / 1000) % 360 + 360) % 360;

/** Furniture rotation (deg) whose front (local −y) faces from `pos` toward `player`, snapped to `step`. */
export function facePlayerRotation(pos: Vec2, player: Vec2, step = 90): number {
  const d = sub(player, pos);
  if (Math.hypot(d.x, d.y) < 1) return 0;
  return snapDeg(radToDeg(Math.atan2(d.x, -d.y)), step);
}

/** Rotation (deg) whose front (local −y) points along plan direction `n`. */
export function rotationFacing(n: Vec2): number {
  return norm360(radToDeg(Math.atan2(n.x, -n.y)));
}

/**
 * Snap a footprint (width × depth, back = local +y) against the nearest wall face within
 * `maxGap` mm: the back touches the face and the front looks into the room.
 */
export function autoBackToWall(
  project: Pick<Project, 'elements'>,
  levelId: string,
  pos: Vec2,
  width: number,
  depth: number,
  maxGap = 300,
): { position: Vec2; rotation: number; wallId: string } | null {
  let best: { position: Vec2; rotation: number; wallId: string } | null = null;
  let bestGap = Infinity;
  for (const w of wallsOnLevel(project, levelId)) {
    if (w.hidden) continue;
    const len = wallLength(w);
    if (len < 1) continue;
    const proj = projectOntoWall(w, pos);
    if (proj.offset < 0 || proj.offset > len) continue;
    const faces = wallFaceOffsets(w);
    let face: number;
    let sign: number;
    let gap: number;
    if (proj.lateral > faces.left) {
      face = faces.left;
      sign = 1;
      gap = proj.lateral - faces.left - depth / 2;
    } else if (proj.lateral < faces.right) {
      face = faces.right;
      sign = -1;
      gap = faces.right - proj.lateral - depth / 2;
    } else continue;
    if (gap > maxGap || gap < -depth || gap >= bestGap) continue;
    bestGap = gap;
    const along = len >= width ? Math.min(len - width / 2, Math.max(width / 2, proj.offset)) : proj.offset;
    const n = scale(wallNormal(w), sign);
    best = { position: pointAtOffset(w, along, face + sign * (depth / 2 + 1)), rotation: rotationFacing(n), wallId: w.id };
  }
  return best;
}

/** Min corner of a block's plan bounding box (rotations in 90° steps keep cells aligned). */
export function blockCellMin(b: Pick<Block, 'position' | 'size' | 'rotation'>): Vec3 {
  const c = add({ x: b.position.x, y: b.position.y }, rotate({ x: b.size.x / 2, y: b.size.y / 2 }, b.rotation));
  const r = Math.abs(Math.round(b.rotation / 90)) % 2 === 1;
  const sx = r ? b.size.y : b.size.x;
  const sy = r ? b.size.x : b.size.y;
  return { x: round1(c.x - sx / 2), y: round1(c.y - sy / 2), z: b.position.z };
}

/** Block `position` that puts a block of `size` rotated by `rotation` into the cell with min corner `cell`. */
export function blockPositionForCell(cell: Vec3, size: Vec3, rotation: number): Vec3 {
  const r = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const sx = r ? size.y : size.x;
  const sy = r ? size.x : size.y;
  const centre = { x: cell.x + sx / 2, y: cell.y + sy / 2 };
  const p = sub(centre, rotate({ x: size.x / 2, y: size.y / 2 }, rotation));
  return { x: round1(p.x), y: round1(p.y), z: cell.z };
}

const isAxisAligned = (deg: number): boolean => Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-6;

/**
 * TRUE voxel stacking: on a block face the new block goes next to it along the face normal;
 * elsewhere it fills the `size` cell under the pointer (sitting on floors, stepping out of walls).
 * Returns the min corner of the new block's cell (z relative to the target level).
 */
export function voxelCell(project: Pick<Project, 'elements' | 'levels' | 'settings'>, hit: PickHit, size: Vec3): { cell: Vec3; target: BuildTarget } {
  const hitEl = hit.elementId ? project.elements[hit.elementId] : undefined;
  if (hitEl?.type === 'block' && isAxisAligned(hitEl.rotation)) {
    const lvl = project.levels.find((l) => l.id === hitEl.levelId)!;
    const min = blockCellMin(hitEl);
    const r = Math.abs(Math.round(hitEl.rotation / 90)) % 2 === 1;
    const hs = { x: r ? hitEl.size.y : hitEl.size.x, y: r ? hitEl.size.x : hitEl.size.y, z: hitEl.size.z };
    const n = hit.normal;
    const cell = { ...min };
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    if (az >= ax && az >= ay) cell.z = n.z > 0 ? min.z + hs.z : min.z - size.z;
    else if (ax >= ay) cell.x = n.x > 0 ? min.x + hs.x : min.x - size.x;
    else cell.y = n.y > 0 ? min.y + hs.y : min.y - size.y;
    return { cell, target: { levelId: lvl.id, levelElevation: lvl.elevation, levelHeight: lvl.height, offset: 0 } };
  }
  const target = resolveBuildTarget(project, hit);
  const n = hit.normal;
  const fl = (v: number, s: number) => Math.floor(v / s + 1e-9) * s;
  if (n.z > 0.7) {
    return { cell: { x: fl(hit.point.x, size.x), y: fl(hit.point.y, size.y), z: target.offset }, target };
  }
  const rel = hit.elevation - target.levelElevation;
  if (n.z < -0.7) {
    return { cell: { x: fl(hit.point.x, size.x), y: fl(hit.point.y, size.y), z: rel - size.z }, target };
  }
  const h = normalize({ x: n.x, y: n.y });
  const q = add(hit.point, { x: (h.x * size.x) / 2, y: (h.y * size.y) / 2 });
  return { cell: { x: fl(q.x, size.x), y: fl(q.y, size.y), z: Math.max(0, fl(rel, size.z)) }, target };
}

/** True if an axis-aligned block of `size` at cell `cell` overlaps another block on the level. */
export function blockOccupied(project: Pick<Project, 'elements'>, levelId: string | undefined, cell: Vec3, size: Vec3, rotation: number): boolean {
  if (!levelId) return false;
  const r = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const s = { x: r ? size.y : size.x, y: r ? size.x : size.y, z: size.z };
  const t = 1;
  return Object.values(project.elements).some((e) => {
    if (e.type !== 'block' || e.levelId !== levelId || !isAxisAligned(e.rotation)) return false;
    const m = blockCellMin(e);
    const er = Math.abs(Math.round(e.rotation / 90)) % 2 === 1;
    const es = { x: er ? e.size.y : e.size.x, y: er ? e.size.x : e.size.y, z: e.size.z };
    return (
      cell.x < m.x + es.x - t && m.x < cell.x + s.x - t && cell.y < m.y + es.y - t && m.y < cell.y + s.y - t && cell.z < m.z + es.z - t && m.z < cell.z + s.z - t
    );
  });
}

abstract class PlacementTool implements Tool {
  protected rot = 0;
  protected lastHit: PickHit | null = null;

  constructor(protected readonly env: ToolEnv) {}

  protected abstract plan(hit: PickHit): Placement | null;
  protected abstract readonly undoLabel: string;

  protected get noun(): string {
    return this.env.item.name;
  }

  hover(hit: PickHit | null): void {
    this.lastHit = hit;
    const { ghost } = this.env;
    const p = hit ? this.plan(hit) : null;
    if (!p) {
      ghost.clear();
      this.env.hint(`${this.noun}: point at a floor or surface`);
      return;
    }
    ghost.show([p.element], p.valid, { extraLevels: p.target.create ? [p.target.create] : undefined });
    ghost.marker(null);
    ghost.label(p.info ?? null, p.info && hit ? { point: hit.point, elevation: hit.elevation + 300 } : undefined);
    this.env.hint(p.valid ? `RMB: place ${this.noun} · R rotate (Shift+R 15°)${this.extraHint} · LMB break` : (p.reason ?? 'Cannot place here'));
  }

  /** Tool-specific key help appended to the hint. */
  protected get extraHint(): string {
    return '';
  }

  use(hit: PickHit | null): void {
    if (!hit) return;
    const p = this.plan(hit);
    if (!p) return;
    if (!p.valid) {
      this.env.toast(p.reason ?? 'Cannot place here', 'warning');
      return;
    }
    const els = commitPlacement(this.env, this.undoLabel, p.target, (levelId) => [{ ...p.element, levelId } as Element]);
    if (els) this.env.effect('place', { point: hit.point, elevation: hit.elevation });
    this.hover(hit);
  }

  key(e: KeyInput): boolean {
    if (e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey) return false;
    this.rot = norm360(this.rot + (e.shiftKey ? -15 : 90));
    this.hover(this.lastHit);
    return true;
  }

  cancel(): boolean {
    return false;
  }

  dispose(): void {
    this.env.ghost.clear();
  }

  protected snapStep(fine: number): number {
    return this.env.ctx.ui.get().snapGrid ? fine : 10;
  }
}

export class FurnitureTool extends PlacementTool {
  protected readonly undoLabel = 'Place furniture';

  protected plan(hit: PickHit): Placement | null {
    const project = this.env.ctx.store.project;
    const catalogId = String(this.env.item.template?.catalogId ?? '');
    const def = getFurniture(catalogId);
    const w = def?.width ?? 1000;
    const d = def?.depth ?? 1000;
    const target = resolveBuildTarget(project, hit);
    const levelId = targetLevelId(target);
    let position: Vec2;
    let rotation: number;
    const hitEl = hit.elementId ? project.elements[hit.elementId] : undefined;
    const vertical = hit.kind === 'element' && Math.abs(hit.normal.z) < 0.5;
    if (vertical && hitEl && (hitEl.type === 'wall' || hitEl.type === 'door' || hitEl.type === 'window')) {
      // Pointing at a wall face: stand against it, facing out.
      const n = normalize({ x: hit.normal.x, y: hit.normal.y });
      position = add(hit.point, scale(n, d / 2 + 2));
      rotation = norm360(rotationFacing(n) + this.rot);
    } else {
      position = snapToGrid(hit.point, this.snapStep(50));
      rotation = norm360(facePlayerRotation(position, this.env.player().position) + this.rot);
      if (this.rot === 0 && target.levelId) {
        const back = autoBackToWall(project, target.levelId, position, w, d);
        if (back) {
          position = back.position;
          rotation = back.rotation;
        }
      }
    }
    const elevation = target.offset + (def?.elevation ?? 0);
    const element = createFromCatalog(this.env.item, levelId, { position, rotation, elevation });
    if (!element) return null;
    const units = this.env.ctx.ui.get().displayUnits;
    return { element, target, valid: true, info: def ? `${def.name} · ${formatLength(w, units)} × ${formatLength(d, units)}` : undefined };
  }
}

export class StairTool extends PlacementTool {
  protected readonly undoLabel = 'Place stair';
  /** Mirrored ghost (M): the turn opposite to the catalog item's. */
  private mirrored = false;

  protected override get extraHint(): string {
    return ' · M mirror';
  }

  protected plan(hit: PickHit): Placement | null {
    const project = this.env.ctx.store.project;
    const target = resolveBuildTarget(project, hit);
    const position = snapToGrid(hit.point, this.snapStep(100));
    const rotation = norm360(snapDeg(this.env.player().yaw, 90) + this.rot);
    const element = createFromCatalog(this.env.item, targetLevelId(target), { position, rotation });
    if (!element || element.type !== 'stair') return null;
    if (this.mirrored) element.turn = element.turn === 'left' ? 'right' : 'left';
    return { element, target, valid: true };
  }

  override key(e: KeyInput): boolean {
    if (e.key.toLowerCase() !== 'm' || e.shiftKey || e.ctrlKey || e.metaKey) return super.key(e);
    this.mirrored = !this.mirrored;
    this.hover(this.lastHit);
    return true;
  }
}

export class ColumnTool extends PlacementTool {
  protected readonly undoLabel = 'Place column';

  protected plan(hit: PickHit): Placement | null {
    const project = this.env.ctx.store.project;
    const target = resolveBuildTarget(project, hit);
    const levelId = targetLevelId(target);
    const position = snapToGrid(hit.point, this.env.ctx.ui.get().snapGrid ? project.settings.gridSize : 10);
    const props: Record<string, unknown> = { position, baseOffset: target.offset, rotation: this.rot };
    if (target.offset > 0 && this.env.item.template?.height === undefined) props.height = Math.max(300, target.levelHeight - target.offset);
    const element = createFromCatalog(this.env.item, levelId, props);
    if (!element) return null;
    const taken = Object.values(project.elements).some(
      (e) => e.type === 'column' && e.levelId === levelId && Math.hypot(e.position.x - position.x, e.position.y - position.y) < 10,
    );
    return { element, target, valid: !taken, reason: taken ? 'A column already stands here' : undefined };
  }
}

export class BlockTool extends PlacementTool {
  protected readonly undoLabel = 'Place block';

  /** Block edge length: the template size, else the project grid. */
  blockSize(): Vec3 {
    const t = this.env.item.template?.size as Vec3 | undefined;
    if (t && t.x > 0 && t.y > 0 && t.z > 0) return { ...t };
    const g = Math.max(50, this.env.ctx.store.project.settings.gridSize);
    return { x: g, y: g, z: g };
  }

  protected plan(hit: PickHit): Placement | null {
    const project = this.env.ctx.store.project;
    const size = this.blockSize();
    const { cell, target } = voxelCell(project, hit, size);
    const position = blockPositionForCell(cell, size, this.rot);
    const element = createFromCatalog(this.env.item, targetLevelId(target), { position, size, rotation: this.rot });
    if (!element) return null;
    const taken = blockOccupied(project, target.levelId, cell, size, this.rot);
    return { element, target, valid: !taken, reason: taken ? 'This cell is occupied' : undefined };
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
