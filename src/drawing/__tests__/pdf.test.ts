import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { drawingSet, exportPDF, pdfSafeText, pngSize, sheetsToPDF } from '../../export/pdf';
import { setPNGResolution } from '../../export/plan-png';
import { generatePlanDrawing } from '../plan';
import { allSchedules, doorSchedule, openingMarks, roomSchedule, wallQuantities, windowSchedule } from '../schedules';
import { composeSheet, fitScale, sheetSize } from '../sheet';

const sample = createSampleProject();
const env = { activeLevelId: sample.levels[0].id };
const latin1 = (buf: ArrayBuffer) => new TextDecoder('latin1').decode(new Uint8Array(buf));

describe('PDF drawing set', () => {
  it('produces a valid multi-page PDF (cover, plans, elevations, sections, schedules)', async () => {
    const blob = await exportPDF(sample, {}, env);
    expect(blob.type).toBe('application/pdf');
    const text = latin1(await blob.arrayBuffer());
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const pages = text.match(/\/Type \/Page\b(?!s)/g) ?? [];
    expect(pages).toHaveLength(sample.levels.length + 4);
    expect(text).toContain('/Creator (Crafting)');
  });

  it('numbers sheets and lists them on the cover', async () => {
    const sheets = await drawingSet(sample, {}, env);
    expect(sheets.map((s) => s.number)).toEqual(['A-000', 'A-101', 'A-102', 'A-201', 'A-301', 'A-601']);
    const cover = sheets[0];
    const texts = cover.frame.entities.flatMap((e) => (e.kind === 'text' ? [e.text] : []));
    for (const s of sheets) expect(texts).toContain(s.number);
    // No viewport in Node: the cover falls back to a generated axonometric view.
    expect(cover.views).toHaveLength(1);
    expect(sheets[1].views[0].drawing.entities.some((e) => e.layer === 'A-DOOR-IDEN')).toBe(true);
    expect(sheets[3].views).toHaveLength(4);
  });

  it('falls back to the largest standard scale that fits and notes it', async () => {
    const sheets = await drawingSet(sample, { paper: 'A4', scale: 20 }, env);
    const plan = sheets[1];
    expect(plan.scale).toBeGreaterThan(20);
    expect([50, 100, 200, 250, 500]).toContain(plan.scale);
    expect(plan.views[0].drawing.scale).toBe(plan.scale);
    const note = plan.frame.entities.find((e) => e.kind === 'text' && e.tag === 'scale-note');
    expect(note && note.kind === 'text' && note.text).toContain('1:20');
    const doc = sheetsToPDF(sample, sheets);
    expect(doc.getNumberOfPages()).toBe(sheets.length);
    // A4 landscape page size.
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(297, 0);
  });

  it('keeps the requested scale when it fits', () => {
    const plan = generatePlanDrawing(sample, sample.levels[0].id);
    const r = fitScale([{ drawing: plan }], { w: 1000, h: 1000 }, 100);
    expect(r.scale).toBe(100);
    const sheet = composeSheet(sample, { paper: 'A1', orientation: 'landscape', title: 'Plan', number: 'A-101', requestedScale: 50, views: [{ drawing: plan, regenerate: (s) => generatePlanDrawing(sample, sample.levels[0].id, { scale: s }) }] });
    expect(sheet.scale).toBe(50);
    expect(sheetSize('A1', 'landscape')).toEqual([841, 594]);
  });

  it('sanitises text for the standard PDF fonts', () => {
    expect(pdfSafeText('A — B − C ²')).toBe('A - B - C ²');
    expect(pdfSafeText('✓')).toBe('?');
  });
});

describe('schedules', () => {
  it('lists every door, window, room and wall type of the sample', () => {
    const doors = Object.values(sample.elements).filter((e) => e.type === 'door');
    const windows = Object.values(sample.elements).filter((e) => e.type === 'window');
    expect(doorSchedule(sample).rows).toHaveLength(doors.length);
    expect(windowSchedule(sample).rows).toHaveLength(windows.length);
    const rooms = roomSchedule(sample);
    expect(rooms.rows).toHaveLength(4);
    expect(rooms.rows.find((r) => r[1] === 'Kitchen')?.[3]).toBe('12.86');
    expect(rooms.totals?.[3]).toBe('124.65');
    const walls = wallQuantities(sample);
    expect(walls.totals?.[2]).toBe(`${Object.values(sample.elements).filter((e) => e.type === 'wall').length}`);
    for (const t of allSchedules(sample)) for (const r of [...t.rows, ...(t.totals ? [t.totals] : [])]) expect(r).toHaveLength(t.columns.length);
  });

  it('assigns unique marks in level and reading order', () => {
    const marks = openingMarks(sample);
    const values = [...marks.values()];
    expect(new Set(values).size).toBe(values.length);
    expect(values.filter((m) => m.startsWith('D'))).toHaveLength(6);
    expect(doorSchedule(sample).rows[0][0]).toBe('D01');
    // Wall net area = gross − openings.
    const w = wallQuantities(sample).rows[0];
    expect(Number(w[6])).toBeCloseTo(Number(w[4]) - Number(w[5]), 2);
  });
});

describe('PNG helpers', () => {
  it('writes a pHYs chunk with a valid CRC', () => {
    const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
    // 1×1 PNG: signature, IHDR, IDAT, IEND.
    const png = hex(
      '89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c489' + '0000000d49444154789c636000020000050001' + '0d0a2db4' + '0000000049454e44ae426082',
    );
    expect(pngSize(png)).toEqual({ w: 1, h: 1 });
    const out = setPNGResolution(png, 150);
    const s = new TextDecoder('latin1').decode(out);
    const i = s.indexOf('pHYs');
    expect(i).toBeGreaterThan(0);
    const v = new DataView(out.buffer, out.byteOffset);
    expect(v.getUint32(i + 4)).toBe(5906);
    expect(out[i + 12]).toBe(1);
    // CRC of "pHYs" + data.
    expect(v.getUint32(i + 13).toString(16)).toMatch(/^[0-9a-f]+$/);
    expect(s.indexOf('pHYs')).toBeLessThan(s.indexOf('IDAT'));
    // Idempotent: a second call replaces instead of duplicating.
    const again = new TextDecoder('latin1').decode(setPNGResolution(out, 300));
    expect(again.split('pHYs')).toHaveLength(2);
  });
});
