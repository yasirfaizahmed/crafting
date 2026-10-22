/**
 * IFC4 export validated with web-ifc (the That Open engine): schema arity of every instance,
 * entity counts, spatial structure, properties, quantities, materials and streamed geometry
 * (openings must actually cut the walls).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as WebIFC from 'web-ifc';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement, createProject } from '../../core/defaults';
import type { Door, Element, Project, Wall, Window } from '../../core/types';
import { computeWallFootprints, wallHeight } from '../../core/walls';
import { polygonArea } from '../../core/math2d';
import { exportIFC, projectToIFC } from '../ifc';
import { expandGuid } from './guid';

const req = createRequire(import.meta.url);
const WASM_DIR = dirname(req.resolve('web-ifc')) + '/';

let api: WebIFC.IfcAPI;
const webIfcLog: string[] = [];
const origLog = console.log;
const origErr = console.error;
const origWarn = console.warn;

beforeAll(async () => {
  // web-ifc prints its diagnostics ("[WEB-IFC][error]…") through console; capture them.
  const capture = (orig: (...a: unknown[]) => void) => (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (s.includes('WEB-IFC')) webIfcLog.push(s);
    else orig(...a);
  };
  console.log = capture(origLog);
  console.error = capture(origErr);
  console.warn = capture(origWarn);
  api = new WebIFC.IfcAPI();
  api.SetWasmPath(WASM_DIR, true);
  await api.Init();
  api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_WARN);
}, 60_000);

afterAll(() => {
  console.log = origLog;
  console.error = origErr;
  console.warn = origWarn;
  api?.Dispose();
});

const DUMP = process.env.IFC_DUMP_DIR;
function exportText(p: Project, opts = {}, tag = 'model'): string {
  const text = projectToIFC(p, opts);
  if (DUMP) {
    mkdirSync(DUMP, { recursive: true });
    writeFileSync(join(DUMP, `${tag}.ifc`), text);
  }
  return text;
}

function open(text: string): number {
  webIfcLog.length = 0;
  const id = api.OpenModel(new TextEncoder().encode(text));
  expect(id).toBeGreaterThanOrEqual(0);
  return id;
}

interface Instance {
  id: number;
  type: string;
  args: string[];
}

/** Split a STEP argument list at top-level commas (respecting strings and nesting). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "'") {
        if (s[i + 1] === "'") cur += s[++i];
        else inStr = false;
      }
      continue;
    }
    if (ch === "'") inStr = true;
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseInstances(text: string): Map<number, Instance> {
  const data = text.slice(text.indexOf('DATA;') + 5, text.lastIndexOf('ENDSEC;'));
  const map = new Map<number, Instance>();
  for (const line of data.split('\n')) {
    const m = /^#(\d+)=([A-Z0-9_]+)\((.*)\);$/.exec(line.trim());
    if (!m) continue;
    map.set(Number(m[1]), { id: Number(m[1]), type: m[2], args: splitArgs(m[3]) });
  }
  return map;
}

const refs = (arg: string) => [...arg.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
const ifc4Classes = new Map(Object.entries(WebIFC.IFC4 as unknown as Record<string, unknown>).map(([k, v]) => [k.toUpperCase(), v as { length: number }]));

function idsOf(model: number, type: number): number[] {
  const v = api.GetLineIDsWithType(model, type);
  const out: number[] = [];
  for (let i = 0; i < v.size(); i++) out.push(v.get(i));
  return out;
}

const countOf = (p: Project, pred: (e: Element) => boolean) => Object.values(p.elements).filter(pred).length;

interface MeshStats {
  triangles: number;
  area: number;
  volume: number;
  min: number[];
  max: number[];
  alpha: number[];
}

/** Stream every mesh and accumulate world-space (web-ifc: metres, Y up) stats per product. */
function meshStats(model: number): Map<number, MeshStats> {
  const out = new Map<number, MeshStats>();
  api.StreamAllMeshes(model, (mesh) => {
    const st: MeshStats = { triangles: 0, area: 0, volume: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], alpha: [] };
    for (let g = 0; g < mesh.geometries.size(); g++) {
      const pg = mesh.geometries.get(g);
      const geom = api.GetGeometry(model, pg.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const t = pg.flatTransformation;
      const P = (i: number) => {
        const x = verts[i * 6];
        const y = verts[i * 6 + 1];
        const z = verts[i * 6 + 2];
        return [t[0] * x + t[4] * y + t[8] * z + t[12], t[1] * x + t[5] * y + t[9] * z + t[13], t[2] * x + t[6] * y + t[10] * z + t[14]];
      };
      for (let k = 0; k + 2 < idx.length; k += 3) {
        const a = P(idx[k]);
        const b = P(idx[k + 1]);
        const c = P(idx[k + 2]);
        for (const p of [a, b, c]) for (let d = 0; d < 3; d++) {
          st.min[d] = Math.min(st.min[d], p[d]);
          st.max[d] = Math.max(st.max[d], p[d]);
        }
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        st.area += 0.5 * Math.hypot(cr[0], cr[1], cr[2]);
        st.volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        st.triangles++;
      }
      st.alpha.push(pg.color.w);
      geom.delete();
    }
    out.set(mesh.expressID, st);
  });
  return out;
}

describe('IFC4 export — sample house', () => {
  const project = createSampleProject();
  let text: string;
  let model: number;
  let inst: Map<number, Instance>;

  beforeAll(() => {
    text = exportText(project, {}, 'sample');
    model = open(text);
    inst = parseInstances(text);
  });

  afterAll(() => api.CloseModel(model));

  it('writes a STEP header for IFC4 with view definition and originating system', () => {
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toMatch(/FILE_DESCRIPTION\(\('ViewDefinition \[[A-Za-z_. 0-9]+\]'\),'2;1'\);/);
    expect(text).toMatch(/FILE_NAME\('Sample-House\.ifc','\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d',\('Crafting'\),\(''\),'[^']*','Crafting [^']*','[^']*'\);/);
    expect(text).toContain("FILE_SCHEMA(('IFC4'));");
    expect(api.GetModelSchema(model)).toBe('IFC4');
  });

  it('every instance is a known IFC4 entity with the right number of attributes', () => {
    expect(inst.size).toBeGreaterThan(500);
    for (const i of inst.values()) {
      const cls = ifc4Classes.get(i.type);
      expect(cls, `${i.type} is not an IFC4 entity`).toBeDefined();
      const derived = i.args.filter((a) => a === '*').length;
      expect(i.args.length - derived, `#${i.id} ${i.type} attribute count`).toBe(cls!.length);
      // References must resolve.
      for (const a of i.args) for (const r of refs(a.replace(/'(?:[^']|'')*'/g, ''))) expect(inst.has(r), `#${i.id} → #${r}`).toBe(true);
    }
  });

  it('captures web-ifc diagnostics (sanity check for the assertions below)', () => {
    const solid = text.match(/^#(\d+)=IFCEXTRUDEDAREASOLID\(#\d+,/m)!;
    const broken = text.replace(solid[0], `#${solid[1]}=IFCEXTRUDEDAREASOLID(#999999,`);
    const m = open(broken);
    meshStats(m);
    expect(webIfcLog.some((l) => l.includes('error'))).toBe(true);
    api.CloseModel(m);
  });

  it('parses every line in web-ifc without diagnostics', () => {
    webIfcLog.length = 0;
    for (const id of inst.keys()) expect(() => api.GetLine(model, id)).not.toThrow();
    expect(webIfcLog).toEqual([]);
  });

  it('contains the expected entities for the sample', () => {
    const n = (t: number) => idsOf(model, t).length;
    const walls = countOf(project, (e) => e.type === 'wall');
    const doors = countOf(project, (e) => e.type === 'door');
    const windows = countOf(project, (e) => e.type === 'window');
    expect(n(WebIFC.IFCPROJECT)).toBe(1);
    expect(n(WebIFC.IFCSITE)).toBe(1);
    expect(n(WebIFC.IFCBUILDING)).toBe(1);
    expect(n(WebIFC.IFCBUILDINGSTOREY)).toBe(project.levels.length);
    expect(n(WebIFC.IFCWALL)).toBe(walls);
    expect(n(WebIFC.IFCDOOR)).toBe(doors);
    expect(n(WebIFC.IFCWINDOW)).toBe(windows);
    expect(n(WebIFC.IFCOPENINGELEMENT)).toBe(doors + windows);
    expect(n(WebIFC.IFCRELVOIDSELEMENT)).toBe(doors + windows);
    expect(n(WebIFC.IFCRELFILLSELEMENT)).toBe(doors + windows);
    expect(n(WebIFC.IFCSLAB)).toBe(countOf(project, (e) => e.type === 'slab' && e.kind !== 'ceiling'));
    expect(n(WebIFC.IFCROOF)).toBe(countOf(project, (e) => e.type === 'roof'));
    expect(n(WebIFC.IFCSTAIR)).toBe(countOf(project, (e) => e.type === 'stair'));
    expect(n(WebIFC.IFCRAILING)).toBe(countOf(project, (e) => e.type === 'railing'));
    expect(n(WebIFC.IFCCOLUMN)).toBe(countOf(project, (e) => e.type === 'column'));
    expect(n(WebIFC.IFCSPACE)).toBe(countOf(project, (e) => e.type === 'room'));
    const furnishing =
      n(WebIFC.IFCFURNITURE) + n(WebIFC.IFCSANITARYTERMINAL) + n(WebIFC.IFCELECTRICAPPLIANCE) + n(WebIFC.IFCLIGHTFIXTURE) + n(WebIFC.IFCGEOGRAPHICELEMENT);
    const blocks = countOf(project, (e) => e.type === 'block');
    expect(furnishing + n(WebIFC.IFCBUILDINGELEMENTPROXY) - blocks).toBe(countOf(project, (e) => e.type === 'furniture'));
    expect(n(WebIFC.IFCSANITARYTERMINAL)).toBe(2);
    expect(n(WebIFC.IFCELECTRICAPPLIANCE)).toBe(2);
    expect(n(WebIFC.IFCLIGHTFIXTURE)).toBe(1);
    // Units: mm, m², m³, radian.
    const units = idsOf(model, WebIFC.IFCSIUNIT).map((id) => api.GetLine(model, id));
    const unit = (t: string) => units.find((u) => u.UnitType.value === t);
    expect(unit('LENGTHUNIT')?.Prefix?.value).toBe('MILLI');
    expect(unit('AREAUNIT')?.Name.value).toBe('SQUARE_METRE');
    expect(unit('VOLUMEUNIT')?.Name.value).toBe('CUBIC_METRE');
    expect(unit('PLANEANGLEUNIT')?.Name.value).toBe('RADIAN');
  });

  it('builds the spatial hierarchy and contains every element exactly once', () => {
    const storeys = idsOf(model, WebIFC.IFCBUILDINGSTOREY).map((id) => api.GetLine(model, id));
    expect(storeys.map((s) => s.Elevation.value)).toEqual(project.levels.map((l) => l.elevation));
    expect(storeys.map((s) => s.Name.value)).toEqual(project.levels.map((l) => l.name));

    const contained = new Map<number, number>();
    for (const id of idsOf(model, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const rel = api.GetLine(model, id);
      for (const e of rel.RelatedElements) contained.set(e.value, (contained.get(e.value) ?? 0) + 1);
    }
    for (const t of [WebIFC.IFCWALL, WebIFC.IFCDOOR, WebIFC.IFCWINDOW, WebIFC.IFCSLAB, WebIFC.IFCROOF, WebIFC.IFCSTAIR, WebIFC.IFCFURNITURE, WebIFC.IFCCOLUMN]) {
      for (const id of idsOf(model, t)) expect(contained.get(id), `#${id}`).toBe(1);
    }
    // Openings and spaces are not contained (voids / aggregation instead).
    for (const id of idsOf(model, WebIFC.IFCOPENINGELEMENT)) expect(contained.has(id)).toBe(false);
    for (const id of idsOf(model, WebIFC.IFCSPACE)) expect(contained.has(id)).toBe(false);

    const parts = new Map<number, number[]>();
    for (const id of idsOf(model, WebIFC.IFCRELAGGREGATES)) {
      const rel = api.GetLine(model, id);
      parts.set(rel.RelatingObject.value, rel.RelatedObjects.map((r: { value: number }) => r.value));
    }
    const [proj] = idsOf(model, WebIFC.IFCPROJECT);
    const [site] = idsOf(model, WebIFC.IFCSITE);
    const [building] = idsOf(model, WebIFC.IFCBUILDING);
    expect(parts.get(proj)).toEqual([site]);
    expect(parts.get(site)).toEqual([building]);
    expect(parts.get(building)).toEqual(idsOf(model, WebIFC.IFCBUILDINGSTOREY));
    const spaces = idsOf(model, WebIFC.IFCSPACE);
    const aggregatedSpaces = idsOf(model, WebIFC.IFCBUILDINGSTOREY).flatMap((s) => parts.get(s) ?? []);
    expect(aggregatedSpaces.sort()).toEqual([...spaces].sort());
  });

  it('uses unique, stable GlobalIds derived from element ids', () => {
    const guids = [...inst.values()].filter((i) => /^'[0-9A-Za-z_$]{22}'$/.test(i.args[0] ?? '')).map((i) => i.args[0].slice(1, -1));
    expect(guids.length).toBeGreaterThan(100);
    expect(new Set(guids).size).toBe(guids.length);
    for (const g of guids) expect(() => expandGuid(g)).not.toThrow();
    const again = parseInstances(projectToIFC(project));
    const guids2 = [...again.values()].filter((i) => /^'[0-9A-Za-z_$]{22}'$/.test(i.args[0] ?? '')).map((i) => i.args[0].slice(1, -1));
    expect(guids2).toEqual(guids);
    // Tag carries the Crafting element id.
    const wall = Object.values(project.elements).find((e) => e.type === 'wall')!;
    const tagged = idsOf(model, WebIFC.IFCWALL).map((id) => api.GetLine(model, id)).find((w) => w.Tag?.value === wall.id);
    expect(tagged).toBeDefined();
  });

  it('spaces carry number, name and floor area', async () => {
    const room = Object.values(project.elements).find((e) => e.type === 'room' && e.number === '002')!;
    const space = idsOf(model, WebIFC.IFCSPACE).map((id) => api.GetLine(model, id)).find((s) => s.Name.value === '002');
    expect(space?.LongName.value).toBe('Kitchen');
    const psets = await api.properties.getPropertySets(model, space.expressID, true);
    const qto = psets.find((p) => p.Name?.value === 'Qto_SpaceBaseQuantities');
    const area = qto.Quantities.find((q: { Name: { value: string } }) => q.Name.value === 'NetFloorArea');
    expect(area.AreaValue.value).toBeCloseTo(polygonArea(room.type === 'room' ? room.outline : []) / 1e6, 3);
  });

  it('writes Pset_WallCommon with LoadBearing / IsExternal and wall quantities', async () => {
    const walls = idsOf(model, WebIFC.IFCWALL).map((id) => api.GetLine(model, id));
    let ext = 0;
    let int = 0;
    for (const w of walls) {
      const el = project.elements[w.Tag.value] as Wall;
      const psets = await api.properties.getPropertySets(model, w.expressID, true);
      const common = psets.find((p) => p.Name?.value === 'Pset_WallCommon');
      const prop = (n: string) => common.HasProperties.find((h: { Name: { value: string } }) => h.Name.value === n)?.NominalValue.value;
      expect(prop('LoadBearing')).toBe(el.structural);
      // Sample: the four perimeter walls of each level are external (structural brick), partitions internal.
      expect(prop('IsExternal')).toBe(el.thickness === 250);
      if (prop('IsExternal')) ext++;
      else int++;
      const qto = psets.find((p) => p.Name?.value === 'Qto_WallBaseQuantities');
      const q = (n: string) => qto.Quantities.find((h: { Name: { value: string } }) => h.Name.value === n);
      expect(q('Width').LengthValue.value).toBeCloseTo(el.thickness, 3);
      expect(q('Height').LengthValue.value).toBeCloseTo(wallHeight(project, el), 3);
      expect(q('NetSideArea').AreaValue.value).toBeLessThanOrEqual(q('GrossSideArea').AreaValue.value);
    }
    expect(ext).toBe(8);
    expect(int).toBe(5);
  });

  it('associates walls with a material layer set usage of the wall thickness', () => {
    const usageOf = new Map<number, number>();
    for (const id of idsOf(model, WebIFC.IFCRELASSOCIATESMATERIAL)) {
      const rel = api.GetLine(model, id);
      for (const o of rel.RelatedObjects) usageOf.set(o.value, rel.RelatingMaterial.value);
    }
    for (const id of idsOf(model, WebIFC.IFCWALL)) {
      const w = api.GetLine(model, id);
      const el = project.elements[w.Tag.value] as Wall;
      const usage = api.GetLine(model, usageOf.get(id)!);
      expect(api.GetNameFromTypeCode(api.GetLineType(model, usage.expressID)).toUpperCase()).toBe('IFCMATERIALLAYERSETUSAGE');
      const set = api.GetLine(model, usage.ForLayerSet.value);
      const total = set.MaterialLayers.reduce((s: number, l: { value: number }) => s + api.GetLine(model, l.value).LayerThickness.value, 0);
      expect(total).toBeCloseTo(el.thickness, 3);
      expect(usage.OffsetFromReferenceLine.value).toBeCloseTo(-el.thickness / 2, 3);
    }
    // Every door / window / slab has a material too.
    for (const t of [WebIFC.IFCDOOR, WebIFC.IFCWINDOW, WebIFC.IFCSLAB, WebIFC.IFCROOF]) for (const id of idsOf(model, t)) expect(usageOf.has(id)).toBe(true);
  });

  it('doors and windows report overall size and operation types', () => {
    const doors = idsOf(model, WebIFC.IFCDOOR).map((id) => api.GetLine(model, id));
    for (const d of doors) {
      const el = project.elements[d.Tag.value] as Door;
      expect(d.OverallWidth.value).toBe(el.width);
      expect(d.OverallHeight.value).toBe(el.height);
      expect(d.PredefinedType.value).toBe('DOOR');
      expect(d.OperationType.value).toMatch(el.style === 'sliding' ? /^SLIDING_TO_/ : /^SINGLE_SWING_/);
    }
    const windows = idsOf(model, WebIFC.IFCWINDOW).map((id) => api.GetLine(model, id));
    for (const w of windows) {
      const el = project.elements[w.Tag.value] as Window;
      expect(w.OverallWidth.value).toBe(el.width);
      expect(w.PartitioningType.value).toBe(el.style === 'sliding' ? 'DOUBLE_PANEL_VERTICAL' : 'SINGLE_PANEL');
    }
  });

  it('streams geometry for every physical element', () => {
    const stats = meshStats(model);
    const want = [WebIFC.IFCWALL, WebIFC.IFCSLAB, WebIFC.IFCROOF, WebIFC.IFCDOOR, WebIFC.IFCWINDOW, WebIFC.IFCSTAIR, WebIFC.IFCCOLUMN, WebIFC.IFCRAILING, WebIFC.IFCFURNITURE, WebIFC.IFCBUILDINGELEMENTPROXY];
    for (const t of want) {
      const ids = idsOf(model, t);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(stats.get(id)?.triangles ?? 0, `${api.GetNameFromTypeCode(t)} #${id}`).toBeGreaterThan(0);
    }
    // Ground-floor walls stand from 0 to 3 m (web-ifc output is metres, Y up).
    const wall = idsOf(model, WebIFC.IFCWALL).map((id) => api.GetLine(model, id)).find((w) => (project.elements[w.Tag.value] as Wall).levelId === project.levels[0].id)!;
    const ws = stats.get(wall.expressID)!;
    expect(ws.min[1]).toBeCloseTo(0, 3);
    expect(ws.max[1]).toBeCloseTo(3, 3);
    // The foundation slab spans the footprint, 300 mm below level 0.
    const foundation = idsOf(model, WebIFC.IFCSLAB).map((id) => api.GetLine(model, id)).find((s) => s.PredefinedType.value === 'BASESLAB')!;
    const fs = stats.get(foundation.expressID)!;
    expect(fs.min[1]).toBeCloseTo(-0.3, 3);
    expect(fs.max[0] - fs.min[0]).toBeCloseTo(12.25, 3);
    expect(fs.max[2] - fs.min[2]).toBeCloseTo(8.25, 3);
    // Glass is transparent.
    const glassy = idsOf(model, WebIFC.IFCWINDOW).every((id) => Math.min(...stats.get(id)!.alpha) < 0.6);
    expect(glassy).toBe(true);
    expect(webIfcLog).toEqual([]);
  });

  it('cuts openings out of the walls (net volume = gross − openings)', () => {
    const solid = structuredClone(project);
    for (const [id, e] of Object.entries(solid.elements)) if (e.type === 'door' || e.type === 'window') delete solid.elements[id];
    const solidModel = open(projectToIFC(solid));
    const solidStats = meshStats(solidModel);
    const cutStats = meshStats(model);
    const byTag = (m: number) => new Map(idsOf(m, WebIFC.IFCWALL).map((id) => [api.GetLine(m, id).Tag.value as string, id]));
    const solidIds = byTag(solidModel);
    const cutIds = byTag(model);
    let checked = 0;
    for (const lvl of project.levels) {
      const fps = computeWallFootprints(project, lvl.id);
      for (const [wallId, fp] of fps) {
        const w = project.elements[wallId] as Wall;
        const ops = Object.values(project.elements).filter((e): e is Door | Window => (e.type === 'door' || e.type === 'window') && e.hostId === wallId);
        const gross = (polygonArea(fp.polygon) * wallHeight(project, w)) / 1e9;
        const sv = solidStats.get(solidIds.get(wallId)!)!.volume;
        const cv = cutStats.get(cutIds.get(wallId)!)!.volume;
        expect(sv).toBeCloseTo(gross, 4);
        const removed = ops.reduce((s, o) => s + (o.width * o.height * w.thickness) / 1e9, 0);
        expect(cv).toBeCloseTo(gross - removed, 3);
        if (ops.length) {
          expect(cv).toBeLessThan(sv);
          expect(cutStats.get(cutIds.get(wallId)!)!.area).toBeLessThan(solidStats.get(solidIds.get(wallId)!)!.area);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
    api.CloseModel(solidModel);
  });

  it('exportIFC returns a STEP blob', async () => {
    const blob = await exportIFC(project, {}, { activeLevelId: project.levels[0].id });
    expect(blob.type).toBe('application/x-step');
    expect((await blob.text()).startsWith('ISO-10303-21;')).toBe(true);
  });
});

describe('IFC4 export — options and edge cases', () => {
  it('filters levels and furniture', () => {
    const p = createSampleProject();
    const ground = p.levels[0];
    const text = exportText(p, { levelIds: [ground.id], includeFurniture: false }, 'filtered');
    const model = open(text);
    expect(idsOf(model, WebIFC.IFCBUILDINGSTOREY)).toHaveLength(1);
    expect(idsOf(model, WebIFC.IFCFURNITURE)).toHaveLength(0);
    expect(idsOf(model, WebIFC.IFCSANITARYTERMINAL)).toHaveLength(0);
    expect(idsOf(model, WebIFC.IFCWALL)).toHaveLength(countOf(p, (e) => e.type === 'wall' && e.levelId === ground.id));
    expect(idsOf(model, WebIFC.IFCROOF)).toHaveLength(0);
    api.CloseModel(model);
  });

  it('writes the true north direction from the project settings', () => {
    const p = createProject('North');
    p.settings.northAngle = 90;
    const model = open(exportText(p, {}, 'north'));
    const [ctx] = idsOf(model, WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT);
    const north = api.GetLine(model, api.GetLine(model, ctx).TrueNorth.value);
    expect(north.DirectionRatios.map((d: { value: number }) => d.value)).toEqual([-1, 0]);
    api.CloseModel(model);
  });

  it('handles every element type, unusual values and broken data robustly', () => {
    const p = createProject("Edge — 'cases' \\ ünïcödé");
    p.info.author = 'Zoë O\'Neill';
    p.info.address = '1 Main Street, Springfield';
    const L = p.levels[0].id;
    const add = (e: Element) => (p.elements[e.id] = e);
    const w1 = add(createElement('wall', L, { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, thickness: 200, structural: true, leftFinishId: 'paint-sage', rightFinishId: 'tile-white', props: { fireRating: 'EI60', uValue: 0.28, count: 3, acoustic: true } })) as Wall;
    const w2 = add(createElement('wall', L, { start: { x: 5000, y: 0 }, end: { x: 5000, y: 4000 }, thickness: 300, justification: 'left' })) as Wall;
    add(createElement('wall', L, { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } })); // zero-length
    add(createElement('wall', L, { start: { x: 0, y: 4000 }, end: { x: 3000, y: 6000 }, height: 2400, baseOffset: 300, justification: 'right' }));
    for (const style of ['single', 'double', 'sliding', 'pocket', 'garage', 'opening'] as const) {
      add(createElement('door', L, { hostId: style === 'garage' ? w2.id : w1.id, offset: style === 'garage' ? 2000 : 600 + ['single', 'double', 'sliding', 'pocket', 'opening'].indexOf(style) * 900, width: 800, height: 2000, style, flip: style === 'double', hinge: 'right' }));
    }
    add(createElement('window', L, { hostId: 'missing', offset: 100 })); // orphan
    add(createElement('slab', L, { outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })); // degenerate
    add(createElement('slab', L, { outline: [{ x: 0, y: 0 }, { x: 0, y: 3000 }, { x: 3000, y: 3000 }, { x: 3000, y: 0 }], kind: 'ceiling', topOffset: 3000, thickness: 20 })); // clockwise
    add(createElement('slab', L, { outline: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 4000 }, { x: 0, y: 4000 }], kind: 'terrace', holes: [[{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 2000 }, { x: 1000, y: 2000 }]] }));
    add(createElement('column', L, { position: { x: 2000, y: 2000 }, shape: 'round', width: 400, depth: 400 }));
    add(createElement('column', L, { position: { x: 2500, y: 2000 }, shape: 'round', width: 400, depth: 250, rotation: 30 }));
    add(createElement('beam', L, { start: { x: 0, y: 1000 }, end: { x: 4000, y: 3000 }, width: 200, depth: 400 }));
    add(createElement('beam', L, { start: { x: 0, y: 1000 }, end: { x: 0, y: 1000 } })); // zero-length
    for (const shape of ['box', 'cylinder', 'wedge', 'sphere'] as const) add(createElement('block', L, { shape, position: { x: 6000, y: 0, z: 0 }, rotation: 45 }));
    add(createElement('railing', L, { path: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], style: 'glass' }));
    add(createElement('railing', L, { path: [{ x: 0, y: 0 }] })); // degenerate
    add(createElement('stair', L, { shape: 'spiral', position: { x: 8000, y: 0 } }));
    add(createElement('roof', L, { outline: [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: 0, y: 4000 }], shape: 'pyramid' }));
    add(createElement('room', L, { name: 'Ünïcödé — Room', outline: [{ x: 100, y: 100 }, { x: 4900, y: 100 }, { x: 4900, y: 3900 }, { x: 100, y: 3900 }], floorMaterialId: 'tile-grey' }));
    add(createElement('furniture', L, { catalogId: 'unknown-thing', position: { x: 1000, y: 1000 } }));
    add(createElement('label', L, { text: 'ignored' }));
    const hidden = add(createElement('furniture', L, { catalogId: 'sofa-3', hidden: true }));

    const text = exportText(p, {}, 'edge');
    const inst = parseInstances(text);
    for (const i of inst.values()) {
      const cls = ifc4Classes.get(i.type);
      expect(cls, i.type).toBeDefined();
      expect(i.args.length - i.args.filter((a) => a === '*').length, `#${i.id} ${i.type}`).toBe(cls!.length);
    }
    const model = open(text);
    for (const id of inst.keys()) api.GetLine(model, id);
    expect(idsOf(model, WebIFC.IFCWALL)).toHaveLength(3);
    expect(idsOf(model, WebIFC.IFCDOOR)).toHaveLength(5); // the cased opening has no door leaf
    expect(idsOf(model, WebIFC.IFCOPENINGELEMENT)).toHaveLength(6);
    expect(idsOf(model, WebIFC.IFCWINDOW)).toHaveLength(0);
    expect(idsOf(model, WebIFC.IFCCOVERING)).toHaveLength(1);
    expect(idsOf(model, WebIFC.IFCSLAB)).toHaveLength(1);
    expect(idsOf(model, WebIFC.IFCCOLUMN)).toHaveLength(2);
    expect(idsOf(model, WebIFC.IFCBEAM)).toHaveLength(1);
    expect(idsOf(model, WebIFC.IFCBUILDINGELEMENTPROXY)).toHaveLength(4);
    expect(idsOf(model, WebIFC.IFCRAILING)).toHaveLength(1);
    expect(idsOf(model, WebIFC.IFCFURNITURE)).toHaveLength(1);
    expect(text).not.toContain(hidden.id);
    const proj = api.GetLine(model, idsOf(model, WebIFC.IFCPROJECT)[0]);
    expect(proj.Name.value).toBe("Edge — 'cases' \\ ünïcödé");
    const ops = idsOf(model, WebIFC.IFCDOOR).map((id) => api.GetLine(model, id).OperationType.value).sort();
    expect(ops).toEqual(['DOUBLE_DOOR_SINGLE_SWING', 'ROLLINGUP', 'SINGLE_SWING_LEFT', 'SLIDING_TO_LEFT', 'USERDEFINED']);
    const stats = meshStats(model);
    for (const t of [WebIFC.IFCWALL, WebIFC.IFCCOLUMN, WebIFC.IFCBEAM, WebIFC.IFCSLAB, WebIFC.IFCCOVERING, WebIFC.IFCBUILDINGELEMENTPROXY, WebIFC.IFCROOF, WebIFC.IFCSTAIR]) {
      for (const id of idsOf(model, t)) expect(stats.get(id)?.triangles ?? 0, `${api.GetNameFromTypeCode(t)} #${id}`).toBeGreaterThan(0);
    }
    // The beam runs 4472 mm along its axis at the level height.
    const beam = stats.get(idsOf(model, WebIFC.IFCBEAM)[0])!;
    expect(beam.max[1]).toBeCloseTo(3, 3);
    expect(beam.min[1]).toBeCloseTo(2.6, 3);
    expect(beam.volume).toBeCloseTo((0.2 * 0.4 * Math.hypot(4000, 2000)) / 1000, 4);
    expect(webIfcLog).toEqual([]);
    api.CloseModel(model);
  });

  it('exports an empty project', () => {
    const model = open(exportText(createProject('Empty'), {}, 'empty'));
    expect(idsOf(model, WebIFC.IFCBUILDINGSTOREY)).toHaveLength(1);
    expect(idsOf(model, WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)).toHaveLength(0);
    api.CloseModel(model);
  });
});
