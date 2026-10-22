/**
 * Minimal ISO 10303-21 (STEP physical file) writer used by the IFC exporter.
 *
 * Arguments are encoded from plain JS values:
 *   number → REAL (always with a decimal point), `int(n)` → INTEGER, boolean → .T./.F.,
 *   string → '…' (ISO 10303-21 escaping, non-ASCII as \X2\…\X0\), null/undefined → $,
 *   `DERIVED` → *, `enm('X')` → .X., `typed('IFCLABEL', v)` → IFCLABEL(v), arrays → (…), Ref → #id.
 */

export class Ref {
  constructor(readonly id: number) {}
}

class Int {
  constructor(readonly value: number) {}
}

class Enum {
  constructor(readonly value: string) {}
}

class Typed {
  constructor(
    readonly type: string,
    readonly value: StepArg,
  ) {}
}

class Derived {}

export type StepArg = string | number | boolean | null | undefined | Ref | Int | Enum | Typed | Derived | readonly StepArg[];

/** Attribute re-declared as DERIVED in a subtype: written as `*`. */
export const DERIVED = new Derived();
export const int = (n: number): Int => new Int(Math.round(n));
export const enm = (v: string): Enum => new Enum(v.toUpperCase());
export const typed = (type: string, value: StepArg): Typed => new Typed(type.toUpperCase(), value);

/** STEP REAL: shortest stable decimal (12 significant digits) that always contains a '.'. */
export function formatReal(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Cannot write non-finite number ${n} to IFC`);
  if (Math.abs(n) < 1e-12) return '0.';
  const s = String(Number(n.toPrecision(12)));
  const e = s.indexOf('e');
  if (e >= 0) {
    const mant = s.slice(0, e);
    const exp = s.slice(e + 1).replace('+', '');
    return `${mant.includes('.') ? mant : `${mant}.`}E${exp}`;
  }
  return s.includes('.') ? s : `${s}.`;
}

/** Encode a string literal per ISO 10303-21:2002 (\X2\ for UCS-2, \X4\ for astral code points). */
export function formatString(s: string): string {
  let out = "'";
  let wide = '';
  let mode: 'none' | 'x2' | 'x4' = 'none';
  const close = () => {
    if (mode !== 'none') {
      out += wide + '\\X0\\';
      wide = '';
      mode = 'none';
    }
  };
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) {
      close();
      if (ch === "'") out += "''";
      else if (ch === '\\') out += '\\\\';
      else out += ch;
    } else if (cp < 0x20) {
      // Control characters (tabs, newlines) are not allowed in STEP strings; replace with spaces.
      close();
      out += ' ';
    } else if (cp <= 0xffff) {
      if (mode !== 'x2') {
        close();
        out += '\\X2\\';
        mode = 'x2';
      }
      wide += cp.toString(16).toUpperCase().padStart(4, '0');
    } else {
      if (mode !== 'x4') {
        close();
        out += '\\X4\\';
        mode = 'x4';
      }
      wide += cp.toString(16).toUpperCase().padStart(8, '0');
    }
  }
  close();
  return out + "'";
}

export function encodeArg(v: StepArg): string {
  if (v === null || v === undefined) return '$';
  if (typeof v === 'number') return formatReal(v);
  if (typeof v === 'string') return formatString(v);
  if (typeof v === 'boolean') return v ? '.T.' : '.F.';
  if (v instanceof Ref) return `#${v.id}`;
  if (v instanceof Int) return String(v.value);
  if (v instanceof Enum) return `.${v.value}.`;
  if (v instanceof Typed) return `${v.type}(${encodeArg(v.value)})`;
  if (v instanceof Derived) return '*';
  return `(${(v as readonly StepArg[]).map(encodeArg).join(',')})`;
}

export interface StepHeader {
  description: string[];
  implementationLevel: string;
  name: string;
  timeStamp: string;
  author: string[];
  organization: string[];
  preprocessorVersion: string;
  originatingSystem: string;
  authorization: string;
  schemas: string[];
}

/** Accumulates entity instances (#id=TYPE(args);) and renders the complete exchange file. */
export class StepWriter {
  private lines: string[] = [];
  private nextId = 1;
  private readonly counts = new Map<string, number>();

  add(type: string, args: readonly StepArg[]): Ref {
    const id = this.nextId++;
    const t = type.toUpperCase();
    this.lines.push(`#${id}=${t}(${args.map(encodeArg).join(',')});`);
    this.counts.set(t, (this.counts.get(t) ?? 0) + 1);
    return new Ref(id);
  }

  /** Number of written instances of an (upper-case) entity type. */
  count(type: string): number {
    return this.counts.get(type.toUpperCase()) ?? 0;
  }

  get size(): number {
    return this.lines.length;
  }

  render(h: StepHeader): string {
    const s = formatString;
    const list = (xs: string[]) => `(${(xs.length ? xs : ['']).map(s).join(',')})`;
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(${list(h.description)},${s(h.implementationLevel)});`,
      `FILE_NAME(${s(h.name)},${s(h.timeStamp)},${list(h.author)},${list(h.organization)},${s(h.preprocessorVersion)},${s(h.originatingSystem)},${s(h.authorization)});`,
      `FILE_SCHEMA(${list(h.schemas)});`,
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}
