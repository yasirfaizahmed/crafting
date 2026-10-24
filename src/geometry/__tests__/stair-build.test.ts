import { describe, expect, it } from 'vitest';
import { computeStairLayout } from '../../core/stairs';
import type { Project, Stair, StairRuns } from '../../core/types';
import { buildElementGeometry, createGeometryContext } from '../index';
import { landingGuardEdges } from '../stairs';
import type { GeometryPart } from '../types';
import { expectValidParts, planBounds, testProject } from './helpers';

function build(project: Project, el: Stair): GeometryPart[] {
  return buildElementGeometry(createGeometryContext(project), el).parts;
}
const names = (parts: GeometryPart[]) => new Set(parts.map((p) => p.name));

const L_RUNS: StairRuns = { flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'left', angle: 90 }] };

describe('stair construction settings', () => {
  it('builds solid or stringer structures regardless of material, with open or closed risers', () => {
    const { project, add } = testProject();
    const solidWood = add('stair', { shape: 'straight', materialId: 'wood-oak', structure: 'solid' }) as Stair;
    expect(names(build(project, solidWood)).has('stringers')).toBe(false);
    const stringerConcrete = add('stair', { shape: 'straight', materialId: 'concrete', structure: 'stringers', position: { x: 5000, y: 0 } }) as Stair;
    const parts = build(project, stringerConcrete);
    expectValidParts(parts);
    expect(names(parts).has('stringers')).toBe(true);
    expect(names(parts).has('risers')).toBe(true); // closed by default for non-metal
    const open = add('stair', { shape: 'straight', materialId: 'wood-oak', risers: 'open', position: { x: 9000, y: 0 } }) as Stair;
    expect(names(build(project, open)).has('risers')).toBe(false);
  });

  it('follows rail height, sides and baluster spacing', () => {
    const { project, add } = testProject();
    const base = { shape: 'straight' as const, materialId: 'wood-oak', position: { x: 0, y: 0 }, rotation: 0 };
    const tall = add('stair', { ...base, railHeight: 1100 }) as Stair;
    const rise = computeStairLayout(tall, 3000).rise;
    const railTop = planBounds(build(project, tall).filter((p) => p.name === 'handrail')).maxZ;
    expect(railTop).toBeGreaterThan(rise + 1000);
    const none = add('stair', { ...base, handrails: 'none', position: { x: 5000, y: 0 } }) as Stair;
    expect(build(project, none).some((p) => p.role === 'detail')).toBe(false);
    const count = (s: Stair) => build(project, s).filter((p) => p.name === 'balusters').reduce((a, p) => a + p.mesh.indices.length, 0);
    const dense = add('stair', { ...base, balusterSpacing: 60, position: { x: 10000, y: 0 } }) as Stair;
    const sparse = add('stair', { ...base, balusterSpacing: 200, position: { x: 15000, y: 0 } }) as Stair;
    expect(count(dense)).toBeGreaterThan(count(sparse));
  });
});

describe('landing guard rails', () => {
  it('guards the outside of a quarter turn and both sides of a straight landing', () => {
    const { add } = testProject();
    const l = computeStairLayout(add('stair', { runs: L_RUNS, position: { x: 0, y: 0 }, rotation: 0 }) as Stair, 3000);
    const edges = landingGuardEdges(l, 0);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.side === 'right')).toBe(true); // left turn → outside is on the right
    const straight = computeStairLayout(
      add('stair', { runs: { flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'none' }] }, position: { x: 0, y: 0 } }) as Stair,
      3000,
    );
    expect(landingGuardEdges(straight, 0).map((e) => e.side).sort()).toEqual(['left', 'right']);
  });

  it('guards the well of a half turn and the unused part of a deep quarter landing', () => {
    const { add } = testProject();
    const u = computeStairLayout(
      add('stair', { runs: { flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'right', angle: 180, gap: 300 }] } }) as Stair,
      3000,
    );
    const edges = landingGuardEdges(u, 0);
    expect(edges).toHaveLength(4);
    expect(edges.filter((e) => e.side === 'right')).toHaveLength(1); // the well, inside a right turn
    const deep = computeStairLayout(
      add('stair', { runs: { flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'left', angle: 90, depth: 1800 }] } }) as Stair,
      3000,
    );
    expect(landingGuardEdges(deep, 0)).toHaveLength(3);
  });

  it('puts the guard rails on top of the landing', () => {
    const { project, add } = testProject();
    const st = add('stair', { runs: L_RUNS, materialId: 'wood-oak', position: { x: 0, y: 0 }, rotation: 0 }) as Stair;
    const layout = computeStairLayout(st, 3000);
    const landing = layout.landings[0];
    const parts = build(project, st);
    expectValidParts(parts);
    // A post stands on the landing's outer corner area, rising from the landing top.
    const posts = parts.filter((p) => p.name === 'posts' && p.role === 'detail');
    const zs: number[] = [];
    for (const part of posts) for (let i = 1; i < part.mesh.positions.length; i += 3) zs.push(part.mesh.positions[i] * 1000);
    expect(zs.some((z) => Math.abs(z - landing.top) < 1)).toBe(true);
  });

  it('follows stretched landings: open pieces of every edge are guarded, joins with flights are not', () => {
    const { add } = testProject();
    const make = (landing: StairRuns['landings'][number]) =>
      computeStairLayout(add('stair', { runs: { flights: [{ treads: 7 }, { treads: 8 }], landings: [landing] }, position: { x: 0, y: 0 }, rotation: 0 }) as Stair, 3000);
    // Quarter turn left with a wider outside: far edge, outer side and the new strip of back edge.
    const outer = landingGuardEdges(make({ turn: 'left', angle: 90, extendRight: 400 }), 0);
    expect(outer).toHaveLength(3);
    expect(outer.every((e) => e.side === 'right')).toBe(true);
    const len = (e: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    expect(outer.map(len).sort((a, b) => a - b)).toEqual([400, 1000, 1400]);
    // Walking further before the turn: the strip of back edge on the inside is guarded on the inside.
    const run = landingGuardEdges(make({ turn: 'left', angle: 90, extendLeft: 500 }), 0);
    expect(run.filter((e) => e.side === 'left').map(len)).toEqual([500]);
    // Platform past the next flight: its piece of the turning edge belongs to the outside.
    const past = landingGuardEdges(make({ turn: 'left', angle: 90, beyond: 300 }), 0);
    expect(past.every((e) => e.side === 'right')).toBe(true);
    expect(past.map(len).sort((a, b) => a - b)).toEqual([300, 1000, 1300]);
    // A wider straight landing guards the strips of its back and far edges beside the flights.
    const wide = landingGuardEdges(make({ turn: 'none', extendLeft: 200, extendRight: 300 }), 0);
    expect(wide.filter((e) => e.side === 'left').map(len).sort((a, b) => a - b)).toEqual([200, 200, 1000]);
    expect(wide.filter((e) => e.side === 'right').map(len).sort((a, b) => a - b)).toEqual([300, 300, 1000]);
  });
});
