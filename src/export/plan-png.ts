import type { Project } from '../core/types';
import { rasterSize, renderDrawingToContext } from '../drawing/canvas';
import { generatePlanDrawing } from '../drawing/plan';
import type { ExportEnv, ExportOptions } from './types';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Insert (or replace) the pHYs chunk so the PNG carries its print resolution: a plan exported at
 * 150 dpi prints at the drawing scale.
 */
export function setPNGResolution(png: Uint8Array, dpi: number): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((v, i) => png[i] !== v)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // Walk chunks: drop an existing pHYs, insert ours after IHDR.
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let off = 8;
  while (off + 12 <= png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const end = off + 12 + len;
    if (type !== 'pHYs') parts.push(png.subarray(off, end));
    if (type === 'IHDR') parts.push(chunk);
    off = end;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Rasterise the plan drawing (browser only). */
export async function exportPlanPNG(project: Project, options: ExportOptions, env: ExportEnv): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('Plan PNG export needs a browser canvas');
  const levelId = options.levelIds?.[0] ?? env.activeLevelId ?? project.levels[0]?.id;
  const plan = generatePlanDrawing(project, levelId, {
    scale: options.scale ?? 100,
    includeFurniture: options.includeFurniture ?? true,
    includeDimensions: options.includeAnnotations ?? true,
    includeRoomTags: options.includeAnnotations ?? true,
  });
  const dpi = options.dpi ?? 150;
  const raster = { dpi, maxWidth: options.width, maxHeight: options.height };
  const size = rasterSize(plan, raster);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D is not available');
  renderDrawingToContext(g, plan, raster);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  const effectiveDpi = size.pxPerMm * 25.4;
  const bytes = setPNGResolution(new Uint8Array(await blob.arrayBuffer()), effectiveDpi);
  return new Blob([bytes as BlobPart], { type: 'image/png' });
}
