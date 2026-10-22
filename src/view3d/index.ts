/**
 * 3D viewport + Minecraft-style builder.
 *
 *   mountViewport(container, ctx) → ViewportHandle
 *
 * NOTE: phase-0 baseline: orbit camera + model meshes rebuilt on every change. The view3d owner
 * replaces this with the full builder (fly mode, crosshair placement, ghost previews, tools,
 * textures, sky, shadows, incremental updates) keeping the exported signature.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { AppContext } from '../app/state';
import { getMaterial } from '../core/materials';
import { buildProjectGeometry } from '../geometry';
import type { ViewportHandle } from './types';

export type { ViewportHandle, CaptureOptions } from './types';

export function mountViewport(container: HTMLElement, ctx: AppContext): ViewportHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bcd8ee');
  scene.add(new THREE.HemisphereLight('#ffffff', '#667755', 1.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.5);
  sun.position.set(20, 30, 10);
  scene.add(sun);
  scene.add(new THREE.GridHelper(100, 100, '#888888', '#cccccc'));
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 2000);
  camera.position.set(15, 12, 15);
  const controls = new OrbitControls(camera, renderer.domElement);
  const model = new THREE.Group();
  scene.add(model);

  const rebuild = () => {
    model.clear();
    for (const g of buildProjectGeometry(ctx.store.project as never)) {
      for (const p of g.parts) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(p.mesh.positions, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(p.mesh.normals, 3));
        geom.setIndex(new THREE.BufferAttribute(p.mesh.indices, 1));
        const m = getMaterial(p.materialId);
        const mat = new THREE.MeshStandardMaterial({
          color: m.color,
          roughness: m.roughness,
          metalness: m.metalness,
          transparent: m.opacity < 1,
          opacity: m.opacity,
        });
        model.add(new THREE.Mesh(geom, mat));
      }
    }
  };
  rebuild();
  const unsub = ctx.store.subscribe(rebuild);

  let active = true;
  const resize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    if (!active) return;
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    resize,
    setActive(a) {
      active = a;
    },
    async captureImage(options = {}) {
      renderer.render(scene, camera);
      return new Promise<Blob>((resolve, reject) =>
        renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), options.mime ?? 'image/png'),
      );
    },
    frame() {
      controls.target.set(0, 0, 0);
    },
    dispose() {
      unsub();
      ro.disconnect();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
