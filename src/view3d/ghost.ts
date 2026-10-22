/**
 * Scene-side implementation of GhostSink: translucent previews of elements a tool is about to
 * create (red when invalid), solid drag previews, a snap marker, a rubber-band line and a floating
 * label (positioned by the HUD).
 */
import * as THREE from 'three';
import { planToWorld } from '../core/coords';
import type { Element, Project } from '../core/types';
import { buildElementGeometry, createGeometryContext } from '../geometry';
import type { MaterialLibrary } from './materials';
import { toBufferGeometry } from './meshes';
import type { ModelSync } from './model';
import type { GhostOptions, GhostSink, PlanPoint } from './tools/types';

function stripIds(els: Element[]): unknown[] {
  return els.map((e) => {
    const { id: _id, ...rest } = e;
    return rest;
  });
}

export class GhostRenderer implements GhostSink {
  readonly group = new THREE.Group();
  private readonly meshes = new THREE.Group();
  private readonly markerObj: THREE.Group;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly lineMat: THREE.LineDashedMaterial;
  private readonly edgeMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false });
  private readonly invalidEdgeMat = new THREE.LineBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: 0.95, depthTest: false });
  private lineObj: THREE.Line | null = null;
  private key = '';
  /** Floating label for the HUD (world position in metres). */
  labelText: string | null = null;
  readonly labelPos = new THREE.Vector3();
  /** Number of ghost elements currently shown. */
  count = 0;
  onChange?: () => void;

  constructor(
    private readonly materials: MaterialLibrary,
    private readonly getProject: () => Project,
    private readonly model: ModelSync,
  ) {
    this.group.name = 'ghost';
    this.meshes.name = 'ghost-elements';
    this.group.add(this.meshes);
    this.markerMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.1, 32).rotateX(-Math.PI / 2), this.markerMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.025, 16).rotateX(-Math.PI / 2), this.markerMat);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 6).translate(0, 0.3, 0), this.markerMat);
    this.markerObj = new THREE.Group();
    this.markerObj.add(ring, dot, stem);
    this.markerObj.visible = false;
    this.markerObj.renderOrder = 1000;
    for (const c of this.markerObj.children) c.renderOrder = 1000;
    this.group.add(this.markerObj);
    this.lineMat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.15, gapSize: 0.08, depthTest: false, transparent: true });
  }

  show(elements: Element[], valid: boolean, options: GhostOptions = {}): void {
    const key = JSON.stringify([stripIds(elements), valid, !!options.solid, options.hide ?? [], options.solidIds ?? [], (options.extraLevels ?? []).map((l) => [l.id, l.elevation])]);
    if (key === this.key) return;
    this.key = key;
    this.clearMeshes();
    this.model.setPreviewHidden(options.hide ?? []);
    this.count = elements.length;
    if (elements.length) {
      const project = this.getProject();
      const extra = (options.extraLevels ?? []).filter((l) => !project.levels.some((x) => x.id === l.id));
      const temp: Project = {
        ...project,
        levels: extra.length ? [...project.levels, ...extra] : project.levels,
        elements: { ...project.elements },
      };
      for (const el of elements) temp.elements[el.id] = el;
      const gctx = createGeometryContext(temp);
      const solidIds = new Set(options.solidIds ?? []);
      for (const el of elements) {
        let geo;
        try {
          geo = buildElementGeometry(gctx, el);
        } catch {
          continue;
        }
        const solid = options.solid || solidIds.has(el.id);
        for (const part of geo.parts) {
          const g = toBufferGeometry(part.mesh);
          if (!g) continue;
          const mat = solid ? this.materials.get(part.materialId) : valid ? this.materials.get(part.materialId, { ghost: true }) : this.materials.invalid;
          const mesh = new THREE.Mesh(g, mat);
          mesh.castShadow = solid;
          mesh.receiveShadow = solid;
          mesh.renderOrder = solid ? 0 : 10;
          mesh.matrixAutoUpdate = false;
          mesh.raycast = () => {};
          this.meshes.add(mesh);
          if (!solid && (el.type === 'door' || el.type === 'window')) {
            // Openings sit inside their wall: outline them on top so they read through it.
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), valid ? this.edgeMat : this.invalidEdgeMat);
            edges.renderOrder = 1002;
            edges.raycast = () => {};
            this.meshes.add(edges);
          }
        }
      }
    }
    this.onChange?.();
  }

  line(points: PlanPoint[] | null, valid = true): void {
    if (this.lineObj) {
      this.group.remove(this.lineObj);
      this.lineObj.geometry.dispose();
      this.lineObj = null;
    }
    if (points && points.length >= 2) {
      const pts = points.map((p) => new THREE.Vector3(...planToWorld(p.point, p.elevation)));
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this.lineMat.color.set(valid ? '#ffffff' : '#ff5a5a');
      this.lineObj = new THREE.Line(g, this.lineMat);
      this.lineObj.computeLineDistances();
      this.lineObj.renderOrder = 1001;
      this.group.add(this.lineObj);
    }
    this.onChange?.();
  }

  marker(at: PlanPoint | null, valid = true): void {
    if (!at) {
      if (this.markerObj.visible) {
        this.markerObj.visible = false;
        this.onChange?.();
      }
      return;
    }
    this.markerObj.visible = true;
    this.markerObj.position.set(...planToWorld(at.point, at.elevation + 5));
    this.markerMat.color.set(valid ? '#ffffff' : '#ff5a5a');
    this.onChange?.();
  }

  label(text: string | null, at?: PlanPoint): void {
    this.labelText = text;
    if (text && at) this.labelPos.set(...planToWorld(at.point, at.elevation));
    this.onChange?.();
  }

  clear(): void {
    this.show([], true);
    this.line(null);
    this.marker(null);
    this.label(null);
  }

  /** Hide/show every helper (used while capturing images). */
  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    this.clearMeshes();
    this.line(null);
    for (const c of this.markerObj.children) (c as THREE.Mesh).geometry.dispose();
    this.markerMat.dispose();
    this.lineMat.dispose();
    this.edgeMat.dispose();
    this.invalidEdgeMat.dispose();
  }

  private clearMeshes(): void {
    for (const c of [...this.meshes.children]) {
      (c as THREE.Mesh | THREE.LineSegments).geometry.dispose();
      this.meshes.remove(c);
    }
    this.count = 0;
  }
}
