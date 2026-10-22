/**
 * Outdoor environment: gradient sky dome with sun disc, sun (DirectionalLight with a shadow camera
 * fitted to the model), hemisphere fill, PMREM environment map from the sky, a large grass ground
 * with large-scale colour variation, distance fog and an anti-aliased shader grid at the active
 * level elevation (minor = grid size, major = 10 × grid size, red/green plan axes).
 */
import * as THREE from 'three';
import type { MaterialLibrary } from './materials';
import { drawVariation } from './textures';

export const SKY_TOP = '#3d7cc9';
export const SKY_HORIZON = '#cfe1f1';
export const SKY_GROUND = '#a9b29c';
export const GROUND_SIZE = 2400;
const SKY_RADIUS = 1400;

/**
 * Unit world vector pointing TOWARD the sun. Azimuth is a compass bearing (degrees clockwise from
 * north); plan north is +y rotated CCW by `northAngle`.
 */
export function sunDirection(azimuthDeg: number, altitudeDeg: number, northAngleDeg = 0): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const alt = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(altitudeDeg, -10, 90));
  const n = THREE.MathUtils.degToRad(northAngleDeg);
  const px0 = Math.sin(az);
  const py0 = Math.cos(az);
  const px = px0 * Math.cos(n) - py0 * Math.sin(n);
  const py = px0 * Math.sin(n) + py0 * Math.cos(n);
  return new THREE.Vector3(px * Math.cos(alt), Math.sin(alt), -py * Math.cos(alt)).normalize();
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform vec3 sunDir;
uniform vec3 sunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h >= 0.0 ? mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.5)) : mix(horizonColor, groundColor, pow(clamp(-h * 4.0, 0.0, 1.0), 0.7));
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(s, 900.0) * 18.0 + pow(s, 40.0) * 0.18 + pow(s, 6.0) * 0.08);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ENV_FRAG = /* glsl */ `
uniform vec3 sunDir;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zenith = vec3(0.55, 0.68, 0.9);
  vec3 horizon = vec3(1.0);
  vec3 ground = vec3(0.36, 0.37, 0.32);
  vec3 col = h >= 0.0 ? mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(horizon * 0.75, ground, pow(clamp(-h * 3.0, 0.0, 1.0), 0.5));
  float s = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.95, 0.85) * pow(s, 24.0) * 3.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const GRID_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GRID_FRAG = /* glsl */ `
uniform float uMinor;
uniform float uMajor;
uniform float uFade;
uniform float uOpacity;
uniform vec3 uColor;
uniform vec3 uCenter;
varying vec3 vWorld;
float gridLine(vec2 p, float size) {
  vec2 c = p / size;
  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  vec2 p = vWorld.xz;
  vec2 dm = fwidth(p / uMinor);
  float minorFade = 1.0 - smoothstep(0.12, 0.45, max(dm.x, dm.y));
  float a = max(gridLine(p, uMinor) * 0.11 * minorFade, gridLine(p, uMajor) * 0.32);
  vec3 col = uColor;
  vec2 ax = abs(p) / max(fwidth(p), vec2(1e-5));
  float axisX = 1.0 - min(ax.y, 1.0);
  float axisY = 1.0 - min(ax.x, 1.0);
  if (axisX > 0.0) { col = mix(col, vec3(0.86, 0.24, 0.2), axisX); a = max(a, axisX * 0.85); }
  if (axisY > 0.0) { col = mix(col, vec3(0.22, 0.66, 0.3), axisY); a = max(a, axisY * 0.85); }
  float fade = 1.0 - smoothstep(uFade * 0.5, uFade, distance(p, uCenter.xz));
  a *= fade * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  readonly grid: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private variation: THREE.Texture | null = null;
  private gridSizeM = 0.5;
  /** Set when the shadow map must be re-rendered. */
  shadowsDirty = true;

  constructor(
    private readonly scene: THREE.Scene,
    materials: MaterialLibrary,
  ) {
    this.group.name = 'environment';
    scene.add(this.group);

    // Sky.
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(SKY_TOP) },
        horizonColor: { value: new THREE.Color(SKY_HORIZON) },
        groundColor: { value: new THREE.Color(SKY_GROUND) },
        sunDir: { value: this.sunDir },
        sunColor: { value: new THREE.Color('#fff4e0') },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), skyMat);
    this.sky.name = 'sky';
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.sky.raycast = () => {};
    this.group.add(this.sky);

    scene.fog = new THREE.Fog(SKY_HORIZON, 160, 1100);

    // Lights.
    this.hemi = new THREE.HemisphereLight('#e2eeff', '#6f7458', 0.85);
    this.group.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3e2', 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.group.add(this.sun, this.sun.target);

    // Ground.
    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
    groundGeo.rotateX(-Math.PI / 2);
    const uv = groundGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * GROUND_SIZE, uv.getY(i) * GROUND_SIZE);
    const grass = materials.get('grass');
    const groundMat = new THREE.MeshStandardMaterial({
      color: grass.map ? '#a9b596' : grass.color,
      map: grass.map,
      roughness: 0.96,
      metalness: 0,
    });
    const variation = drawVariation(7);
    if (variation) {
      this.variation = new THREE.CanvasTexture(variation);
      this.variation.wrapS = THREE.RepeatWrapping;
      this.variation.wrapT = THREE.RepeatWrapping;
      const tex = this.variation;
      groundMat.onBeforeCompile = (shader) => {
        shader.uniforms.variationMap = { value: tex };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vGroundUv;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGroundUv = (modelMatrix * vec4(position, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D variationMap;\nvarying vec2 vGroundUv;')
          .replace(
            '#include <map_fragment>',
            '#include <map_fragment>\n' +
              'vec3 gv = vec3(texture2D(variationMap, vGroundUv / 23.0).r, texture2D(variationMap, vGroundUv / 97.0 + 0.37).r, texture2D(variationMap, vGroundUv / 5.3 + 0.61).r);\n' +
              'diffuseColor.rgb *= mix(0.78, 1.12, gv.x) * mix(0.84, 1.08, gv.y) * mix(0.92, 1.05, gv.z);\n' +
              'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.02, 0.78), (1.0 - gv.y) * 0.35);',
          );
      };
      groundMat.customProgramCacheKey = () => 'crafting-ground';
    }
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.name = 'ground';
    this.ground.position.y = -0.012;
    this.ground.receiveShadow = true;
    this.ground.raycast = () => {};
    this.group.add(this.ground);

    // Grid.
    const gridMat = new THREE.ShaderMaterial({
      uniforms: {
        uMinor: { value: 0.5 },
        uMajor: { value: 5 },
        uFade: { value: 60 },
        uOpacity: { value: 1 },
        uColor: { value: new THREE.Color('#1f2a30') },
        uCenter: { value: new THREE.Vector3() },
      },
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), gridMat);
    this.grid.name = 'grid';
    this.grid.renderOrder = 5;
    this.grid.frustumCulled = false;
    this.grid.raycast = () => {};
    this.group.add(this.grid);
  }

  setSun(azimuth: number, altitude: number, northAngle = 0): void {
    this.sunDir.copy(sunDirection(azimuth, altitude, northAngle));
    const alt = THREE.MathUtils.clamp(altitude, 0, 90);
    const warm = new THREE.Color('#ffc58f').lerp(new THREE.Color('#fff4e6'), THREE.MathUtils.smoothstep(alt, 2, 35));
    this.sun.color.copy(warm);
    this.sun.intensity = 0.35 + 1.9 * THREE.MathUtils.smoothstep(alt, -2, 25);
    this.hemi.intensity = 0.45 + 0.45 * THREE.MathUtils.smoothstep(alt, -5, 30);
    (this.sky.material.uniforms.sunColor.value as THREE.Color).copy(warm);
    this.shadowsDirty = true;
  }

  setShadows(enabled: boolean): void {
    if (this.sun.castShadow === enabled) return;
    this.sun.castShadow = enabled;
    this.shadowsDirty = true;
  }

  /** Fit the sun's orthographic shadow camera to the model bounds. */
  fitShadow(box: THREE.Box3): void {
    const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 15) : box.getBoundingSphere(new THREE.Sphere());
    const r = THREE.MathUtils.clamp(sphere.radius * 1.08, 6, 160);
    const c = sphere.center;
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, r + 30);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 2 * r + 60;
    cam.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.shadowsDirty = true;
  }

  /** Grid at `elevationMm` with `gridSizeMm` minor spacing. */
  setGrid(visible: boolean, gridSizeMm: number, elevationMm: number): void {
    this.grid.visible = visible;
    const minor = Math.max(0.01, gridSizeMm / 1000);
    this.gridSizeM = minor;
    const u = this.grid.material.uniforms;
    u.uMinor.value = minor;
    u.uMajor.value = minor * 10;
    this.grid.position.y = elevationMm / 1000 + 0.004;
  }

  /** Keep the sky around the camera and the grid around the point of interest. */
  follow(camera: THREE.Camera, focus: THREE.Vector3): void {
    this.sky.position.copy(camera.position);
    const dist = camera.position.distanceTo(focus);
    const fade = THREE.MathUtils.clamp(dist * 2.2, 25, 400);
    const size = fade * 2.2;
    const major = this.gridSizeM * 10;
    this.grid.position.x = Math.round(focus.x / major) * major;
    this.grid.position.z = Math.round(focus.z / major) * major;
    this.grid.scale.set(size, 1, size);
    const u = this.grid.material.uniforms;
    u.uFade.value = fade;
    (u.uCenter.value as THREE.Vector3).copy(focus);
  }

  /** Image-based lighting from the sky (reflections on glass/metal, soft fill). */
  updateEnvironmentMap(renderer: THREE.WebGLRenderer): void {
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(renderer);
      // A soft, slightly neutralised version of the sky so metals and glass read well.
      const envScene = new THREE.Scene();
      const mat = new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: this.sunDir.clone() } },
        vertexShader: SKY_VERT,
        fragmentShader: ENV_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      });
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat);
      envScene.add(sphere);
      const prev = this.envTarget;
      this.envTarget = this.pmrem.fromScene(envScene, 0.03, 0.1, 100);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = 0.5;
      prev?.dispose();
      sphere.geometry.dispose();
      mat.dispose();
    } catch (err) {
      console.warn('view3d: environment map failed', err);
    }
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.variation?.dispose();
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.sun.shadow.map?.dispose();
    this.scene.remove(this.group);
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
