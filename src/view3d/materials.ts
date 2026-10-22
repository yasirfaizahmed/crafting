/**
 * MaterialDef → three.js MeshStandardMaterial cache with procedural textures, plus cheap state
 * variants (hover / selected / x-ray / ghost / polygon-offset) that share the base textures.
 */
import * as THREE from 'three';
import { getMaterial, type MaterialDef } from '../core/materials';
import { drawPattern } from './textures';

export interface MaterialVariant {
  highlight?: 'hover' | 'selected';
  xray?: boolean;
  ghost?: boolean;
  /** Pull coplanar faces toward the camera (floor finishes lying on structural slabs). */
  raised?: boolean;
}

export const HOVER_COLOR = '#7fb4ff';
export const SELECT_COLOR = '#2f7dff';
export const INVALID_COLOR = '#ff4747';

/** Texture repeats per metre of UV (UVs are metres of surface). */
export function textureRepeat(def: Pick<MaterialDef, 'patternSize'>): number {
  return 1000 / Math.max(1, def.patternSize);
}

function bumpScaleFor(def: MaterialDef): number {
  switch (def.pattern) {
    case 'brick':
    case 'stone':
    case 'shingles':
      return 1.2;
    case 'block':
    case 'gravel':
      return 0.9;
    default:
      return 0.5;
  }
}

function variantKey(id: string, v: MaterialVariant): string {
  return `${id}|${v.highlight ?? ''}|${v.xray ? 'x' : ''}|${v.ghost ? 'g' : ''}|${v.raised ? 'r' : ''}`;
}

interface TextureSet {
  map?: THREE.Texture;
  bump?: THREE.Texture;
}

export interface MaterialLibraryOptions {
  /** Generate procedural textures (default true; falls back to flat colour without a 2D canvas). */
  textures?: boolean;
  anisotropy?: number;
}

export class MaterialLibrary {
  private readonly base = new Map<string, THREE.MeshStandardMaterial>();
  private readonly variants = new Map<string, THREE.MeshStandardMaterial>();
  private readonly textures = new Map<string, TextureSet>();
  /** Translucent red used for invalid ghosts. */
  readonly invalid: THREE.MeshStandardMaterial;
  private readonly useTextures: boolean;
  private readonly anisotropy: number;

  constructor(opts: MaterialLibraryOptions = {}) {
    this.useTextures = opts.textures ?? true;
    this.anisotropy = opts.anisotropy ?? 4;
    this.invalid = new THREE.MeshStandardMaterial({
      color: INVALID_COLOR,
      emissive: INVALID_COLOR,
      emissiveIntensity: 0.45,
      roughness: 0.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    this.invalid.name = 'ghost-invalid';
  }

  /** Material definition (with fallback) for an id. */
  def(id: string | undefined): MaterialDef {
    return getMaterial(id);
  }

  /** Shared material for `id` in the requested state. Never dispose the returned material yourself. */
  get(id: string | undefined, v: MaterialVariant = {}): THREE.MeshStandardMaterial {
    const def = getMaterial(id);
    const base = this.baseFor(def);
    if (!v.highlight && !v.xray && !v.ghost && !v.raised) return base;
    const key = variantKey(def.id, v);
    let m = this.variants.get(key);
    if (!m) {
      m = base.clone();
      m.name = `${def.id}:${key}`;
      if (v.raised) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = -1;
        m.polygonOffsetUnits = -2;
      }
      if (v.xray) {
        m.transparent = true;
        m.opacity = Math.min(0.22, def.opacity);
        m.depthWrite = false;
        m.side = THREE.DoubleSide;
      }
      if (v.ghost) {
        m.transparent = true;
        m.opacity = Math.min(0.55, def.opacity < 1 ? def.opacity + 0.2 : 0.55);
        m.depthWrite = false;
        m.emissive.set('#4d8dff');
        m.emissiveIntensity = 0.18;
      }
      if (v.highlight) {
        m.emissive.set(v.highlight === 'selected' ? SELECT_COLOR : HOVER_COLOR);
        m.emissiveIntensity = v.highlight === 'selected' ? 0.5 : 0.28;
      }
      this.variants.set(key, m);
    }
    return m;
  }

  /** Display colour of a material (for particles / swatches). */
  color(id: string | undefined): string {
    return getMaterial(id).color;
  }

  /** True when the material renders as transparent (glass, water). */
  isTransparent(id: string | undefined): boolean {
    return getMaterial(id).opacity < 1;
  }

  /** Number of cached materials (base + variants), for diagnostics/tests. */
  get size(): number {
    return this.base.size + this.variants.size;
  }

  dispose(): void {
    for (const m of this.variants.values()) m.dispose();
    for (const m of this.base.values()) m.dispose();
    for (const t of this.textures.values()) {
      t.map?.dispose();
      t.bump?.dispose();
    }
    this.invalid.dispose();
    this.variants.clear();
    this.base.clear();
    this.textures.clear();
  }

  private baseFor(def: MaterialDef): THREE.MeshStandardMaterial {
    let m = this.base.get(def.id);
    if (m) return m;
    const tex = this.texturesFor(def);
    const transparent = def.opacity < 1;
    m = new THREE.MeshStandardMaterial({
      color: tex.map ? '#ffffff' : def.color,
      map: tex.map ?? null,
      bumpMap: tex.bump ?? null,
      bumpScale: tex.bump ? bumpScaleFor(def) : 1,
      roughness: def.roughness,
      metalness: def.metalness,
      transparent,
      opacity: def.opacity,
      depthWrite: !transparent,
      side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (def.emissive) {
      m.emissive.set(def.emissive);
      m.emissiveIntensity = 1.6;
    }
    if (def.category === 'glass') m.envMapIntensity = 1.6;
    m.name = def.id;
    m.userData.materialId = def.id;
    this.base.set(def.id, m);
    return m;
  }

  private texturesFor(def: MaterialDef): TextureSet {
    let t = this.textures.get(def.id);
    if (t) return t;
    t = {};
    if (this.useTextures && def.pattern !== 'none') {
      const img = drawPattern(def);
      if (img) {
        const r = textureRepeat(def);
        const setup = (tex: THREE.Texture) => {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set(r, r);
          tex.anisotropy = this.anisotropy;
          tex.needsUpdate = true;
          return tex;
        };
        t.map = setup(new THREE.CanvasTexture(img.color));
        t.map.colorSpace = THREE.SRGBColorSpace;
        if (img.bump) t.bump = setup(new THREE.CanvasTexture(img.bump));
      }
    }
    this.textures.set(def.id, t);
    return t;
  }
}
