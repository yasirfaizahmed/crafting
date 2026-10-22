import type { UnitSystem } from './types';

const MM_PER_INCH = 25.4;

/** Format a length (mm) for display. */
export function formatLength(mm: number, units: UnitSystem = 'metric', precision?: number): string {
  if (!Number.isFinite(mm)) return '—';
  if (units === 'imperial') {
    const totalInches = mm / MM_PER_INCH;
    const sign = totalInches < 0 ? '-' : '';
    const abs = Math.abs(totalInches);
    let feet = Math.floor(abs / 12);
    let inches = abs - feet * 12;
    // round to 1/8"
    inches = Math.round(inches * 8) / 8;
    if (inches >= 12) {
      feet += 1;
      inches -= 12;
    }
    const inchStr = Number.isInteger(inches) ? `${inches}` : inches.toFixed(3).replace(/0+$/, '');
    return `${sign}${feet}'-${inchStr}"`;
  }
  if (Math.abs(mm) >= 1000) return `${(mm / 1000).toFixed(precision ?? 2)} m`;
  return `${mm.toFixed(precision ?? 0)} mm`;
}

export function formatArea(mm2: number, units: UnitSystem = 'metric'): string {
  if (units === 'imperial') return `${(mm2 / (MM_PER_INCH * MM_PER_INCH * 144)).toFixed(1)} ft²`;
  return `${(mm2 / 1e6).toFixed(2)} m²`;
}

export function formatVolume(mm3: number, units: UnitSystem = 'metric'): string {
  if (units === 'imperial') return `${(mm3 / Math.pow(MM_PER_INCH * 12, 3)).toFixed(2)} ft³`;
  return `${(mm3 / 1e9).toFixed(3)} m³`;
}

/**
 * Parse a user-typed length into mm. Accepts: "3000", "3000mm", "3m", "3.2 m", "300cm",
 * "10'", "10' 6\"", "10'-6\"", "6\"", "10ft", "6in". Bare numbers use the unit system default
 * (mm for metric, inches for imperial).
 */
export function parseLength(input: string, units: UnitSystem = 'metric'): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, '.');
  if (!s) return null;
  const imperial = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (imperial) {
    const ft = parseFloat(imperial[1]);
    const inch = imperial[2] ? parseFloat(imperial[2]) : 0;
    return (Math.abs(ft) * 12 + inch) * MM_PER_INCH * Math.sign(ft || 1);
  }
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|"|in|inch|inches)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case 'mm':
      return v;
    case 'cm':
      return v * 10;
    case 'm':
      return v * 1000;
    case '"':
    case 'in':
    case 'inch':
    case 'inches':
      return v * MM_PER_INCH;
    default:
      return units === 'imperial' ? v * MM_PER_INCH : v;
  }
}
