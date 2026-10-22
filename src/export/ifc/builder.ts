/**
 * Crafting project → IFC4 (ADD2 TC1) STEP physical file.
 *
 * Spatial structure: IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey (one per level) with
 * IfcSpace per room aggregated to the storey and every element contained in its storey.
 *
 * Geometry strategy:
 *  - walls, slabs, columns, beams, spaces, box/cylinder blocks and openings are parametric
 *    IfcExtrudedAreaSolid profiles computed from the core data (join-aware wall footprints,
 *    slab outlines with voids, rectangle/circle/ellipse profiles), so they are exact regardless of
 *    the 3D mesh builder;
 *  - doors, windows, roofs, stairs, railings, furniture and free-form blocks reuse the 3D geometry
 *    module's meshes as IfcTriangulatedFaceSet in element-local millimetres.
 */
import { getFurniture } from '../../core/catalog';
import { distance, polygonArea, polygonPerimeter, signedArea, simplifyPolygon } from '../../core/math2d';
import { getMaterial, materialFor } from '../../core/materials';
import { detectOuterBoundaries } from '../../core/rooms';
import { computeStairLayout } from '../../core/stairs';
import type { Beam, Block, Column, Door, Element, Furniture, Level, Opening, Project, Railing, Roof, Room, Slab, Stair, Vec2, Wall, Window } from '../../core/types';
import {
  computeWallFootprints,
  openingsOfWall,
  wallCenterOffset,
  wallDirection,
  wallFaceOffsets,
  wallHeight,
  wallLength,
  type WallFootprint,
} from '../../core/walls';
import { buildElementGeometry, createGeometryContext, type GeometryContext } from '../../geometry';
import type { ExportOptions } from '../types';
import { compose, IDENTITY, meshToLocal, toLocal2, type Frame } from './frame';
import { doorOperation, furnitureClass, railingType, roofType, slabClass, stairType, windowPartitioning, type IfcClass } from './mapping';
import { bool, count, IfcModel, ident, label, posLength, propValue, type PropEntry } from './model';
import { enm, typed, type Ref, type StepArg } from './step';

export const APP_NAME = 'Crafting';
export const APP_VERSION = '0.1.0';
/** Openings extend this far beyond each wall face so the void always cuts through. */
const OPENING_CLEARANCE = 50;

const MM2_TO_M2 = 1e-6;
const MM3_TO_M3 = 1e-9;

export interface IfcBuildOptions extends ExportOptions {
  /** Header time stamp (defaults to now). */
  now?: Date;
}

function epochSeconds(iso: string | undefined, fallback: Date): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Math.floor((Number.isFinite(t) ? t : fallback.getTime()) / 1000);
}

function cleanPolygon(poly: Vec2[], ccw = true): Vec2[] | null {
  const p = simplifyPolygon(poly, 0.05);
  if (p.length < 3 || polygonArea(p) < 1) return null;
  const isCCW = signedArea(p) > 0;
  return isCCW === ccw ? p : [...p].reverse();
}

function fileBaseName(project: Project): string {
  return (project.info.name || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project';
}

/** Serialise `project` to an IFC4 STEP file (see module doc). */
export function buildIFC(project: Project, options: IfcBuildOptions = {}): string {
  const now = options.now ?? new Date();
  const levels = project.levels.filter((l) => !options.levelIds || options.levelIds.includes(l.id));
  const m = new IfcModel({
    namespace: project.id,
    author: project.info.author,
    organization: APP_NAME,
    application: { name: APP_NAME, version: APP_VERSION },
    created: epochSeconds(project.info.created, now),
    modified: epochSeconds(project.info.modified, now),
    northAngle: project.settings.northAngle ?? 0,
  });
  const w = m.w;
  const name = project.info.name || 'Untitled Project';

  const ifcProject = w.add('IFCPROJECT', [...m.root('project', name, project.info.description || null), null, name, null, [m.context], m.units]);
  const sitePlacement = m.localPlacement(null, IDENTITY);
  const site = w.add('IFCSITE', [...m.root('site', 'Site'), null, sitePlacement, null, null, enm('ELEMENT'), null, null, null, null, null]);
  const buildingPlacement = m.localPlacement(sitePlacement, IDENTITY);
  const address = project.info.address.trim()
    ? w.add('IFCPOSTALADDRESS', [null, null, null, null, project.info.address.split(/\r?\n|,\s*/).filter(Boolean).slice(0, 8), null, null, null, null, null])
    : null;
  const building = w.add('IFCBUILDING', [...m.root('building', name), null, buildingPlacement, null, null, enm('ELEMENT'), null, null, address]);
  m.aggregate('project', ifcProject, [site]);
  m.aggregate('site', site, [building]);

  const gctx = createGeometryContext(project);
  const lowestId = project.levels[0]?.id;
  const storeys: Ref[] = [];
  for (const level of levels) {
    const placement = m.localPlacement(buildingPlacement, { x: 0, y: 0, z: level.elevation, angle: 0 });
    const storey = w.add('IFCBUILDINGSTOREY', [...m.root(level.id, level.name), null, placement, null, null, enm('ELEMENT'), level.elevation]);
    m.quantitySet(storey, level.id, 'Qto_BuildingStoreyBaseQuantities', [
      ['GrossHeight', 'length', level.height],
      ['NetHeight', 'length', level.height],
    ]);
    storeys.push(storey);
    new LevelExporter(m, project, gctx, level, storey, placement, {
      includeFurniture: options.includeFurniture ?? true,
      lowest: level.id === lowestId,
    }).run();
  }
  m.aggregate('building', building, storeys);
  m.flushMaterialAssociations();

  return w.render({
    description: ['ViewDefinition [DesignTransferView]'],
    implementationLevel: '2;1',
    name: `${fileBaseName(project)}.ifc`,
    timeStamp: now.toISOString().slice(0, 19),
    author: [project.info.author || ''],
    organization: [''],
    preprocessorVersion: `${APP_NAME} ${APP_VERSION} IFC exporter`,
    originatingSystem: `${APP_NAME} ${APP_VERSION}`,
    authorization: 'None',
    schemas: ['IFC4'],
  });
}

interface ElementSpec {
  key?: string;
  name: string;
  description?: string | null;
  objectType?: string | null;
  placement: Ref;
  reps: (Ref | null)[];
  /** Attributes after Tag (PredefinedType, OverallHeight, …). */
  tail: StepArg[];
  contained?: boolean;
}

class LevelExporter {
  private contained: Ref[] = [];
  private spaces: Ref[] = [];
  private footprints: Map<string, WallFootprint>;
  private external: Set<string>;

  constructor(
    private m: IfcModel,
    private project: Project,
    private gctx: GeometryContext,
    private level: Level,
    private storey: Ref,
    private storeyPlacement: Ref,
    private opts: { includeFurniture: boolean; lowest: boolean },
  ) {
    this.footprints = computeWallFootprints(project, level.id);
    this.external = new Set(detectOuterBoundaries(project, level.id).flatMap((b) => b.wallIds));
  }

  run(): void {
    const els = Object.values(this.project.elements).filter((e) => e.levelId === this.level.id && !e.hidden);
    for (const el of els) {
      switch (el.type) {
        case 'wall':
          this.wall(el);
          break;
        case 'slab':
          this.slab(el);
          break;
        case 'roof':
          this.roof(el);
          break;
        case 'stair':
          this.stair(el);
          break;
        case 'column':
          this.column(el);
          break;
        case 'beam':
          this.beam(el);
          break;
        case 'railing':
          this.railing(el);
          break;
        case 'furniture':
          if (this.opts.includeFurniture) this.furniture(el);
          break;
        case 'block':
          this.block(el);
          break;
        case 'room':
          this.room(el);
          break;
        // Doors/windows are exported with their host wall; annotations have no IFC element here.
        case 'door':
        case 'window':
        case 'dimension':
        case 'label':
          break;
      }
    }
    this.m.contain(this.level.id, this.storey, this.contained);
    this.m.aggregate(`storey/${this.level.id}`, this.storey, this.spaces);
  }

  // --- helpers -------------------------------------------------------------------------------

  private product(entity: string, el: Element, spec: ElementSpec): Ref {
    const m = this.m;
    const shape = m.productShape(spec.reps.filter((r): r is Ref => !!r));
    const ref = m.w.add(entity, [
      ...m.root(spec.key ?? el.id, spec.name, spec.description ?? null),
      spec.objectType ?? null,
      spec.placement,
      shape,
      el.id,
      ...spec.tail,
    ]);
    if (spec.contained !== false) this.contained.push(ref);
    this.customProps(ref, el);
    return ref;
  }

  private customProps(ref: Ref, el: Element): void {
    const props: PropEntry[] = Object.entries(el.props ?? {})
      .filter(([, v]) => v !== null && v !== undefined && (typeof v !== 'number' || Number.isFinite(v)))
      .map(([k, v]) => [k, propValue(v)]);
    if (props.length) this.m.propertySet(ref, el.id, 'Crafting_Properties', props);
  }

  private placement(frame: Frame, relTo: Ref = this.storeyPlacement): Ref {
    return this.m.localPlacement(relTo, frame);
  }

  /** Tessellated body from the geometry module, converted into the element frame. */
  private meshBody(el: Element, frame: Frame): { rep: Ref | null; materials: string[] } {
    const geo = buildElementGeometry(this.gctx, el);
    const items: Ref[] = [];
    const materials: string[] = [];
    for (const part of geo.parts) {
      const local = meshToLocal(part.mesh, this.level.elevation, frame);
      const fs = this.m.faceSet(local);
      if (!fs) continue;
      this.m.style(fs, part.materialId);
      items.push(fs);
      materials.push(part.materialId);
    }
    return { rep: items.length ? this.m.shapeRep('Body', 'Tessellation', items) : null, materials };
  }

  private sweptBody(items: Ref[], materialId: string): Ref {
    for (const it of items) this.m.style(it, materialId);
    return this.m.shapeRep('Body', 'SweptSolid', items);
  }

  private associate(ref: Ref, materialIds: string[], name: string): void {
    if (materialIds.length) this.m.associateMaterial(ref, this.m.materialSelect(materialIds, name));
  }

  // --- walls, openings, doors, windows -------------------------------------------------------

  private wall(wall: Wall): void {
    const m = this.m;
    const fp = this.footprints.get(wall.id);
    const len = wallLength(wall);
    if (!fp || len < 1) return;
    const dir = wallDirection(wall);
    const frame: Frame = { x: wall.start.x, y: wall.start.y, z: wall.baseOffset, angle: (Math.atan2(dir.y, dir.x) * 180) / Math.PI };
    const height = wallHeight(this.project, wall);
    const mat = materialFor(wall).id;
    const local = cleanPolygon(fp.polygon.map((p) => toLocal2(frame, p)));
    const axis = m.shapeRep('Axis', 'Curve2D', [m.polyline2([{ x: 0, y: 0 }, { x: len, y: 0 }], false)]);
    const body = local ? this.sweptBody([m.extrude(m.arbitraryProfile(local), height)], mat) : null;
    const placement = this.placement(frame);
    const isExternal = this.external.has(wall.id);
    const ref = this.product('IFCWALL', wall, {
      name: wall.name ?? `Wall ${Math.round(wall.thickness)} mm`,
      objectType: `${getMaterial(mat).name} ${Math.round(wall.thickness)} mm`,
      placement,
      reps: [axis, body],
      tail: [enm('STANDARD')],
    });

    const faces = wallFaceOffsets(wall);
    const layers = m.layerSet(mat, wall.thickness, wall.rightFinishId, wall.leftFinishId, wall.structural);
    m.associateMaterial(ref, m.layerSetUsage(layers, faces.right));

    // Openings, doors and windows hosted by this wall.
    let openingSide = 0;
    let openingVolume = 0;
    let openingFoot = 0;
    for (const op of openingsOfWall(this.project, wall.id)) {
      if (op.hidden || op.levelId !== wall.levelId) continue;
      openingSide += op.width * op.height;
      openingVolume += op.width * op.height * wall.thickness;
      if (op.sill <= 0) openingFoot += op.width * wall.thickness;
      this.opening(op, wall, frame, placement, ref, isExternal);
    }

    m.propertySet(ref, wall.id, 'Pset_WallCommon', [
      ['Reference', ident(wall.name ?? `W-${Math.round(wall.thickness)}`)],
      ['LoadBearing', bool(wall.structural)],
      ['IsExternal', bool(isExternal)],
    ]);
    const footArea = local ? polygonArea(local) : len * wall.thickness;
    m.quantitySet(ref, wall.id, 'Qto_WallBaseQuantities', [
      ['Length', 'length', len],
      ['Width', 'length', wall.thickness],
      ['Height', 'length', height],
      ['GrossFootprintArea', 'area', footArea * MM2_TO_M2],
      ['NetFootprintArea', 'area', Math.max(0, footArea - openingFoot) * MM2_TO_M2],
      ['GrossSideArea', 'area', len * height * MM2_TO_M2],
      ['NetSideArea', 'area', Math.max(0, len * height - openingSide) * MM2_TO_M2],
      ['GrossVolume', 'volume', footArea * height * MM3_TO_M3],
      ['NetVolume', 'volume', Math.max(0, footArea * height - openingVolume) * MM3_TO_M3],
    ]);
  }

  private opening(op: Opening, wall: Wall, wallFrame: Frame, wallPlacement: Ref, wallRef: Ref, isExternal: boolean): void {
    const m = this.m;
    const rel: Frame = { x: op.offset, y: wallCenterOffset(wall), z: op.sill, angle: 0 };
    const placement = this.placement(rel, wallPlacement);
    const solid = m.extrude(m.rectangleProfile(op.width, wall.thickness + 2 * OPENING_CLEARANCE), op.height);
    const kind = op.type === 'door' ? 'Door' : 'Window';
    const opening = m.w.add('IFCOPENINGELEMENT', [
      ...m.root(`${op.id}/opening`, `Opening — ${kind} ${Math.round(op.width)}×${Math.round(op.height)}`),
      'Opening',
      placement,
      m.productShape([m.shapeRep('Body', 'SweptSolid', [solid])]),
      `${op.id}/opening`,
      enm('OPENING'),
    ]);
    m.voids(op.id, wallRef, opening);
    m.quantitySet(opening, `${op.id}/opening`, 'Qto_OpeningElementBaseQuantities', [
      ['Width', 'length', op.width],
      ['Height', 'length', op.height],
      ['Depth', 'length', wall.thickness],
      ['Area', 'area', op.width * op.height * MM2_TO_M2],
      ['Volume', 'volume', op.width * op.height * wall.thickness * MM3_TO_M3],
    ]);
    // A cased opening (style 'opening') is only a void: there is no door leaf to fill it.
    if (op.type === 'door' && op.style === 'opening') return;

    // The filling's +y points to the swing side (IFC door convention).
    const turn: Frame = op.type === 'door' && op.flip ? { x: 0, y: 0, z: 0, angle: 180 } : IDENTITY;
    const frame = compose(compose(wallFrame, rel), turn);
    const fillPlacement = this.placement(turn, placement);
    const { rep, materials } = this.meshBody(op, frame);
    const ref = op.type === 'door' ? this.door(op, fillPlacement, rep) : this.window(op, fillPlacement, rep);
    this.associate(ref, materials.length ? materials : [materialFor(op).id], `${kind} materials`);
    m.fills(op.id, opening, ref);
    m.propertySet(ref, op.id, op.type === 'door' ? 'Pset_DoorCommon' : 'Pset_WindowCommon', [
      ['Reference', ident(`${kind[0]}-${Math.round(op.width)}x${Math.round(op.height)}`)],
      ['IsExternal', bool(isExternal)],
    ]);
    m.quantitySet(ref, op.id, op.type === 'door' ? 'Qto_DoorBaseQuantities' : 'Qto_WindowBaseQuantities', [
      ['Width', 'length', op.width],
      ['Height', 'length', op.height],
      ['Area', 'area', op.width * op.height * MM2_TO_M2],
    ]);
  }

  private door(d: Door, placement: Ref, rep: Ref | null): Ref {
    const { operation, userDefined } = doorOperation(d);
    const styleName: Record<Door['style'], string> = {
      single: 'Single swing door',
      double: 'Double swing door',
      sliding: 'Sliding door',
      pocket: 'Pocket door',
      garage: 'Garage door',
      opening: 'Cased opening',
    };
    return this.product('IFCDOOR', d, {
      name: d.name ?? `Door ${Math.round(d.width)}×${Math.round(d.height)}`,
      objectType: styleName[d.style],
      placement,
      reps: [rep],
      tail: [d.height, d.width, enm('DOOR'), enm(operation), userDefined ?? null],
    });
  }

  private window(win: Window, placement: Ref, rep: Ref | null): Ref {
    const styleName: Record<Window['style'], string> = {
      casement: 'Casement window',
      sliding: 'Sliding window',
      fixed: 'Fixed window',
      awning: 'Awning window',
      'double-hung': 'Double-hung window',
    };
    return this.product('IFCWINDOW', win, {
      name: win.name ?? `Window ${Math.round(win.width)}×${Math.round(win.height)}`,
      objectType: styleName[win.style],
      placement,
      reps: [rep],
      tail: [win.height, win.width, enm('WINDOW'), enm(windowPartitioning(win)), null],
    });
  }

  // --- slabs, roofs, stairs ------------------------------------------------------------------

  private slab(s: Slab): void {
    const m = this.m;
    const outer = cleanPolygon(s.outline);
    if (!outer || s.thickness <= 0) return;
    const holes = (s.holes ?? []).map((h) => cleanPolygon(h, false)).filter((h): h is Vec2[] => !!h);
    const mat = materialFor(s).id;
    const position = m.placement3({ x: 0, y: 0, z: s.topOffset - s.thickness, angle: 0 });
    const body = this.sweptBody([m.extrude(m.arbitraryProfile(outer, holes), s.thickness, position)], mat);
    const cls: IfcClass = slabClass(s.kind, this.opts.lowest);
    const kindName: Record<Slab['kind'], string> = { floor: 'Floor slab', ceiling: 'Ceiling', foundation: 'Foundation slab', terrace: 'Terrace slab' };
    const ref = this.product(cls.entity, s, {
      name: s.name ?? `${kindName[s.kind]} ${Math.round(s.thickness)} mm`,
      objectType: cls.objectType ?? kindName[s.kind],
      placement: this.placement(IDENTITY),
      reps: [body],
      tail: [enm(cls.predefinedType)],
    });
    this.associate(ref, [mat], kindName[s.kind]);
    const gross = polygonArea(outer);
    const net = Math.max(0, gross - holes.reduce((a, h) => a + polygonArea(h), 0));
    const perimeter = polygonPerimeter(outer);
    if (cls.entity === 'IFCCOVERING') {
      m.propertySet(ref, s.id, 'Pset_CoveringCommon', [['IsExternal', bool(false)]]);
      m.quantitySet(ref, s.id, 'Qto_CoveringBaseQuantities', [
        ['Width', 'length', s.thickness],
        ['GrossArea', 'area', gross * MM2_TO_M2],
        ['NetArea', 'area', net * MM2_TO_M2],
      ]);
      return;
    }
    m.propertySet(ref, s.id, 'Pset_SlabCommon', [
      ['IsExternal', bool(s.kind === 'terrace' || s.kind === 'foundation')],
      ['LoadBearing', bool(true)],
    ]);
    m.quantitySet(ref, s.id, 'Qto_SlabBaseQuantities', [
      ['Width', 'length', s.thickness],
      ['Perimeter', 'length', perimeter],
      ['GrossArea', 'area', gross * MM2_TO_M2],
      ['NetArea', 'area', net * MM2_TO_M2],
      ['GrossVolume', 'volume', gross * s.thickness * MM3_TO_M3],
      ['NetVolume', 'volume', net * s.thickness * MM3_TO_M3],
    ]);
  }

  private roof(r: Roof): void {
    const { rep, materials } = this.meshBody(r, IDENTITY);
    const shapeName = r.shape.charAt(0).toUpperCase() + r.shape.slice(1);
    const ref = this.product('IFCROOF', r, {
      name: r.name ?? `${shapeName} roof`,
      objectType: `${shapeName} roof ${r.shape === 'flat' ? '' : `${r.pitch}°`}`.trim(),
      placement: this.placement(IDENTITY),
      reps: [rep],
      tail: [enm(roofType(r.shape))],
    });
    this.associate(ref, materials.length ? materials : [materialFor(r).id], 'Roof materials');
    this.m.propertySet(ref, r.id, 'Pset_RoofCommon', [
      ['IsExternal', bool(true)],
      ['ProjectedArea', r.outline.length >= 3 ? typedArea(polygonArea(r.outline)) : null],
    ]);
    if (r.outline.length >= 3) {
      this.m.quantitySet(ref, r.id, 'Qto_RoofBaseQuantities', [['ProjectedArea', 'area', polygonArea(r.outline) * MM2_TO_M2]]);
    }
  }

  private stair(s: Stair): void {
    const frame: Frame = { x: s.position.x, y: s.position.y, z: 0, angle: s.rotation };
    const { rep, materials } = this.meshBody(s, frame);
    const layout = computeStairLayout(s, this.level.height);
    const ref = this.product('IFCSTAIR', s, {
      name: s.name ?? `Stair ${s.shape} ${Math.round(s.width)} mm`,
      objectType: `${s.shape} stair`,
      placement: this.placement(frame),
      reps: [rep],
      tail: [enm(stairType(s.shape))],
    });
    this.associate(ref, materials.length ? materials : [materialFor(s).id], 'Stair materials');
    this.m.propertySet(ref, s.id, 'Pset_StairCommon', [
      ['NumberOfRiser', count(layout.riserCount)],
      ['NumberOfTreads', count(layout.treads.length)],
      ['RiserHeight', posLength(layout.riserHeight)],
      ['TreadLength', posLength(s.tread)],
      ['IsExternal', bool(false)],
    ]);
  }

  // --- structure -----------------------------------------------------------------------------

  private column(c: Column): void {
    const m = this.m;
    const height = c.height ?? this.level.height;
    const frame: Frame = { x: c.position.x, y: c.position.y, z: c.baseOffset, angle: c.rotation };
    const mat = materialFor(c).id;
    const profile = c.shape === 'round' ? m.ellipseProfile(c.width, c.depth) : m.rectangleProfile(c.width, c.depth);
    const body = this.sweptBody([m.extrude(profile, height)], mat);
    const ref = this.product('IFCCOLUMN', c, {
      name: c.name ?? `Column ${Math.round(c.width)}×${Math.round(c.depth)}`,
      objectType: `${c.shape === 'round' ? 'Round' : 'Rectangular'} column ${Math.round(c.width)}×${Math.round(c.depth)}`,
      placement: this.placement(frame),
      reps: [body],
      tail: [enm('COLUMN')],
    });
    this.associate(ref, [mat], 'Column');
    const area = c.shape === 'round' ? (Math.PI * c.width * c.depth) / 4 : c.width * c.depth;
    m.propertySet(ref, c.id, 'Pset_ColumnCommon', [
      ['LoadBearing', bool(true)],
      ['IsExternal', bool(false)],
    ]);
    m.quantitySet(ref, c.id, 'Qto_ColumnBaseQuantities', [
      ['Length', 'length', height],
      ['CrossSectionArea', 'area', area * MM2_TO_M2],
      ['GrossVolume', 'volume', area * height * MM3_TO_M3],
    ]);
  }

  private beam(b: Beam): void {
    const m = this.m;
    const len = distance(b.start, b.end);
    if (len < 1) return;
    const top = b.topOffset ?? this.level.height;
    const angle = (Math.atan2(b.end.y - b.start.y, b.end.x - b.start.x) * 180) / Math.PI;
    const frame: Frame = { x: b.start.x, y: b.start.y, z: top - b.depth / 2, angle };
    const mat = materialFor(b).id;
    // Profile in the local YZ plane, extruded along the beam axis (local +x).
    const position = m.placementAxes([0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const body = this.sweptBody([m.extrude(m.rectangleProfile(b.width, b.depth), len, position)], mat);
    const axis = m.shapeRep('Axis', 'Curve2D', [m.polyline2([{ x: 0, y: 0 }, { x: len, y: 0 }], false)]);
    const ref = this.product('IFCBEAM', b, {
      name: b.name ?? `Beam ${Math.round(b.width)}×${Math.round(b.depth)}`,
      objectType: `Rectangular beam ${Math.round(b.width)}×${Math.round(b.depth)}`,
      placement: this.placement(frame),
      reps: [axis, body],
      tail: [enm('BEAM')],
    });
    this.associate(ref, [mat], 'Beam');
    m.propertySet(ref, b.id, 'Pset_BeamCommon', [
      ['Span', posLength(len)],
      ['LoadBearing', bool(true)],
      ['IsExternal', bool(false)],
    ]);
    m.quantitySet(ref, b.id, 'Qto_BeamBaseQuantities', [
      ['Length', 'length', len],
      ['CrossSectionArea', 'area', b.width * b.depth * MM2_TO_M2],
      ['GrossVolume', 'volume', b.width * b.depth * len * MM3_TO_M3],
    ]);
  }

  private railing(r: Railing): void {
    if (r.path.length < 2) return;
    const { rep, materials } = this.meshBody(r, IDENTITY);
    const ref = this.product('IFCRAILING', r, {
      name: r.name ?? `Railing ${Math.round(r.height)} mm`,
      objectType: `${r.style} railing`,
      placement: this.placement(IDENTITY),
      reps: [rep],
      tail: [enm(railingType())],
    });
    this.associate(ref, materials.length ? materials : [materialFor(r).id], 'Railing materials');
    let len = 0;
    for (let i = 1; i < r.path.length; i++) len += distance(r.path[i - 1], r.path[i]);
    this.m.propertySet(ref, r.id, 'Pset_RailingCommon', [
      ['Height', posLength(r.height)],
      ['IsExternal', bool(false)],
    ]);
    this.m.quantitySet(ref, r.id, 'Qto_RailingBaseQuantities', [['Length', 'length', len]]);
  }

  // --- furnishing & free-form ----------------------------------------------------------------

  private furniture(f: Furniture): void {
    const def = getFurniture(f.catalogId);
    const frame: Frame = { x: f.position.x, y: f.position.y, z: f.elevation, angle: f.rotation };
    const { rep, materials } = this.meshBody(f, frame);
    const cls = furnitureClass(def);
    const ref = this.product(cls.entity, f, {
      name: f.name ?? def?.name ?? f.catalogId,
      description: def ? `${def.category} — ${Math.round(f.width ?? def.width)}×${Math.round(f.depth ?? def.depth)}×${Math.round(f.height ?? def.height)} mm` : null,
      objectType: cls.objectType ?? def?.name ?? f.catalogId,
      placement: this.placement(frame),
      reps: [rep],
      tail: [enm(cls.predefinedType)],
    });
    this.associate(ref, materials.length ? materials : [f.materialId ?? def?.materialId ?? materialFor(f).id], def?.name ?? 'Furniture');
    this.m.propertySet(ref, f.id, 'Crafting_Catalog', [
      ['CatalogId', label(f.catalogId)],
      ['Category', def ? label(def.category) : null],
    ]);
  }

  private block(b: Block): void {
    const m = this.m;
    const frame: Frame = { x: b.position.x, y: b.position.y, z: b.position.z, angle: b.rotation };
    const mat = materialFor(b).id;
    const center = { x: b.size.x / 2, y: b.size.y / 2 };
    let rep: Ref | null;
    let materials = [mat];
    if (b.shape === 'box') rep = this.sweptBody([m.extrude(m.rectangleProfile(b.size.x, b.size.y, center), b.size.z)], mat);
    else if (b.shape === 'cylinder') rep = this.sweptBody([m.extrude(m.ellipseProfile(b.size.x, b.size.y, center), b.size.z)], mat);
    else {
      const res = this.meshBody(b, frame);
      rep = res.rep;
      if (res.materials.length) materials = res.materials;
    }
    const ref = this.product('IFCBUILDINGELEMENTPROXY', b, {
      name: b.name ?? `Block ${b.shape}`,
      objectType: `Block (${b.shape})`,
      placement: this.placement(frame),
      reps: [rep],
      tail: [enm('USERDEFINED')],
    });
    this.associate(ref, materials, 'Block');
    const vol = b.size.x * b.size.y * b.size.z * (b.shape === 'cylinder' ? Math.PI / 4 : b.shape === 'sphere' ? Math.PI / 6 : b.shape === 'wedge' ? 0.5 : 1);
    m.quantitySet(ref, b.id, 'Qto_BuildingElementProxyQuantities', [['NetVolume', 'volume', vol * MM3_TO_M3]]);
  }

  // --- spaces --------------------------------------------------------------------------------

  private room(r: Room): void {
    const m = this.m;
    const outline = cleanPolygon(r.outline);
    if (!outline) return;
    const height = this.level.height;
    const body = m.shapeRep('Body', 'SweptSolid', [m.extrude(m.arbitraryProfile(outline), height)]);
    const foot = m.shapeRep('FootPrint', 'Curve2D', [m.polyline2(outline, true)]);
    const placement = this.placement(IDENTITY);
    const space = m.w.add('IFCSPACE', [
      ...m.root(r.id, r.number || r.name, null),
      null,
      placement,
      m.productShape([foot, body]),
      r.name,
      enm('ELEMENT'),
      enm('INTERNAL'),
      null,
    ]);
    this.spaces.push(space);
    this.customProps(space, r);
    const area = polygonArea(outline);
    m.propertySet(space, r.id, 'Pset_SpaceCommon', [
      ['Reference', r.number ? ident(r.number) : null],
      ['IsExternal', bool(false)],
    ]);
    if (r.floorMaterialId) m.propertySet(space, r.id, 'Pset_SpaceCoveringRequirements', [['FloorCovering', label(getMaterial(r.floorMaterialId).name)]]);
    m.quantitySet(space, r.id, 'Qto_SpaceBaseQuantities', [
      ['Height', 'length', height],
      ['GrossPerimeter', 'length', polygonPerimeter(outline)],
      ['GrossFloorArea', 'area', area * MM2_TO_M2],
      ['NetFloorArea', 'area', area * MM2_TO_M2],
      ['GrossVolume', 'volume', area * height * MM3_TO_M3],
    ]);
  }
}

function typedArea(mm2: number): StepArg {
  return typed('IFCAREAMEASURE', Math.round(mm2 * MM2_TO_M2 * 1e6) / 1e6);
}
