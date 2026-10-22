/**
 * IFC4 entity factory on top of the STEP writer: shared geometry resources (points, directions,
 * placements, contexts), presentation styles, materials, property/quantity sets and relationships.
 * Element-specific logic lives in builder.ts.
 */
import { getMaterial, type MaterialDef } from '../../core/materials';
import type { PropValue, Vec2 } from '../../core/types';
import type { Frame, LocalMesh } from './frame';
import { GuidRegistry } from './guid';
import { DERIVED, enm, int, Ref, StepWriter, typed, type StepArg } from './step';

export type PropEntry = [name: string, value: StepArg];
export type QuantityKind = 'length' | 'area' | 'volume' | 'count' | 'weight';
export type QuantityEntry = [name: string, kind: QuantityKind, value: number];

const round = (n: number, d = 4) => {
  const f = 10 ** d;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.8, 0.8, 0.8];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Typed IFC value for a free-form user property. */
export function propValue(v: PropValue): StepArg {
  if (typeof v === 'boolean') return typed('IFCBOOLEAN', v);
  if (typeof v === 'number') return Number.isInteger(v) ? typed('IFCINTEGER', int(v)) : typed('IFCREAL', v);
  return v.length > 255 ? typed('IFCTEXT', v) : typed('IFCLABEL', v);
}

export const label = (s: string): StepArg => typed('IFCLABEL', s);
export const ident = (s: string): StepArg => typed('IFCIDENTIFIER', s);
export const bool = (b: boolean): StepArg => typed('IFCBOOLEAN', b);
export const posLength = (n: number): StepArg => typed('IFCPOSITIVELENGTHMEASURE', Math.max(round(n), 1e-3));
export const length = (n: number): StepArg => typed('IFCLENGTHMEASURE', round(n));
export const count = (n: number): StepArg => typed('IFCCOUNTMEASURE', int(n));

export interface IfcModelOptions {
  namespace: string;
  author: string;
  organization: string;
  application: { name: string; version: string };
  /** Seconds since epoch. */
  created: number;
  modified: number;
  /** Plan rotation of true north relative to +y, degrees CCW. */
  northAngle: number;
}

export class IfcModel {
  readonly w = new StepWriter();
  readonly guids: GuidRegistry;
  readonly ownerHistory: Ref;
  readonly units: Ref;
  readonly context: Ref;
  readonly bodyContext: Ref;
  readonly axisContext: Ref;
  readonly footprintContext: Ref;
  /** IfcAxis2Placement3D at the origin (shared). */
  readonly origin: Ref;
  private _origin2d: Ref | null = null;

  private points = new Map<string, Ref>();
  private dirs = new Map<string, Ref>();
  private styles = new Map<string, Ref>();
  private materials = new Map<string, Ref>();
  private layerSets = new Map<string, Ref>();
  private layerUsages = new Map<string, Ref>();
  private constituentSets = new Map<string, Ref>();
  /** Material select → related objects (written as one IfcRelAssociatesMaterial each). */
  private materialRels = new Map<Ref, Ref[]>();
  /** Stable key of each material select, used for deterministic relationship GlobalIds. */
  private selectKeys = new Map<Ref, string>();

  constructor(opts: IfcModelOptions) {
    const w = this.w;
    this.guids = new GuidRegistry(opts.namespace);
    const person = w.add('IFCPERSON', [null, opts.author || 'Unknown', null, null, null, null, null, null]);
    const org = w.add('IFCORGANIZATION', [null, opts.organization || opts.application.name, null, null, null]);
    const personOrg = w.add('IFCPERSONANDORGANIZATION', [person, org, null]);
    const devOrg = opts.organization === opts.application.name ? org : w.add('IFCORGANIZATION', [null, opts.application.name, 'Free browser-based BIM design', null, null]);
    const app = w.add('IFCAPPLICATION', [devOrg, opts.application.version, opts.application.name, opts.application.name]);
    this.ownerHistory = w.add('IFCOWNERHISTORY', [
      personOrg,
      app,
      null,
      enm('ADDED'),
      int(opts.modified),
      personOrg,
      app,
      int(opts.created),
    ]);

    this.units = w.add('IFCUNITASSIGNMENT', [
      [
        w.add('IFCSIUNIT', [DERIVED, enm('LENGTHUNIT'), enm('MILLI'), enm('METRE')]),
        w.add('IFCSIUNIT', [DERIVED, enm('AREAUNIT'), null, enm('SQUARE_METRE')]),
        w.add('IFCSIUNIT', [DERIVED, enm('VOLUMEUNIT'), null, enm('CUBIC_METRE')]),
        w.add('IFCSIUNIT', [DERIVED, enm('PLANEANGLEUNIT'), null, enm('RADIAN')]),
        w.add('IFCSIUNIT', [DERIVED, enm('MASSUNIT'), enm('KILO'), enm('GRAM')]),
        w.add('IFCSIUNIT', [DERIVED, enm('TIMEUNIT'), null, enm('SECOND')]),
      ],
    ]);

    this.origin = this.placement3({ x: 0, y: 0, z: 0, angle: 0 });
    const n = (opts.northAngle * Math.PI) / 180;
    const trueNorth = w.add('IFCDIRECTION', [[round(-Math.sin(n), 8), round(Math.cos(n), 8)]]);
    this.context = w.add('IFCGEOMETRICREPRESENTATIONCONTEXT', [null, 'Model', int(3), 1e-5, this.origin, trueNorth]);
    const sub = (id: string, view: string) =>
      w.add('IFCGEOMETRICREPRESENTATIONSUBCONTEXT', [id, 'Model', DERIVED, DERIVED, DERIVED, DERIVED, this.context, null, enm(view), null]);
    this.bodyContext = sub('Body', 'MODEL_VIEW');
    this.axisContext = sub('Axis', 'GRAPH_VIEW');
    this.footprintContext = sub('FootPrint', 'PLAN_VIEW');
  }

  /** IfcAxis2Placement2D at the origin (shared, created on first use so no instance is orphaned). */
  get origin2d(): Ref {
    this._origin2d ??= this.w.add('IFCAXIS2PLACEMENT2D', [this.point2(0, 0), null]);
    return this._origin2d;
  }

  guid(key: string): string {
    return this.guids.get(key);
  }

  /** Root attributes shared by every IfcRoot subtype: GlobalId, OwnerHistory, Name, Description. */
  root(key: string, name?: string | null, description?: string | null): StepArg[] {
    return [this.guid(key), this.ownerHistory, name ?? null, description ?? null];
  }

  // --- Geometry resources --------------------------------------------------------------------

  point3(x: number, y: number, z: number): Ref {
    const c = [round(x), round(y), round(z)];
    const key = c.join(',');
    let r = this.points.get(key);
    if (!r) {
      r = this.w.add('IFCCARTESIANPOINT', [c]);
      this.points.set(key, r);
    }
    return r;
  }

  point2(x: number, y: number): Ref {
    const c = [round(x), round(y)];
    const key = c.join(',');
    let r = this.points.get(key);
    if (!r) {
      r = this.w.add('IFCCARTESIANPOINT', [c]);
      this.points.set(key, r);
    }
    return r;
  }

  direction(...ratios: number[]): Ref {
    const c = ratios.map((v) => round(v, 10));
    const key = `d${c.join(',')}`;
    let r = this.dirs.get(key);
    if (!r) {
      r = this.w.add('IFCDIRECTION', [c]);
      this.dirs.set(key, r);
    }
    return r;
  }

  /** IfcAxis2Placement3D for a Z-up frame. Axis and RefDirection are both given or both omitted (IFC4 WR). */
  placement3(f: Frame): Ref {
    const loc = this.point3(f.x, f.y, f.z);
    const a = (((f.angle % 360) + 360) % 360) * (Math.PI / 180);
    if (Math.abs(Math.sin(a)) < 1e-12 && Math.cos(a) > 0) return this.w.add('IFCAXIS2PLACEMENT3D', [loc, null, null]);
    return this.w.add('IFCAXIS2PLACEMENT3D', [loc, this.direction(0, 0, 1), this.direction(Math.cos(a), Math.sin(a), 0)]);
  }

  /** IfcAxis2Placement3D with explicit axes (beams: extrusion along the member axis). */
  placementAxes(origin: [number, number, number], axis: [number, number, number], ref: [number, number, number]): Ref {
    return this.w.add('IFCAXIS2PLACEMENT3D', [this.point3(...origin), this.direction(...axis), this.direction(...ref)]);
  }

  localPlacement(relTo: Ref | null, f: Frame): Ref {
    return this.w.add('IFCLOCALPLACEMENT', [relTo, this.placement3(f)]);
  }

  polyline2(pts: Vec2[], close: boolean): Ref {
    const refs = pts.map((p) => this.point2(p.x, p.y));
    if (close && refs.length) refs.push(refs[0]);
    return this.w.add('IFCPOLYLINE', [refs]);
  }

  /** Closed profile (outer CCW, holes CW), with voids when holes are given. */
  arbitraryProfile(outer: Vec2[], holes: Vec2[][] = [], name: string | null = null): Ref {
    const outerCurve = this.polyline2(outer, true);
    if (!holes.length) return this.w.add('IFCARBITRARYCLOSEDPROFILEDEF', [enm('AREA'), name, outerCurve]);
    return this.w.add('IFCARBITRARYPROFILEDEFWITHVOIDS', [enm('AREA'), name, outerCurve, holes.map((h) => this.polyline2(h, true))]);
  }

  rectangleProfile(xDim: number, yDim: number, center: Vec2 = { x: 0, y: 0 }, name: string | null = null): Ref {
    const pos = center.x === 0 && center.y === 0 ? this.origin2d : this.w.add('IFCAXIS2PLACEMENT2D', [this.point2(center.x, center.y), null]);
    return this.w.add('IFCRECTANGLEPROFILEDEF', [enm('AREA'), name, pos, Math.max(round(xDim), 0.01), Math.max(round(yDim), 0.01)]);
  }

  /** Circle when both axes match, ellipse otherwise. */
  ellipseProfile(xDim: number, yDim: number, center: Vec2 = { x: 0, y: 0 }, name: string | null = null): Ref {
    const pos = center.x === 0 && center.y === 0 ? this.origin2d : this.w.add('IFCAXIS2PLACEMENT2D', [this.point2(center.x, center.y), null]);
    if (Math.abs(xDim - yDim) < 0.01) return this.w.add('IFCCIRCLEPROFILEDEF', [enm('AREA'), name, pos, Math.max(round(xDim / 2), 0.01)]);
    return this.w.add('IFCELLIPSEPROFILEDEF', [enm('AREA'), name, pos, Math.max(round(xDim / 2), 0.01), Math.max(round(yDim / 2), 0.01)]);
  }

  /** Vertical (or Position-relative) extrusion of a profile. */
  extrude(profile: Ref, depth: number, position: Ref = this.origin): Ref {
    return this.w.add('IFCEXTRUDEDAREASOLID', [profile, position, this.direction(0, 0, 1), Math.max(round(depth), 0.01)]);
  }

  faceSet(mesh: LocalMesh): Ref | null {
    if (!mesh.triangles.length) return null;
    const pts = this.w.add('IFCCARTESIANPOINTLIST3D', [mesh.coords.map((c) => c.map((v) => round(v, 2)))]);
    return this.w.add('IFCTRIANGULATEDFACESET', [pts, null, mesh.closed, mesh.triangles.map((t) => t.map(int)), null]);
  }

  shapeRep(ctx: 'Body' | 'Axis' | 'FootPrint', type: string, items: Ref[]): Ref {
    const c = ctx === 'Body' ? this.bodyContext : ctx === 'Axis' ? this.axisContext : this.footprintContext;
    return this.w.add('IFCSHAPEREPRESENTATION', [c, ctx, type, items]);
  }

  productShape(reps: Ref[]): Ref | null {
    return reps.length ? this.w.add('IFCPRODUCTDEFINITIONSHAPE', [null, null, reps]) : null;
  }

  // --- Presentation & materials --------------------------------------------------------------

  surfaceStyle(materialId: string): Ref {
    const mat = getMaterial(materialId);
    let r = this.styles.get(mat.id);
    if (!r) {
      const [red, green, blue] = hexToRgb(mat.color);
      const colour = this.w.add('IFCCOLOURRGB', [mat.name, round(red, 4), round(green, 4), round(blue, 4)]);
      const method = mat.category === 'glass' ? 'GLASS' : mat.metalness > 0.5 ? 'METAL' : mat.roughness >= 0.8 ? 'MATT' : 'PLASTIC';
      const rendering = this.w.add('IFCSURFACESTYLERENDERING', [
        colour,
        round(Math.min(1, Math.max(0, 1 - mat.opacity)), 4),
        colour,
        null,
        null,
        null,
        typed('IFCNORMALISEDRATIOMEASURE', round(Math.max(0.05, mat.metalness * 0.8 + (1 - mat.roughness) * 0.2), 4)),
        typed('IFCSPECULARROUGHNESS', round(Math.min(1, Math.max(0, mat.roughness)), 4)),
        enm(method),
      ]);
      r = this.w.add('IFCSURFACESTYLE', [mat.name, enm('BOTH'), [rendering]]);
      this.styles.set(mat.id, r);
    }
    return r;
  }

  /** Attach the material colour to a representation item. */
  style(item: Ref, materialId: string): Ref {
    this.w.add('IFCSTYLEDITEM', [item, [this.surfaceStyle(materialId)], null]);
    return item;
  }

  material(materialId: string): Ref {
    const mat = getMaterial(materialId);
    let r = this.materials.get(mat.id);
    if (!r) {
      r = this.w.add('IFCMATERIAL', [mat.name, null, categoryName(mat)]);
      const item = this.w.add('IFCSTYLEDITEM', [null, [this.surfaceStyle(mat.id)], null]);
      const rep = this.w.add('IFCSTYLEDREPRESENTATION', [this.bodyContext, 'Style', 'Material', [item]]);
      this.w.add('IFCMATERIALDEFINITIONREPRESENTATION', [null, null, [rep], r]);
      this.materials.set(mat.id, r);
      this.selectKeys.set(r, `material/${mat.id}`);
    }
    return r;
  }

  /** Layer set for a wall: optional zero-thickness finishes on each side of the core (right → left). */
  layerSet(core: string, thickness: number, rightFinish?: string, leftFinish?: string, loadBearing = false): Ref {
    const key = `${core}|${round(thickness)}|${rightFinish ?? ''}|${leftFinish ?? ''}|${loadBearing}`;
    let r = this.layerSets.get(key);
    if (!r) {
      const layers: Ref[] = [];
      const layer = (id: string, t: number, name: string, category: string) =>
        this.w.add('IFCMATERIALLAYER', [this.material(id), round(t), null, name, null, category, null]);
      if (rightFinish) layers.push(layer(rightFinish, 0, 'Finish', 'Finish'));
      layers.push(layer(core, thickness, 'Core', loadBearing ? 'LoadBearing' : 'Core'));
      if (leftFinish) layers.push(layer(leftFinish, 0, 'Finish', 'Finish'));
      r = this.w.add('IFCMATERIALLAYERSET', [layers, `${getMaterial(core).name} ${Math.round(thickness)} mm`, null]);
      this.layerSets.set(key, r);
      this.selectKeys.set(r, `layerset/${key}`);
    }
    return r;
  }

  layerSetUsage(layerSet: Ref, offsetFromReferenceLine: number): Ref {
    const key = `${layerSet.id}|${round(offsetFromReferenceLine)}`;
    let r = this.layerUsages.get(key);
    if (!r) {
      r = this.w.add('IFCMATERIALLAYERSETUSAGE', [layerSet, enm('AXIS2'), enm('POSITIVE'), round(offsetFromReferenceLine), null]);
      this.layerUsages.set(key, r);
      this.selectKeys.set(r, `layerusage/${this.selectKeys.get(layerSet)}|${round(offsetFromReferenceLine)}`);
    }
    return r;
  }

  /** Single material, or a constituent set when an element is made of several materials. */
  materialSelect(materialIds: string[], name: string): Ref {
    const ids = [...new Set(materialIds.map((m) => getMaterial(m).id))];
    if (ids.length === 1) return this.material(ids[0]);
    const key = ids.join('|');
    let r = this.constituentSets.get(key);
    if (!r) {
      const parts = ids.map((id, i) => this.w.add('IFCMATERIALCONSTITUENT', [i === 0 ? 'Primary' : getMaterial(id).name, null, this.material(id), null, categoryName(getMaterial(id))]));
      r = this.w.add('IFCMATERIALCONSTITUENTSET', [name, null, parts]);
      this.constituentSets.set(key, r);
      this.selectKeys.set(r, `constituents/${key}`);
    }
    return r;
  }

  associateMaterial(obj: Ref, select: Ref): void {
    const list = this.materialRels.get(select) ?? [];
    list.push(obj);
    this.materialRels.set(select, list);
  }

  // --- Properties & quantities ---------------------------------------------------------------

  propertySet(obj: Ref, objKey: string, name: string, props: PropEntry[]): void {
    const values = props.filter(([, v]) => v !== null && v !== undefined);
    if (!values.length) return;
    const pset = this.w.add('IFCPROPERTYSET', [
      ...this.root(`${objKey}/pset/${name}`, name),
      values.map(([n, v]) => this.w.add('IFCPROPERTYSINGLEVALUE', [n, null, v, null])),
    ]);
    this.w.add('IFCRELDEFINESBYPROPERTIES', [...this.root(`${objKey}/rel/pset/${name}`), [obj], pset]);
  }

  quantitySet(obj: Ref, objKey: string, name: string, quantities: QuantityEntry[]): void {
    const qs = quantities.filter(([, , v]) => Number.isFinite(v) && v >= 0);
    if (!qs.length) return;
    const entity: Record<QuantityKind, string> = {
      length: 'IFCQUANTITYLENGTH',
      area: 'IFCQUANTITYAREA',
      volume: 'IFCQUANTITYVOLUME',
      count: 'IFCQUANTITYCOUNT',
      weight: 'IFCQUANTITYWEIGHT',
    };
    const refs = qs.map(([n, kind, v]) => this.w.add(entity[kind], [n, null, null, kind === 'count' ? Math.round(v) : round(v, 6), null]));
    const set = this.w.add('IFCELEMENTQUANTITY', [...this.root(`${objKey}/qto/${name}`, name), 'BaseQuantities', refs]);
    this.w.add('IFCRELDEFINESBYPROPERTIES', [...this.root(`${objKey}/rel/qto/${name}`), [obj], set]);
  }

  // --- Relationships -------------------------------------------------------------------------

  aggregate(key: string, whole: Ref, parts: Ref[]): void {
    if (parts.length) this.w.add('IFCRELAGGREGATES', [...this.root(`rel/aggregates/${key}`), whole, parts]);
  }

  contain(key: string, structure: Ref, elements: Ref[]): void {
    if (elements.length) this.w.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [...this.root(`rel/contains/${key}`), elements, structure]);
  }

  voids(key: string, element: Ref, opening: Ref): void {
    this.w.add('IFCRELVOIDSELEMENT', [...this.root(`rel/voids/${key}`), element, opening]);
  }

  fills(key: string, opening: Ref, element: Ref): void {
    this.w.add('IFCRELFILLSELEMENT', [...this.root(`rel/fills/${key}`), opening, element]);
  }

  /** Write deferred material associations (one relationship per material definition). */
  flushMaterialAssociations(): void {
    for (const [select, objs] of this.materialRels) {
      const key = this.selectKeys.get(select) ?? `ref/${select.id}`;
      this.w.add('IFCRELASSOCIATESMATERIAL', [...this.root(`rel/material/${key}`), objs, select]);
    }
    this.materialRels.clear();
  }
}

function categoryName(m: MaterialDef): string {
  return m.category.charAt(0).toUpperCase() + m.category.slice(1);
}
