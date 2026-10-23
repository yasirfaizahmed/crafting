/**
 * Open / save .craft files with the File System Access API (keeps the file handle so Save writes
 * back to the same file) and <input type=file> / download fallbacks elsewhere.
 */
import { FILE_EXTENSION, FILE_MIME, parseProject, serializeProject } from '../core/serialization';
import type { Project } from '../core/types';

interface WritableLike {
  write(data: string | Blob): Promise<void>;
  close(): Promise<void>;
}

/** Subset of FileSystemFileHandle used here (not in every TS DOM lib). */
export interface FileHandleLike {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
  queryPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

export interface FilePickers {
  showOpenFilePicker?(opts: { types: PickerType[]; multiple?: boolean; excludeAcceptAllOption?: boolean; id?: string }): Promise<FileHandleLike[]>;
  showSaveFilePicker?(opts: { types: PickerType[]; suggestedName?: string; id?: string }): Promise<FileHandleLike>;
}

const TYPES: PickerType[] = [{ description: 'Crafting project', accept: { [FILE_MIME]: [FILE_EXTENSION], 'application/json': ['.json'] } }];

export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

export function suggestedFileName(project: Project): string {
  const base = (project.info.name || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project';
  return `${base}${FILE_EXTENSION}`;
}

/** The file the open project came from / was saved to (per project id). */
export class FileSession {
  private handle: FileHandleLike | null = null;
  private projectId: string | null = null;
  private name: string | null = null;

  constructor(
    private readonly pickers: () => FilePickers,
    private readonly fallbackPick: (accept: string) => Promise<{ name: string; text: string } | null>,
    private readonly download: (blob: Blob, filename: string) => void,
  ) {}

  /** File name associated with `projectId` (or the current file). */
  fileName(projectId?: string): string | null {
    return projectId === undefined || projectId === this.projectId ? this.name : null;
  }

  forget(): void {
    this.handle = null;
    this.projectId = null;
    this.name = null;
  }

  async open(): Promise<{ project: Project; fileName: string } | null> {
    const p = this.pickers();
    if (typeof p.showOpenFilePicker === 'function') {
      let handles: FileHandleLike[];
      try {
        handles = await p.showOpenFilePicker({ types: TYPES, multiple: false, excludeAcceptAllOption: false, id: 'crafting-project' });
      } catch (err) {
        if (isAbortError(err)) return null;
        throw err;
      }
      const handle = handles[0];
      if (!handle) return null;
      const file = await handle.getFile();
      const project = parseProject(await file.text());
      this.handle = handle;
      this.projectId = project.id;
      this.name = file.name;
      return { project, fileName: file.name };
    }
    const picked = await this.fallbackPick(`${FILE_EXTENSION},.json,application/json,${FILE_MIME}`);
    if (!picked) return null;
    const project = parseProject(picked.text);
    this.handle = null;
    this.projectId = project.id;
    this.name = picked.name;
    return { project, fileName: picked.name };
  }

  /** Write the project; true when saved, false when the user cancelled. */
  async save(project: Project, saveAs = false): Promise<boolean> {
    const text = serializeProject(project);
    const p = this.pickers();
    const sameProject = this.projectId === project.id;
    const suggested = (sameProject && this.name) || suggestedFileName(project);
    if (typeof p.showSaveFilePicker === 'function') {
      let handle = !saveAs && sameProject ? this.handle : null;
      if (!handle) {
        try {
          handle = await p.showSaveFilePicker({ types: TYPES, suggestedName: suggested, id: 'crafting-project' });
        } catch (err) {
          if (isAbortError(err)) return false;
          throw err;
        }
      }
      if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if (!handle.requestPermission || (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
      }
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      this.handle = handle;
      this.projectId = project.id;
      this.name = handle.name;
      return true;
    }
    this.download(new Blob([text], { type: FILE_MIME }), suggested);
    this.handle = null;
    this.projectId = project.id;
    this.name = suggested;
    return true;
  }
}
