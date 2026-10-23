import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { drawingsToDXF, dxfLineweight, dxfText, encodeCP1252, exportDXF, nearestACI } from '../../export/dxf';
import { generatePlanDrawing } from '../plan';

type Pair = [number, string];

/** Parse a DXF document into (code, value) pairs, asserting the two-line structure. */
function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  expect(lines.length % 2).toBe(0);
  const out: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    expect(Number.isInteger(code), `line ${i + 1}: "${lines[i]}"`).toBe(true);
    out.push([code, lines[i + 1]]);
  }
  return out;
}

/** Structural DXF validation; returns entities (type + layer) for further checks. */
function validate(text: string) {
  const ps = pairs(text);
  expect(ps[ps.length - 1]).toEqual([0, 'EOF']);
  let section: string | null = null;
  let table: string | null = null;
  const sections: string[] = [];
  const handles = new Set<string>();
  const layers = new Set<string>();
  const ltypes = new Set<string>();
  const entities: { type: string; layer: string; linetype?: string }[] = [];
  let current: { type: string; layer: string; linetype?: string } | null = null;
  let recordType = '';
  for (let i = 0; i < ps.length; i++) {
    const [c, v] = ps[i];
    if (c === 0 && v === 'SECTION') {
      expect(section).toBeNull();
      section = ps[++i][1];
      sections.push(section);
      continue;
    }
    if (c === 0 && v === 'ENDSEC') {
      expect(section).not.toBeNull();
      expect(table).toBeNull();
      section = null;
      continue;
    }
    if (c === 0 && v === 'TABLE') {
      expect(table).toBeNull();
      table = ps[i + 1][1];
      continue;
    }
    if (c === 0 && v === 'ENDTAB') {
      expect(table).not.toBeNull();
      table = null;
      continue;
    }
    if (c === 0) {
      recordType = v;
      if (section === 'ENTITIES') {
        current = { type: v, layer: '' };
        entities.push(current);
      } else current = null;
    }
    if ((c === 5 || c === 105) && section !== 'HEADER') {
      expect(/^[0-9A-F]+$/.test(v), `handle ${v}`).toBe(true);
      expect(handles.has(v), `duplicate handle ${v}`).toBe(false);
      handles.add(v);
    }
    if (c === 2 && section === 'TABLES' && recordType === 'LAYER') layers.add(v);
    if (c === 2 && section === 'TABLES' && recordType === 'LTYPE') ltypes.add(v);
    if (current && c === 8) current.layer = v;
    if (current && c === 6) current.linetype = v;
  }
  expect(section).toBeNull();
  expect(sections).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
  for (const e of entities) {
    expect(layers.has(e.layer), `layer ${e.layer} of ${e.type}`).toBe(true);
    if (e.linetype) expect(ltypes.has(e.linetype)).toBe(true);
  }
  // $HANDSEED must exceed every handle.
  const seedIdx = ps.findIndex(([c, v]) => c === 9 && v === '$HANDSEED');
  const seed = parseInt(ps[seedIdx + 1][1], 16);
  for (const h of handles) expect(parseInt(h, 16)).toBeLessThan(seed);
  return { ps, entities, layers, ltypes, handles };
}

const sample = createSampleProject();

describe('DXF output', () => {
  const plan = generatePlanDrawing(sample, sample.levels[0].id);
  const text = drawingsToDXF([plan]);
  const v = validate(text);

  it('is a structurally valid AC1015 document', () => {
    const header = v.ps.slice(0, 200);
    const val = (name: string) => header[header.findIndex(([c, x]) => c === 9 && x === name) + 1];
    expect(val('$ACADVER')).toEqual([1, 'AC1015']);
    expect(val('$INSUNITS')).toEqual([70, '4']);
    expect(val('$MEASUREMENT')).toEqual([70, '1']);
    expect(Number(val('$LTSCALE')[1])).toBe(100);
    expect(text).toContain('AcDbDictionaryWithDefault');
  });

  it('declares every standard layer with colour, linetype and lineweight', () => {
    for (const l of plan.layers) expect(v.layers.has(l.name), l.name).toBe(true);
    for (const lt of ['Continuous', 'DASHED', 'HIDDEN', 'CENTER', 'PHANTOM', 'DOT', 'ByLayer', 'ByBlock']) expect(v.ltypes.has(lt), lt).toBe(true);
    const i = v.ps.findIndex(([c, x]) => c === 2 && x === 'A-WALL');
    const rec = v.ps.slice(i, i + 8);
    expect(rec).toContainEqual([370, '50']);
    expect(rec).toContainEqual([6, 'Continuous']);
  });

  it('writes the expected entity types (dimensions exploded, hatches native)', () => {
    const types = new Set(v.entities.map((e) => e.type));
    for (const t of ['LINE', 'LWPOLYLINE', 'ARC', 'CIRCLE', 'TEXT', 'HATCH']) expect(types.has(t), t).toBe(true);
    expect(types.has('DIMENSION')).toBe(false);
    expect(v.entities.filter((e) => e.layer === 'A-ANNO-DIMS' && e.type === 'LINE').length).toBeGreaterThan(20);
    expect(v.entities.filter((e) => e.type === 'ARC' && e.layer === 'A-DOOR')).toHaveLength(4);
    expect(text).toContain('ANSI31');
    expect(v.entities.some((e) => e.type === 'LWPOLYLINE' && e.linetype === 'HIDDEN')).toBe(true);
  });

  it('places multiple levels side by side and encodes text for ANSI_1252', async () => {
    const blob = await exportDXF(sample, {}, { activeLevelId: sample.levels[0].id });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const decoded = new TextDecoder('windows-1252').decode(bytes);
    const both = validate(decoded);
    expect(both.entities.length).toBeGreaterThan(v.entities.length);
    expect(decoded).toContain('FIRST FLOOR PLAN');
    expect(decoded).toContain('m²');
    expect(bytes.includes(0xb2)).toBe(true);
    // Only one level requested.
    const one = new TextDecoder('windows-1252').decode(new Uint8Array(await (await exportDXF(sample, { levelIds: [sample.levels[1].id] }, { activeLevelId: '' })).arrayBuffer()));
    expect(one).not.toContain('GROUND FLOOR PLAN');
  });

  it('maps colours, lineweights and text safely', () => {
    expect(nearestACI('#000000')).toBe(7);
    expect(nearestACI('#ff0000')).toBe(1);
    expect(nearestACI('#0000ff')).toBe(5);
    expect(dxfLineweight(0.5)).toBe(50);
    expect(dxfLineweight(0.13)).toBe(13);
    expect(dxfLineweight(0.7)).toBe(70);
    expect(dxfText('a\nb')).toBe('a b');
    expect(dxfText('Ø ²')).toBe('Ø ²');
    expect(dxfText('✓')).toBe('\\U+2713');
    expect([...encodeCP1252('—²')]).toEqual([0x97, 0xb2]);
  });

  it('handles empty input', () => {
    expect(() => validate(drawingsToDXF([]))).not.toThrow();
  });
});
