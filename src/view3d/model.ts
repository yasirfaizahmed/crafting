/**
 * Keeps one THREE.Group per element (userData.elementId) in sync with the document store.
 * Rebuilds only `affectedIds(project, change)`; handles visibility (hidden elements, cut-away of
 * upper levels), x-ray walls/roofs and selection / hover highlighting.
 */
import * as THREE from 'three';
import { affectedIds } from '../core/dependencies';
import type { ChangeSet } from '../core/store';
import type { Door, Element, Project } from '../core/types';
import { buildElementGeometry, createGeometryContext, type GeometryContext, type LightDef } from '../geometry';
import { HOVER_COLOR, SELECT_COLOR, type MaterialLibrary } from './materials';
import { toBufferGeometry, wantsRaise } from './meshes';

export interface ElementEntry {
  el: Element;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  lights: LightDef[];
  levelElevation: number;
  bounds: THREE.Box3;
  edges: THREE.LineSegments[] | null;
  edgeKind: 'hover' | 'selected' | null;
  /** Visible by view rules (stays pickable while a preview temporarily hides the group). */
  shown: boolean;
}

export interface ViewFilter {
  activeLevelId: string;
  activeElevation: number;
  cutAboveActive: boolean;
  xray: boolean;
}

/** How the hovered element is highlighted: emissive tint + outline, outline only, or not at all. */
export type HoverStyle = 'full' | 'outline' | 'none';

export interface SceneLight {
  def: LightDef;
  elementId: string;
  levelId: string;
}

const XRAY_TYPES = new Set<Element['type']>(['wall', 'roof']);

export class ModelSync {
  readonly root = new THREE.Group();
  private readonly entries = new Map<string, ElementEntry>();
  private pickCache: THREE.Mesh[] | null = null;
  private colliderCache: THREE.Mesh[] | null = null;
  private hover: string | null = null;
  private hoverStyle: HoverStyle = 'full';
  private selected = new Set<string>();
  private previewHidden = new Set<string>();
  private filter: ViewFilter;
  private readonly edgeMat: THREE.LineBasicMaterial;
  private readonly hoverEdgeMat: THREE.LineBasicMaterial;
  /** Incremented whenever meshes or their visibility change. */
  version = 0;
  /** Number of element groups built since construction (diagnostics/tests). */
  buildCount = 0;

  constructor(
    private readonly materials: MaterialLibrary,
    filter: ViewFilter,
  ) {
    this.filter = { ...filter };
    this.root.name = 'model';
    this.root.matrixAutoUpdate = false;
    this.edgeMat = new THREE.LineBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.95 });
    this.hoverEdgeMat = new THREE.LineBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0.7 });
  }

  get size(): number {
    return this.entries.size;
  }

  entry(id: string): ElementEntry | undefined {
    return this.entries.get(id);
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  rebuildAll(project: Project): void {
    for (const id of [...this.entries.keys()]) this.removeEntry(id);
    const gctx = createGeometryContext(project);
    for (const el of Object.values(project.elements)) this.build(gctx, project, el);
    this.invalidate();
  }

  /** Apply a store change incrementally. Returns the rebuilt ids (null = full rebuild). */
  apply(project: Project, change: ChangeSet): Set<string> | null {
    const ids = affectedIds(project, change);
    if (!ids) {
      this.rebuildAll(project);
      return null;
    }
    const gctx = createGeometryContext(project);
    for (const id of ids) {
      this.removeEntry(id);
      const el = project.elements[id];
      if (el) this.build(gctx, project, el);
    }
    this.invalidate();
    return ids;
  }

  setFilter(f: ViewFilter): void {
    const prev = this.filter;
    if (
      prev.activeLevelId === f.activeLevelId &&
      prev.activeElevation === f.activeElevation &&
      prev.cutAboveActive === f.cutAboveActive &&
      prev.xray === f.xray
    )
      return;
    this.filter = { ...f };
    for (const e of this.entries.values()) this.applyState(e);
    this.invalidate();
  }

  setHighlight(hover: string | null, selected: readonly string[], style: HoverStyle = 'full'): void {
    const nextSel = new Set(selected);
    const changed = new Set<string>();
    if (hover !== this.hover || style !== this.hoverStyle) {
      if (this.hover) changed.add(this.hover);
      if (hover) changed.add(hover);
    }
    this.hoverStyle = style;
    for (const id of this.selected) if (!nextSel.has(id)) changed.add(id);
    for (const id of nextSel) if (!this.selected.has(id)) changed.add(id);
    this.hover = hover;
    this.selected = nextSel;
    for (const id of changed) {
      const e = this.entries.get(id);
      if (e) this.applyState(e);
    }
  }

  /** Currently highlighted (hovered) element id. */
  get hovered(): string | null {
    return this.hover;
  }

  /** Temporarily hide originals while a preview replaces them. */
  setPreviewHidden(ids: readonly string[]): void {
    const next = new Set(ids);
    if (next.size === this.previewHidden.size && [...next].every((id) => this.previewHidden.has(id))) return;
    const changed = new Set([...next, ...this.previewHidden]);
    this.previewHidden = next;
    for (const id of changed) {
      const e = this.entries.get(id);
      if (e) this.applyState(e);
    }
    this.invalidate();
  }

  /** Visible meshes for picking. */
  pickables(): THREE.Mesh[] {
    if (!this.pickCache) {
      this.pickCache = [];
      for (const e of this.entries.values()) if (e.shown) this.pickCache.push(...e.meshes);
    }
    return this.pickCache;
  }

  /**
   * Visible meshes the walking player collides with. Windows block; swing doors block while
   * closed (open them with a right click); sliding, pocket, garage doors and openings are passable.
   */
  colliders(): THREE.Mesh[] {
    if (!this.colliderCache) {
      this.colliderCache = [];
      for (const e of this.entries.values()) {
        if (!e.shown || (e.el.type === 'door' && !doorBlocks(e.el))) continue;
        this.colliderCache.push(...e.meshes);
      }
    }
    return this.colliderCache;
  }

  /** Show one element as a different version of itself (e.g. a door mid-swing) without touching the store. */
  showVariant(project: Project, el: Element): void {
    this.removeEntry(el.id);
    this.build(createGeometryContext(project), project, el);
    this.invalidate();
  }

  /** Light sources of visible elements. */
  lights(): SceneLight[] {
    const out: SceneLight[] = [];
    for (const e of this.entries.values()) {
      if (!e.lights.length || !e.shown) continue;
      for (const def of e.lights) out.push({ def, elementId: e.el.id, levelId: e.el.levelId });
    }
    return out;
  }

  /** World bounds of the given elements (all visible elements when omitted). */
  bounds(ids?: readonly string[]): THREE.Box3 {
    const box = new THREE.Box3();
    if (ids && ids.length) {
      for (const id of ids) {
        const e = this.entries.get(id);
        if (e && !e.bounds.isEmpty()) box.union(e.bounds);
      }
      return box;
    }
    for (const e of this.entries.values()) if (e.shown && !e.bounds.isEmpty()) box.union(e.bounds);
    return box;
  }

  isVisible(id: string): boolean {
    return !!this.entries.get(id)?.shown;
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.removeEntry(id);
    this.edgeMat.dispose();
    this.hoverEdgeMat.dispose();
  }

  // ---------------------------------------------------------------------------

  private invalidate(): void {
    this.pickCache = null;
    this.colliderCache = null;
    this.version++;
  }

  private build(gctx: GeometryContext, project: Project, el: Element): void {
    let geo;
    try {
      geo = buildElementGeometry(gctx, el);
    } catch (err) {
      console.warn(`view3d: geometry failed for ${el.type} ${el.id}`, err);
      return;
    }
    if (!geo.parts.length && !geo.lights.length) return;
    const group = new THREE.Group();
    group.name = `${el.type}:${el.id}`;
    group.userData.elementId = el.id;
    group.matrixAutoUpdate = false;
    const meshes: THREE.Mesh[] = [];
    const bounds = new THREE.Box3();
    for (const part of geo.parts) {
      const g = toBufferGeometry(part.mesh);
      if (!g) continue;
      const raised = wantsRaise(el, part.role);
      const mesh = new THREE.Mesh(g, this.materials.get(part.materialId, { raised }));
      const transparent = this.materials.isTransparent(part.materialId);
      mesh.name = part.name ?? part.role;
      mesh.userData = { elementId: el.id, materialId: part.materialId, role: part.role, raised };
      mesh.castShadow = !transparent && part.role !== 'light';
      mesh.receiveShadow = !transparent;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      meshes.push(mesh);
      if (g.boundingBox) bounds.union(g.boundingBox);
    }
    const level = project.levels.find((l) => l.id === el.levelId);
    const entry: ElementEntry = {
      el,
      group,
      meshes,
      lights: geo.lights,
      levelElevation: level?.elevation ?? 0,
      bounds,
      edges: null,
      edgeKind: null,
      shown: false,
    };
    this.entries.set(el.id, entry);
    this.root.add(group);
    group.updateMatrixWorld(true);
    this.applyState(entry);
    this.buildCount++;
  }

  private removeEntry(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.removeEdges(e);
    for (const m of e.meshes) m.geometry.dispose();
    this.root.remove(e.group);
    this.entries.delete(id);
  }

  private visible(e: ElementEntry): boolean {
    const f = this.filter;
    if (e.el.hidden) return false;
    if (f.cutAboveActive) {
      if (e.levelElevation > f.activeElevation + 1) return false;
      // Dollhouse: the active storey loses its roof and ceiling too.
      if (e.el.levelId === f.activeLevelId && (e.el.type === 'roof' || (e.el.type === 'slab' && e.el.kind === 'ceiling'))) return false;
    }
    return true;
  }

  private applyState(e: ElementEntry): void {
    const id = e.el.id;
    const shown = this.visible(e);
    if (e.shown !== shown) {
      e.shown = shown;
      this.pickCache = null;
      this.colliderCache = null;
    }
    e.group.visible = shown && !this.previewHidden.has(id);
    const sel = this.selected.has(id);
    const hov = this.hover === id && this.hoverStyle !== 'none';
    const tint = hov && this.hoverStyle === 'full';
    const xray = this.filter.xray && XRAY_TYPES.has(e.el.type) && !sel && !tint;
    for (const m of e.meshes) {
      const ud = m.userData as { materialId: string; raised: boolean };
      m.material = this.materials.get(ud.materialId, { highlight: sel ? 'selected' : tint ? 'hover' : undefined, xray, raised: ud.raised });
    }
    const kind = sel ? 'selected' : hov ? 'hover' : null;
    if (kind !== e.edgeKind) {
      this.removeEdges(e);
      if (kind) this.addEdges(e, kind);
    }
  }

  private addEdges(e: ElementEntry, kind: 'hover' | 'selected'): void {
    e.edges = [];
    e.edgeKind = kind;
    for (const m of e.meshes) {
      const eg = new THREE.EdgesGeometry(m.geometry, 30);
      const lines = new THREE.LineSegments(eg, kind === 'selected' ? this.edgeMat : this.hoverEdgeMat);
      lines.matrixAutoUpdate = false;
      lines.raycast = () => {};
      lines.renderOrder = 2;
      e.group.add(lines);
      lines.updateMatrixWorld(true);
      e.edges.push(lines);
    }
  }

  private removeEdges(e: ElementEntry): void {
    if (!e.edges) return;
    for (const l of e.edges) {
      e.group.remove(l);
      l.geometry.dispose();
    }
    e.edges = null;
    e.edgeKind = null;
  }
}

/** Closed swing doors block the walker; open ones (≥ 30°) and non-swing doors do not. */
export function doorBlocks(d: Door): boolean {
  return (d.style === 'single' || d.style === 'double') && (d.openAngle ?? 0) < 30;
}
