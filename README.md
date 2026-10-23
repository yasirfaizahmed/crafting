# Crafting

**Build like Minecraft. Design like a pro. Free.**

Crafting is a free, browser-based architectural, structural and interior design tool. It plays like
Minecraft in creative mode: there's a hotbar and a creative inventory, you can fly, right-click places,
left-click breaks, and resources are infinite. Underneath, it builds a real BIM model and exports
industry-standard files.

## Two ways to build

1. **Blueprint first.** Draw each floor in the 2D plan editor:
   - drag a rectangle with the Room tool to get four joined walls plus a named room;
   - chain walls and type exact lengths (`3.6m`, `12'6"`);
   - drop doors and windows onto walls.

   You can also trace a scanned blueprint image or import DXF linework. Then press **Generate 3D**:
   rooms, floor finishes, a foundation and a roof are created in one undoable step. **Add floor above**
   copies the exterior walls up a level.
2. **Straight into 3D.** Fly around the world and build:
   - place walls, slabs, doors, windows, stairs, roofs, columns, beams, railings and furniture;
   - stack voxel blocks Minecraft-style;
   - one click inside a room fills its floor, and one click on a building roofs it;
   - building on top of the highest floor adds a new level automatically.

Both views edit the same model, so every change appears in the other view instantly.

## Features

- **BIM model in millimetres:**
  - levels, walls that join cleanly at L, T and X corners, doors (6 styles) and windows (5 styles) cut
    into walls;
  - slabs with holes, roofs (gable, hip, shed, pyramid, flat), stairs (straight, L, U, spiral);
  - columns, beams, railings, rooms with areas, free-form blocks, dimensions and labels.
- **Interior design:**
  - 50 parametric furniture and fixture models across living, dining, bedroom, kitchen, bath, office,
    lighting, outdoor and decor;
  - 60 materials with procedural textures;
  - paint either side of a wall separately; working light fixtures.
- **3D viewer:**
  - sky and sun with soft shadows, adjustable time of day;
  - x-ray, a cut-away of the levels above, and a walk mode with gravity that climbs stairs.
- **2D drafting:**
  - snapping to grid, wall ends, midpoints, perpendiculars, intersections, alignment guides and 15° angles;
  - selection handles that keep joined walls connected, box select, and nudging.
- **Construction documents:**
  - floor plans following AIA layer naming, with material hatches, door swings, window symbols, stair
    break lines, room tags, automatic dimension chains, north arrow and scale bar;
  - elevations, sections, and door/window/room/wall schedules;
  - PDF drawing sets with title blocks.
- **Exports:**
  - **IFC4** for BIM (validated with web-ifc and IfcOpenShell);
  - **DXF** R2000 (audited with ezdxf);
  - **PDF**, **SVG** and **PNG**;
  - **glTF/GLB**, **OBJ**, and **STL** (millimetres, Z-up, ready for slicers).
- **Projects:**
  - autosave in the browser, `.craft` project files and recent projects;
  - DXF import that turns pairs of parallel lines into walls of the right thickness;
  - unlimited undo/redo; copy, paste and duplicate.

## Controls

| | |
| --- | --- |
| `1`–`9`, mouse wheel | Choose hotbar slot |
| `E` | Creative inventory (click an item to put it in your hand) |
| **3D:** RMB / LMB / MMB | Place / break / pick block |
| **3D:** `F` | Toggle Fly (WASD, Space up, Shift down, double-tap Space = walk) and Orbit (right-drag orbit, middle-drag pan) |
| **3D:** `R`, `X`, `C` | Rotate the item in hand, x-ray, cut-away |
| **Plan:** LMB / RMB / middle-drag | Draw or place / finish or cancel / pan |
| `Tab` | Cycle Plan → Split → 3D |
| `PageUp` / `PageDown` | Switch level |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+K` | Command palette |
| `Ctrl+Shift+E` | Export |
| `F1` | Help with all controls |

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
```

Development:

```bash
npm run typecheck
npm test                          # Vitest unit tests
E2E_PORT=4173 npx playwright test # browser end-to-end tests (Chromium)
```

## Project layout

```
src/core/      BIM data model, undo store, wall joins, rooms, stairs, catalog, materials
src/geometry/  element → 3D meshes (walls with openings, roofs, stairs, furniture …)
src/view3d/    Three.js viewport and Minecraft-style builder
src/plan2d/    2D blueprint editor and Generate 3D
src/drawing/   construction drawings (plans, elevations, sections, schedules)
src/export/    IFC, DXF, PDF, SVG, PNG, glTF, OBJ, STL
src/io/        autosave, open/save, recent projects, DXF import
src/ui/        application shell: menus, hotbar, inventory, panels, dialogs
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, module contracts, conventions and the
standards each output follows.
