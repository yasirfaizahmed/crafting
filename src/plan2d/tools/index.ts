/**
 * Tool factory: the hotbar item's ToolKind → plan tool.
 */
import type { ToolKind } from '../../core/catalog';
import { RoofTool, RoomTool, SlabTool } from './area';
import { BeamTool, DimensionTool, LabelTool, MeasureTool, RailingTool } from './lines';
import { OpeningTool } from './opening';
import { EraserTool, EyedropperTool, PaintTool } from './pick';
import { BlockTool, ColumnTool, FurnitureTool, StairTool } from './place';
import { SelectTool } from './select';
import type { PlanTool, ToolHost } from './types';
import { WallTool } from './wall';

export function createTool(kind: ToolKind, host: ToolHost): PlanTool {
  switch (kind) {
    case 'wall':
      return new WallTool(host);
    case 'room':
      return new RoomTool(host);
    case 'slab':
      return new SlabTool(host);
    case 'roof':
      return new RoofTool(host);
    case 'door':
    case 'window':
      return new OpeningTool(host);
    case 'stair':
      return new StairTool(host);
    case 'column':
      return new ColumnTool(host);
    case 'beam':
      return new BeamTool(host);
    case 'railing':
      return new RailingTool(host);
    case 'furniture':
      return new FurnitureTool(host);
    case 'block':
      return new BlockTool(host);
    case 'dimension':
      return new DimensionTool(host);
    case 'label':
      return new LabelTool(host);
    case 'measure':
      return new MeasureTool(host);
    case 'eraser':
      return new EraserTool(host);
    case 'eyedropper':
      return new EyedropperTool(host);
    case 'paint':
      return new PaintTool(host);
    default:
      return new SelectTool(host);
  }
}

export type { PlanTool, ToolHost, ToolPointer } from './types';
