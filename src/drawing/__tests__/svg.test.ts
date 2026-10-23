// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { drawingToSVG, exportSVG } from '../../export/svg';
import { generatePlanDrawing } from '../plan';

const INK = 'http://www.inkscape.org/namespaces/inkscape';
const sample = createSampleProject();
/** jsdom's Blob has no text(): read it through FileReader. */
const blobText = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
const parse = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('SVG output', () => {
  const plan = generatePlanDrawing(sample, sample.levels[0].id);
  const svg = drawingToSVG(plan);
  const doc = parse(svg);

  it('is well-formed XML with paper-mm units', () => {
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('width')).toMatch(/mm$/);
    const [, , w, h] = root.getAttribute('viewBox')!.split(' ').map(Number);
    expect(w).toBeCloseTo((plan.bounds.maxX - plan.bounds.minX) / 100 + 20, 3);
    expect(h).toBeCloseTo((plan.bounds.maxY - plan.bounds.minY) / 100 + 20, 3);
  });

  it('groups entities into Inkscape layers named after CAD layers', () => {
    const groups = [...doc.getElementsByTagName('g')];
    const labels = groups.map((g) => g.getAttributeNS(INK, 'label'));
    for (const l of ['A-WALL', 'A-WALL-PATT', 'A-DOOR', 'A-GLAZ', 'A-ANNO-DIMS', 'A-AREA-IDEN']) expect(labels).toContain(l);
    for (const g of groups) expect(g.getAttributeNS(INK, 'groupmode')).toBe('layer');
    const ids = groups.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    const wall = groups.find((g) => g.id === 'A-WALL')!;
    expect(wall.getAttribute('stroke-width')).toBe('0.5');
  });

  it('renders dashes, hatches, arcs and anchored text', () => {
    expect(svg).toContain('stroke-dasharray');
    expect(doc.querySelectorAll('#A-DOOR path').length).toBeGreaterThan(0);
    const texts = [...doc.getElementsByTagName('text')].map((t) => t.textContent);
    expect(texts).toContain('KITCHEN');
    expect(texts).toContain('12250');
    expect(texts.some((t) => t?.includes('m²'))).toBe(true);
    const anchors = new Set([...doc.getElementsByTagName('text')].map((t) => t.getAttribute('text-anchor')));
    expect(anchors.has('middle')).toBe(true);
    expect(anchors.has('start')).toBe(true);
  });

  it('escapes text and exports a blob (plain and on a sheet)', async () => {
    const p = createSampleProject();
    p.info.name = 'A & B <house>';
    const blob = await exportSVG(p, {}, { activeLevelId: p.levels[1].id });
    expect(blob.type).toBe('image/svg+xml');
    const text = await blobText(blob);
    expect(parse(text).getElementsByTagName('parsererror')).toHaveLength(0);
    expect(text).toContain('FIRST FLOOR PLAN');
    const sheet = await blobText(await exportSVG(p, { paper: 'A3', orientation: 'landscape', scale: 100 }, { activeLevelId: p.levels[0].id }));
    const sdoc = parse(sheet);
    expect(sdoc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(sdoc.documentElement.getAttribute('width')).toBe('420mm');
    expect(sheet).toContain('A &amp; B &lt;house&gt;');
    expect(sheet).toContain('A-101');
  });
});
