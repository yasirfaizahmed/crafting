/**
 * Display/parse helpers for UI fields. The model is always millimetres; these only format.
 */
import type { UnitSystem } from '../core/types';
import { formatLength } from '../core/units';

/**
 * Length for an editable field: full precision (mm accuracy) without trailing zeros,
 * e.g. 2537 → "2.537 m", 2500 → "2.5 m", 200 → "200 mm", imperial → 8'-4 1/8" style via formatLength.
 */
export function displayLength(mm: number, units: UnitSystem): string {
  if (!Number.isFinite(mm)) return '';
  if (units === 'imperial') return formatLength(mm, units);
  if (Math.abs(mm) >= 1000) {
    const s = formatLength(mm, units, 3);
    return s.replace(/(\.\d*?)0+ m$/, '$1 m').replace(/\. m$/, ' m');
  }
  const precision = Number.isInteger(Math.round(mm * 10) / 10) ? 0 : 1;
  return formatLength(mm, units, precision);
}

/** Signed level elevation, e.g. "+3.00 m", "±0.00", "-2.80 m". */
export function formatElevation(mm: number, units: UnitSystem): string {
  if (Math.abs(mm) < 0.5) return units === 'imperial' ? `±0'-0"` : '±0.00';
  const s = units === 'metric' ? `${(Math.abs(mm) / 1000).toFixed(2)} m` : formatLength(Math.abs(mm), units);
  return `${mm > 0 ? '+' : '−'}${s}`;
}

export function displayAngle(deg: number): string {
  if (!Number.isFinite(deg)) return '';
  const r = Math.round(deg * 100) / 100;
  return `${r}°`;
}

/** Parse "90", "90°", "-15.5 deg". */
export function parseAngle(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(',', '.').replace(/(°|deg|degrees)$/, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return parseFloat(s);
}

/** Parse a plain number (optionally with a trailing unit word that is ignored). */
export function parseNumber(raw: string): number | null {
  const m = raw.trim().replace(',', '.').match(/^(-?\d+(?:\.\d+)?)\s*[a-z%°]*$/i);
  return m ? parseFloat(m[1]) : null;
}

/** Normalise an angle to [0, 360). */
export function normalizeDeg(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Relative "x minutes ago" for recent-project lists. */
export function timeAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString();
}
