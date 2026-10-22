/**
 * 3D viewport + Minecraft-style builder.
 *
 *   mountViewport(container, ctx) → ViewportHandle
 *
 * Orbit and fly/walk cameras, crosshair/mouse picking, ghost previews and builder tools
 * (tools/*), procedural PBR materials, sky + sun shadows, incremental model updates, HUD.
 * Falls back to a message (no-op handle) where WebGL is unavailable (Node, jsdom).
 */
import type { AppContext } from '../app/state';
import { createRenderer } from './renderer';
import type { ViewportHandle } from './types';
import { Viewport } from './viewport';
import './view3d.css';

export type { ViewportHandle, CaptureOptions } from './types';

export function mountViewport(container: HTMLElement, ctx: AppContext): ViewportHandle {
  const renderer = createRenderer();
  if (!renderer) return mountFallback(container);
  try {
    return new Viewport(container, ctx, renderer).handle();
  } catch (err) {
    console.warn('view3d: failed to start the 3D view', err);
    renderer.dispose();
    renderer.domElement.remove();
    return mountFallback(container);
  }
}

/** Placeholder shown when WebGL is not available. */
function mountFallback(container: HTMLElement): ViewportHandle {
  const box = document.createElement('div');
  box.className = 'v3d-fallback';
  box.textContent = '3D view unavailable — this browser does not support WebGL.';
  container.appendChild(box);
  return {
    resize() {},
    setActive() {},
    captureImage: () => Promise.reject(new Error('3D view unavailable (WebGL not supported)')),
    frame() {},
    dispose() {
      box.remove();
    },
  };
}
