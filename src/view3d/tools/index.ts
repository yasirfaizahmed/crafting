/** Tool factory: the catalog item in hand decides the active 3D tool. */
import { RoofTool, SlabTool } from './area';
import { LinearTool } from './linear';
import { AnnotationTool, EraserTool, EyedropperTool, MeasureTool, PaintTool } from './misc';
import { OpeningTool } from './opening';
import { BlockTool, ColumnTool, FurnitureTool, StairTool } from './placement';
import { SelectTool } from './select';
import type { Tool, ToolEnv } from './types';

export type { GhostSink, PickHit, PlanPoint, PlayerView, Tool, ToolEnv, KeyInput, GhostOptions } from './types';
export { breakAt, pickBlockAt } from './actions';

export function createTool(env: ToolEnv): Tool {
  switch (env.item.tool) {
    case 'select':
      return new SelectTool(env);
    case 'wall':
      return new LinearTool(env, 'wall');
    case 'beam':
      return new LinearTool(env, 'beam');
    case 'railing':
      return new LinearTool(env, 'railing');
    case 'slab':
      return new SlabTool(env);
    case 'roof':
      return new RoofTool(env);
    case 'door':
    case 'window':
      return new OpeningTool(env);
    case 'furniture':
      return new FurnitureTool(env);
    case 'stair':
      return new StairTool(env);
    case 'column':
      return new ColumnTool(env);
    case 'block':
      return new BlockTool(env);
    case 'paint':
      return new PaintTool(env);
    case 'eraser':
      return new EraserTool(env);
    case 'eyedropper':
      return new EyedropperTool(env);
    case 'measure':
      return new MeasureTool(env);
    case 'dimension':
    case 'label':
    case 'room':
      return new AnnotationTool(env);
  }
}
