/**
 * Small fuzzy matcher for the command palette: subsequence matching with bonuses for word starts,
 * consecutive runs and prefix matches. Pure; returns matched character indices for highlighting.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices into the haystack of matched characters. */
  indices: number[];
}

const isBoundary = (s: string, i: number) => i === 0 || /[\s\-_./·—()]/.test(s[i - 1]) || (/[a-z]/.test(s[i - 1]) && /[A-Z]/.test(s[i]));

/** Score `query` against `text` (case-insensitive). Null when not every query char appears in order. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  // Fast path: contiguous substring.
  const at = t.indexOf(q);
  if (at >= 0) {
    const indices = Array.from({ length: q.length }, (_, k) => at + k);
    return { score: 100 + q.length * 6 - at + (at === 0 ? 40 : isBoundary(text, at) ? 25 : 0) - text.length * 0.1, indices };
  }
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    if (c === ' ') continue;
    // Prefer the next word-boundary occurrence when it is reasonably close.
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] !== c) continue;
      if (found < 0) found = j;
      if (isBoundary(text, j)) {
        if (j - found < 12) found = j;
        break;
      }
    }
    if (found < 0) return null;
    const consecutive = indices.length > 0 && found === indices[indices.length - 1] + 1;
    run = consecutive ? run + 1 : 0;
    score += 1 + (isBoundary(text, found) ? 8 : 0) + run * 4 - Math.min(found - ti, 10) * 0.5;
    indices.push(found);
    ti = found + 1;
  }
  return { score: score - text.length * 0.1, indices };
}

/** Rank items by the best score over their searchable strings; ties keep the input order. */
export function fuzzyRank<T>(items: readonly T[], query: string, texts: (item: T) => string[], limit = 50): { item: T; match: FuzzyMatch; field: number }[] {
  const out: { item: T; match: FuzzyMatch; field: number; order: number }[] = [];
  items.forEach((item, order) => {
    let best: FuzzyMatch | null = null;
    let field = 0;
    const fields = texts(item);
    for (let i = 0; i < fields.length; i++) {
      const m = fuzzyMatch(query, fields[i]);
      if (!m) continue;
      // Secondary fields (group, keywords) count a little less than the label.
      if (i > 0) m.score -= 15;
      if (!best || m.score > best.score) {
        best = m;
        field = i;
      }
    }
    if (best) out.push({ item, match: best, field, order });
  });
  out.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return out.slice(0, limit).map(({ item, match, field }) => ({ item, match, field }));
}

/** Split text into plain / highlighted runs for rendering. */
export function highlightRuns(text: string, indices: readonly number[]): { text: string; hit: boolean }[] {
  const set = new Set(indices);
  const runs: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else runs.push({ text: text[i], hit });
  }
  return runs;
}
