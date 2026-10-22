/** WebGLRenderer creation (with graceful failure) and image capture at arbitrary sizes. */
import * as THREE from 'three';

/** False in Node / jsdom / browsers without WebGL. */
export function webglAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') return false;
  if (/jsdom/i.test(navigator.userAgent)) return false;
  const w = window as unknown as { WebGL2RenderingContext?: unknown; WebGLRenderingContext?: unknown };
  return !!(w.WebGL2RenderingContext || w.WebGLRenderingContext);
}

export function createRenderer(): THREE.WebGLRenderer | null {
  if (!webglAvailable()) return null;
  try {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // The sun's shadow map is re-rendered only when the model or sun changes.
    r.shadowMap.autoUpdate = false;
    return r;
  } catch (err) {
    console.warn('view3d: WebGL renderer unavailable', err);
    return null;
  }
}

/**
 * Render one frame at `width` × `height` (device pixels) by temporarily resizing the drawing
 * buffer, encode it, then restore the previous size.
 */
export async function captureFrame(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  render: () => void,
  opts: { width?: number; height?: number; mime?: string },
): Promise<Blob> {
  const canvas = renderer.domElement;
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevRatio = renderer.getPixelRatio();
  const prevAspect = camera.aspect;
  const maxSize = Math.min(8192, renderer.capabilities.maxTextureSize || 4096);
  const w = Math.round(Math.min(maxSize, Math.max(16, opts.width ?? canvas.width)));
  const h = Math.round(Math.min(maxSize, Math.max(16, opts.height ?? canvas.height)));
  const mime = opts.mime === 'image/jpeg' || opts.mime === 'image/webp' ? opts.mime : 'image/png';
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image capture failed'))), mime, 0.92),
    );
  } finally {
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    render();
  }
}
