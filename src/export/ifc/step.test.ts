import { describe, expect, it } from 'vitest';
import { compressGuid, expandGuid, GuidRegistry, ifcGuid, murmur3x86_128 } from './guid';
import { DERIVED, encodeArg, enm, formatReal, formatString, int, Ref, StepWriter, typed } from './step';

describe('STEP encoding', () => {
  it('formats reals with a decimal point', () => {
    expect(formatReal(0)).toBe('0.');
    expect(formatReal(-0)).toBe('0.');
    expect(formatReal(12000)).toBe('12000.');
    expect(formatReal(-2.5)).toBe('-2.5');
    expect(formatReal(0.1 + 0.2)).toBe('0.3');
    expect(formatReal(1e-5)).toBe('0.00001');
    expect(formatReal(1.5e-9)).toBe('1.5E-9');
    expect(formatReal(1e21)).toBe('1.E21');
    expect(() => formatReal(NaN)).toThrow();
    expect(() => formatReal(Infinity)).toThrow();
  });

  it('escapes strings per ISO 10303-21', () => {
    expect(formatString("O'Brien")).toBe("'O''Brien'");
    expect(formatString('a\\b')).toBe("'a\\\\b'");
    expect(formatString('Sofa — 3 Seat')).toBe("'Sofa \\X2\\2014\\X0\\ 3 Seat'");
    expect(formatString('Größe')).toBe("'Gr\\X2\\00F600DF\\X0\\e'");
    expect(formatString('🛋️')).toBe("'\\X4\\0001F6CB\\X0\\\\X2\\FE0F\\X0\\'");
    expect(formatString('line\nbreak')).toBe("'line break'");
  });

  it('encodes every argument kind', () => {
    expect(encodeArg(null)).toBe('$');
    expect(encodeArg(undefined)).toBe('$');
    expect(encodeArg(DERIVED)).toBe('*');
    expect(encodeArg(true)).toBe('.T.');
    expect(encodeArg(false)).toBe('.F.');
    expect(encodeArg(int(3.2))).toBe('3');
    expect(encodeArg(enm('standard'))).toBe('.STANDARD.');
    expect(encodeArg(new Ref(42))).toBe('#42');
    expect(encodeArg(typed('IfcLabel', 'x'))).toBe("IFCLABEL('x')");
    expect(encodeArg([1, [int(2), 'a'], null])).toBe("(1.,(2,'a'),$)");
  });

  it('writes a complete exchange structure', () => {
    const w = new StepWriter();
    const a = w.add('IfcCartesianPoint', [[0, 0, 0]]);
    w.add('IFCAXIS2PLACEMENT3D', [a, null, null]);
    expect(w.count('IFCCARTESIANPOINT')).toBe(1);
    const text = w.render({
      description: ['ViewDefinition [DesignTransferView]'],
      implementationLevel: '2;1',
      name: 'x.ifc',
      timeStamp: '2026-01-01T00:00:00',
      author: [''],
      organization: [''],
      preprocessorVersion: 'p',
      originatingSystem: 'o',
      authorization: 'None',
      schemas: ['IFC4'],
    });
    expect(text.startsWith('ISO-10303-21;\nHEADER;\n')).toBe(true);
    expect(text).toContain("FILE_SCHEMA(('IFC4'));");
    expect(text).toContain('#1=IFCCARTESIANPOINT((0.,0.,0.));');
    expect(text).toContain('#2=IFCAXIS2PLACEMENT3D(#1,$,$);');
    expect(text.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });
});

describe('IFC GlobalId', () => {
  it('matches the MurmurHash3 x86_128 reference vectors', () => {
    const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    // Reference: smhasher MurmurHash3_x86_128 with seed 0 (h1..h4 little-endian words).
    expect(hex(murmur3x86_128(new Uint8Array()))).toBe('00000000000000000000000000000000');
    const enc = (t: string) => hex(murmur3x86_128(new TextEncoder().encode(t)));
    // Values from the Python mmh3 package: mmh3.hash_bytes(s, 0, x64arch=False).
    expect(enc('Hello, world!')).toBe('a7dbac26fc8d63f063422b40c3d4fd0a');
    expect(enc('The quick brown fox jumps over the lazy dog')).toBe('c383152f672ceeec6cf67b5d2c1de9e5');
    expect(enc('abc')).toBe('d1c6cd75a506b0a2a506b0a2a506b0a2');
  });

  it('is deterministic, 22 chars and round-trips', () => {
    const g = ifcGuid('prj_1/wal_abc');
    expect(g).toHaveLength(22);
    expect(g).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(ifcGuid('prj_1/wal_abc')).toBe(g);
    expect(ifcGuid('prj_1/wal_abd')).not.toBe(g);
    const bytes = expandGuid(g);
    expect(compressGuid(bytes)).toBe(g);
    expect(bytes[6] >> 4).toBe(8);
    expect(bytes[8] >> 6).toBe(2);
  });

  it('compresses known UUIDs like IfcOpenShell', () => {
    const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
    expect(compressGuid(fromHex('00000000000000000000000000000000'))).toBe('0000000000000000000000');
    expect(compressGuid(fromHex('ffffffffffffffffffffffffffffffff'))).toBe('3$$$$$$$$$$$$$$$$$$$$$');
  });

  it('never hands out the same id twice', () => {
    const r = new GuidRegistry('ns');
    const a = r.get('k');
    const b = r.get('k');
    expect(a).not.toBe(b);
  });
});
