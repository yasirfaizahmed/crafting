/**
 * glTF / GLB / OBJ / STL serialisation of the export scene (three.js exporters).
 *
 *  - glTF/GLB: metres, Y up (glTF native), PBR materials, element metadata in node `extras`.
 *  - OBJ: metres, Y up, one object per mesh with `g <level> <element>` groups and `usemtl <material id>`.
 *  - STL: binary, MILLIMETRES, Z UP (slicer convention: plan x/y, elevation z).
 */
import { Group, Mesh, type Object3D } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import type { Project } from '../../core/types';
import type { ExportOptions } from '../types';
import { buildExportScene, disposeExportScene } from './scene';

async function toGLTF(root: Object3D, binary: boolean): Promise<ArrayBuffer | Record<string, unknown>> {
  const exporter = new GLTFExporter();
  return (await exporter.parseAsync(root, { binary, onlyVisible: true, trs: false })) as ArrayBuffer | Record<string, unknown>;
}

export async function projectToGLB(project: Project, options: ExportOptions = {}): Promise<ArrayBuffer> {
  const scene = buildExportScene(project, { ...options, lights: true });
  try {
    return (await toGLTF(scene, true)) as ArrayBuffer;
  } finally {
    disposeExportScene(scene);
  }
}

export async function projectToGLTF(project: Project, options: ExportOptions = {}): Promise<Record<string, unknown>> {
  const scene = buildExportScene(project, { ...options, lights: true });
  try {
    return (await toGLTF(scene, false)) as Record<string, unknown>;
  } finally {
    disposeExportScene(scene);
  }
}

/** OBJ-safe identifier (no whitespace; ASCII). */
function objName(s: string): string {
  const ascii = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[—–]/g, '-')
    .replace(/[^\x21-\x7e]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return ascii || 'unnamed';
}

export function projectToOBJ(project: Project, options: ExportOptions = {}): string {
  const scene = buildExportScene(project, { ...options, materialNames: 'id' });
  try {
    // Give every mesh a unique OBJ object name and remember its groups (level + element).
    const groups = new Map<string, string>();
    const used = new Set<string>();
    for (const level of scene.children) {
      const levelName = objName(level.name);
      level.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const elementNode = o.parent === level ? o : o.parent!;
        let name = objName(o.name);
        for (let n = 2; used.has(name); n++) name = `${objName(o.name)}_${n}`;
        used.add(name);
        o.name = name;
        groups.set(name, `g ${levelName} ${objName(elementNode.name)}`);
      });
    }
    const body = new OBJExporter().parse(scene);
    const lines = body.split('\n').map((line) => (line.startsWith('o ') ? `${groups.get(line.slice(2)) ?? 'g default'}\n${line}` : line));
    const header = [
      '# Crafting OBJ export',
      `# Project: ${objName(project.info.name || 'Untitled')}`,
      '# Units: metres, Y up',
      `# Exported: ${new Date().toISOString()}`,
      '',
    ];
    return header.join('\n') + lines.join('\n');
  } finally {
    disposeExportScene(scene);
  }
}

/** Binary STL in millimetres with Z up. */
export function projectToSTL(project: Project, options: ExportOptions = {}): ArrayBuffer {
  const scene = buildExportScene(project, options);
  try {
    // World (m, Y up) → plan (mm, Z up): rotate +90° about X (y → z, z → −y), scale ×1000.
    const wrapper = new Group();
    wrapper.rotation.x = Math.PI / 2;
    wrapper.scale.setScalar(1000);
    wrapper.add(scene);
    wrapper.updateMatrixWorld(true);
    const view = new STLExporter().parse(wrapper, { binary: true }) as DataView;
    const header = `Crafting STL ${project.info.name || 'project'} | units: mm | Z up`;
    for (let i = 0; i < 80; i++) view.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 0x20);
    return view.buffer as ArrayBuffer;
  } finally {
    disposeExportScene(scene);
  }
}
