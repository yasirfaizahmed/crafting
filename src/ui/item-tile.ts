/**
 * Minecraft-style item tiles: an emoji glyph on a bevelled colour swatch, or a material swatch
 * with a procedural pattern (paint buckets, material pickers).
 */
import { CATEGORY_LABELS, type CatalogCategory, type CatalogItem } from '../core/catalog';
import { getMaterial, hasMaterial, type MaterialDef, type TexturePattern } from '../core/materials';
import { h } from './dom';

const dark = 'rgba(0,0,0,.30)';
const light = 'rgba(255,255,255,.28)';

/** Small SVG tiles that suggest each texture pattern (drawn over the base colour). */
const PATTERN_SVG: Partial<Record<TexturePattern, string>> = {
  brick: `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='10'><path d='M0 .5h16M0 5.5h16M4 .5v5M12 5.5v5' stroke='${dark}' fill='none'/></svg>`,
  block: `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='10'><path d='M0 .5h20M0 5.5h20M.5 .5v5M10.5 5.5v5' stroke='${dark}' fill='none'/></svg>`,
  stone: `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><path d='M0 7 7 5l5 6 6-3M7 5l1-5M12 11l-1 7M3 18l-3-5M18 14l-4 4' stroke='${dark}' fill='none'/></svg>`,
  tiles: `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><path d='M0 .5h10M.5 0v10' stroke='${dark}' stroke-width='1' fill='none'/></svg>`,
  planks: `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='12'><path d='M0 .5h24M0 6.5h24M8 .5v6M20 6.5v6' stroke='${dark}' fill='none'/></svg>`,
  'wood-grain': `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='8'><path d='M0 3c4-2 8 2 12 0s8-2 12 0M0 7c5-1 9 1 14 0s7-1 10 0' stroke='${dark}' fill='none' stroke-width='.8'/></svg>`,
  shingles: `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8'><path d='M0 .5h12M0 4.5h12M3 .5v4M9 4.5v4' stroke='${dark}' fill='none'/><path d='M0 1.5h12M0 5.5h12' stroke='${light}' fill='none' stroke-width='.6'/></svg>`,
  'metal-seam': `<svg xmlns='http://www.w3.org/2000/svg' width='6' height='6'><path d='M.5 0v6' stroke='${dark}'/><path d='M1.5 0v6' stroke='${light}'/></svg>`,
  grass: `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><path d='M2 9l1-3M6 5l1-3M9 11l1-3M4 2l.5-2' stroke='rgba(30,60,10,.45)' fill='none'/><path d='M8 6l.8-2.5M1 4l.6-2' stroke='rgba(190,230,120,.35)' fill='none'/></svg>`,
  gravel: `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><circle cx='2' cy='3' r='1.2' fill='${dark}'/><circle cx='7' cy='7' r='1.4' fill='${dark}'/><circle cx='7.5' cy='2' r='.9' fill='${light}'/><circle cx='3' cy='8' r='.8' fill='${light}'/></svg>`,
  fabric: `<svg xmlns='http://www.w3.org/2000/svg' width='4' height='4'><path d='M0 0l4 4M4 0 0 4' stroke='rgba(0,0,0,.14)' stroke-width='.7'/></svg>`,
  marble: `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><path d='M0 8c6 2 9 8 15 7s9 4 13 9M6 0c1 5 6 7 7 13M20 28c-1-5 2-8 8-9' stroke='rgba(90,90,100,.35)' fill='none' stroke-width='.8'/></svg>`,
  concrete: `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><circle cx='2' cy='2' r='.7' fill='${dark}'/><circle cx='8' cy='5' r='.6' fill='${dark}'/><circle cx='4' cy='9' r='.8' fill='${dark}'/><circle cx='10' cy='10' r='.5' fill='${light}'/><circle cx='6' cy='3' r='.5' fill='${light}'/></svg>`,
};

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** CSS `background` for a material swatch: pattern + bevel sheen + base colour. */
export function materialSwatchBackground(mat: MaterialDef): string {
  const layers: string[] = [];
  const p = PATTERN_SVG[mat.pattern];
  if (p) layers.push(`${svgUrl(p)} 0 0 / auto`);
  if (mat.category === 'glass') layers.push('linear-gradient(135deg, rgba(255,255,255,.55) 0 18%, transparent 18% 40%, rgba(255,255,255,.35) 40% 48%, transparent 48%)');
  if (mat.emissive) layers.push(`radial-gradient(circle at 50% 50%, ${mat.emissive} 0 35%, transparent 70%)`);
  if (mat.metalness > 0.5) layers.push('linear-gradient(160deg, rgba(255,255,255,.45), transparent 45%, rgba(0,0,0,.25))');
  layers.push(mat.color);
  return layers.join(', ');
}

/** The material a catalog item paints / is made of, if any. */
export function itemMaterial(item: CatalogItem): MaterialDef | undefined {
  const id = item.template?.materialId;
  return typeof id === 'string' && hasMaterial(id) ? getMaterial(id) : undefined;
}

export const CATEGORY_ICONS: Record<CatalogCategory, string> = {
  tools: '🛠️',
  structure: '🧱',
  openings: '🚪',
  circulation: '🪜',
  roofs: '🏠',
  living: '🛋️',
  dining: '🍽️',
  bedroom: '🛏️',
  kitchen: '🍳',
  bath: '🛁',
  office: '🖥️',
  lighting: '💡',
  outdoor: '🌳',
  decor: '🪴',
  blocks: '🟫',
  paint: '🎨',
  annotation: '🔤',
};

/** Item tile element. Paint items render as a pure material swatch (no glyph). */
export function itemTile(item: CatalogItem | undefined, cls = ''): HTMLElement {
  const tile = h('span', { class: `cr-tile ${cls}`.trim(), 'aria-hidden': 'true' });
  if (!item) {
    tile.classList.add('is-empty');
    return tile;
  }
  const mat = itemMaterial(item);
  const sw = h('span', { class: 'cr-tile-sw' });
  sw.style.background = item.category === 'paint' && mat ? materialSwatchBackground(mat) : mat && item.category !== 'openings' ? materialSwatchBackground({ ...mat, color: item.color }) : item.color;
  tile.appendChild(sw);
  if (item.category === 'paint') tile.classList.add('is-paint');
  else tile.appendChild(h('span', { class: 'cr-tile-ic' }, item.icon));
  return tile;
}

/** Tooltip lines for an item (Minecraft style: name, category, description). */
export function itemTooltipLines(item: CatalogItem): { text: string; cls?: string }[] {
  const lines: { text: string; cls?: string }[] = [{ text: item.name, cls: 'is-title' }, { text: CATEGORY_LABELS[item.category], cls: 'is-cat' }];
  if (item.description) lines.push({ text: item.description, cls: 'is-desc' });
  const mat = itemMaterial(item);
  if (item.category === 'paint' && mat) lines.push({ text: `${mat.category} · ${mat.pattern === 'none' ? 'plain' : mat.pattern}`, cls: 'is-desc' });
  return lines;
}
