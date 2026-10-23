# Crafting — Architecture & Module Contracts

Crafting is a free, browser-based architectural / structural / interior design tool that **plays like
Minecraft creative mode** (hotbar, creative inventory, fly camera, right-click to place, left-click to
break, infinite resources) while producing **real BIM data** (IFC4, DXF, PDF drawing sets, glTF/OBJ/STL).

Two ways to build, always in sync because both edit the same model:

1. **Blueprint first** — draw each floor in the 2D plan editor (walls, rooms, doors, windows, stairs),
   optionally tracing a scanned blueprint image or importing DXF linework, then press
   **Generate 3D** to auto-create floors, ceilings, rooms and a roof. The 3D world updates live.
2. **Straight into 3D** — fly around the world and place walls, slabs, doors, furniture and blocks
   Minecraft-style.

## Stack & commands

- TypeScript (strict) + Vite + Three.js (r180), jsPDF. No UI framework: plain DOM modules.
- `npm run dev` · `npm run build` · `npm test` (Vitest, `src/**/*.test.ts`) · `npm run typecheck`
- `E2E_PORT=4181 npx playwright test` — builds, serves `vite preview` on that port, runs `e2e/*.spec.ts`
  in the pre-installed Chromium (WebGL via SwiftShader). **Use a unique port per worktree.**

## Conventions (non-negotiable)

| Thing | Convention |
| --- | --- |
| Model length unit | **millimetres** everywhere in the model and drawings |
| Plan axes | x = east, y = north, viewed from above (right-handed). Angles in **degrees CCW from +x** |
| World (three.js) | metres, **Y up**. `world = (x/1000, elevation/1000, −y/1000)` — see `core/coords.ts` |
| Level elevation | top of floor finish; `level.height` = floor-to-floor |
| Element data | plain JSON objects, immutable values (store replaces objects on update) |
| Wall sides | "left"/"right" looking from `start` to `end`; `wallNormal()` points left |
| Furniture local axes | width along local x, depth along local y; **front faces local −y, back (+y) goes against a wall** |
| UVs | metres of real surface distance (texture repeat = 1000 / material.patternSize) |

## Directory map & ownership

```
src/
  core/        Data model, store/undo, math, walls & joins, catalog, materials, units, serialization
               (shared — additive changes only; see "Rules")
    rooms.ts       room detection (detectRooms / roomAtPoint)            — plan2d owner may improve
    stairs.ts      stair layout (computeStairLayout: treads, landings)   — geometry owner may improve
    autobuild.ts   ← plan2d owner: "Generate 3D" (slabs/ceilings/rooms/roof from walls)
  app/         AppContext (state.ts), context factory, sample project
  geometry/    Element → triangle meshes (world space). Pure TS, runs in Node.        [geometry owner]
  view3d/      Three.js viewport + Minecraft-style builder, camera modes, tools        [view3d owner]
  plan2d/      2D blueprint editor (canvas), drafting tools, underlay tracing            [plan2d owner]
  drawing/     BIM → 2D documentation drawings (plan symbols, layers, dims)           [drawing owner]
  export/      svg.ts dxf.ts pdf.ts plan-png.ts                                       [drawing owner]
               ifc.ts mesh3d.ts (glb/gltf/obj/stl)                                    [export owner]
               index.ts (registry), types.ts                                          [shared, stable]
  io/          Open/save .craft, autosave, recent files, DXF import                   [export owner]
  ui/          Shell: menus, hotbar, inventory, panels, dialogs, keyboard, styles     [ui owner]
  main.ts      Boot (stable)
e2e/           Playwright specs, one file per module (e2e/<module>.spec.ts)
```

## Core API cheat-sheet

```ts
// Model
import type { Project, Element, Wall, Door, Window, Slab, Roof, Stair, Column, Beam,
  Furniture, Room, Block, Railing, Dimension, Label, Level, Vec2 } from '@/core/types';
createProject(), createLevel(), createElement(type, levelId, props), createFromCatalog(item, levelId, props)

// Store (single source of truth)
store.project / store.elements / store.elementsOnLevel(levelId) / store.getElement(id) / store.getLevel(id)
store.transact('Place wall', tx => { tx.add(el); tx.update(id, patch); tx.remove(id);
                                      tx.addLevel(l); tx.updateLevel(id, p); tx.removeLevel(id);
                                      tx.updateInfo(p); tx.updateSettings(p) })  // ONE undo step
store.add / update / remove  (single-op transactions), store.undo() / redo() / canUndo / canRedo
store.subscribe((change: ChangeSet) => …)  // {added, updated, removed, previous, levelsChanged, settingsChanged, reset, origin, label}
affectedIds(project, change)  // core/dependencies.ts: ids whose geometry must rebuild (null = rebuild all)

// Walls (core/walls.ts)
computeWallFootprints(project, levelId) → Map<wallId, WallFootprint>  // join-aware L/T/X miters
wallLength, wallDirection, wallNormal, wallFaceOffsets, pointAtOffset, projectOntoWall,
wallHeight(project, w), wallBaseElevation, openingsOfWall, openingInterval, openingFits, openingOverlaps,
wallDependents, wallsTouch

// Rooms & stairs
detectRooms(project, levelId) → DetectedRoom[] {polygon (clear, CCW), centerPolygon, area, wallIds}
roomAtPoint(project, levelId, p) → DetectedRoom | undefined   // e.g. slab "flood fill" click
computeStairLayout(stair, levelHeight) → {riserCount, riserHeight, treads[{polygon, top}], landings, walkline, footprint}

// Slab openings (core/stairwells.ts): stairs automatically cut the floors/ceilings they rise through.
slabHoles(project, slab) → drawn holes + stairwell openings   // ALWAYS use this, never slab.holes, to render/export/measure
slabNetArea(project, slab), stairwellOpenings(project, slab)   // slab.stairOpenings === false opts out

// Catalog / materials
CATALOG, getCatalogItem(id), catalogItemForElement(el), FURNITURE, getFurniture(id), DEFAULT_HOTBAR
MATERIALS, getMaterial(id), materialFor(el)
```

Removing a wall cascades to its hosted doors/windows (inside the same transaction).
Openings are positioned by `offset` = distance along the host's location line to the opening **centre**.

## AppContext (`src/app/state.ts`)

```ts
interface AppContext { store; ui: Observable<UIState>; selection: Selection; events: EventBus; commands: CommandRegistry }
```

- `ui.get()` / `ui.set(patch)` / `ui.subscribe(fn)`: active level, view mode (`plan|3d|split`), camera
  mode (`fly|orbit`), hotbar (9 catalog ids) + `hotbarIndex`, `inventoryOpen`, snapping flags, grid,
  x-ray, cut-away, shadows, sun position, display units, `toolHint` (status-bar text).
- `activeItem(ui.get())` → the CatalogItem in hand. **The hotbar is shared by 2D and 3D**: the item in
  hand is the active tool in both views.
- `selection`: ordered id set shared by all views (cross-highlighting).
- `events`: `toast`, `zoom-to`, `hover`, `open-dialog`.
- `commands.register({ id, label, group, keys, shortcut, run, enabled, when })`. The ui owner renders
  menus/command palette from the registry and dispatches `keys` globally. Modules register their own
  commands (e.g. plan2d registers `build.generate3d`; view3d registers `view.toggleCamera`).

## Module contracts

### geometry — `buildElementGeometry(gctx, el) → { elementId, parts: GeometryPart[], lights }`
- `createGeometryContext(project)` caches wall footprints per level. `buildProjectGeometry(project, filter?)`.
- `GeometryPart = { mesh: MeshData (world m, Y up, Float32 positions/normals/uvs + Uint32 indices), materialId, role }`.
- Walls: join-aware footprint extruded; **openings cut** (sill/head/jambs), finishes: faces on the
  left/right use `leftFinishId`/`rightFinishId` when set (separate parts), core material elsewhere.
- Doors/windows: frame + leaf/sash + glass parts per style. Slabs with holes. Roofs: flat/gable/hip/
  shed/pyramid with overhang & thickness. Stairs: straight/L/U/spiral with stringers. Columns rect/round,
  beams, railings (posts + rail + balusters/glass), blocks (box/cylinder/wedge/sphere), parametric
  furniture per `FurnitureDef` (recognisable low-poly models, multiple materials), lights for fixtures.
- Must be deterministic, finite, watertight-where-sensible, and fast (sample house < 50 ms).

### view3d — `mountViewport(container, ctx) → ViewportHandle`
Minecraft-style builder. Incremental mesh updates via `affectedIds`. See "Controls".

### plan2d — `mountPlanEditor(container, ctx) → PlanHandle`
Canvas 2D drafting of the **active level**; CAD conventions; see "Controls".

### drawing — `generatePlanDrawing(project, levelId, opts) → Drawing`
`Drawing` primitives (`drawing/types.ts`) in model mm with AIA layers; consumed by SVG/DXF/PDF/PNG.

### export — `EXPORTERS` / `runExport(format, project, options, env)`
Each format implements the stub function in its own file without changing the signature.

### io — see `src/io/index.ts` for the full API
`loadInitialProject`, `startAutosave(ctx)`, `clearAutosave`, `openProjectFile`, `saveProjectFile`,
`downloadBlob`, `pickTextFile`, `pickImageFile`, `listRecentProjects`, `openRecentProject`,
`listDXFLayers`, `importDXF(text, options) → Element[]`.

### ui — `mountApp(root, ctx)`
Owns layout, top menu, hotbar, creative inventory, level panel, properties panel, status bar,
dialogs (export, project settings, shortcuts/help, welcome), toasts, keyboard dispatch, command palette.

## Controls (global keymap — do not collide)

**Global (ui owner; registered commands):** `1–9` hotbar slot · `E` creative inventory · `Esc` close/cancel ·
`Ctrl+Z` undo · `Ctrl+Shift+Z`/`Ctrl+Y` redo · `Delete`/`Backspace` delete selection · `Ctrl+D` duplicate ·
`Ctrl+C`/`Ctrl+V` copy/paste · `Ctrl+A` select all on level · `Ctrl+S` save · `Ctrl+Shift+S` save as ·
`Ctrl+O` open · `Ctrl+N` new · `Ctrl+Shift+E` export · `Tab` cycle view (plan → split → 3D) ·
`PageUp`/`PageDown` level up/down · `G` toggle grid snap · `F1`/`?` help · `Ctrl+K` command palette.

**3D view (view3d owner; only while the 3D view is focused or pointer-locked):**
- `F` toggle camera: **Fly** (pointer lock + crosshair) ⇄ **Orbit**.
- Fly: `WASD` move, `Space` up, `Shift` down, `Ctrl` sprint, double-tap `Space` toggles flying ⇄
  walking (gravity + collision, steps climb stairs). Mouse wheel cycles hotbar.
- Orbit: right-drag orbit, middle-drag (or Shift+right-drag) pan, wheel zoom.
- Clicks (press+release without dragging) in both modes: **LMB = break**, **RMB = place/use**,
  **MMB = pick block** (sets the hotbar slot to `catalogItemForElement`). With the Select tool in hand,
  LMB selects (Shift adds) and drags move the selection on its plane.
- `R` rotate the ghost 90° (Shift+R −15°), `X` x-ray walls, `C` cut away levels above active.
- Two-click tools (wall, beam, railing, rectangle slab/roof, dimension): RMB sets start, RMB again
  commits and **chains** (walls), `Esc`/LMB ends the chain. Live ghost + length readout.
- Single-click tools: door/window on a wall face (snapped along the wall), furniture/stairs on a floor
  (rotate with R), column at grid points, **block = true voxel stacking on the face you point at**,
  **slab click inside an enclosed room = flood-fill the room floor**, **roof click = auto roof over
  that level's footprint**, paint = apply material (walls: the clicked side's finish).
- Building above the top level auto-creates a new level ("infinite resources").

**Plan view (plan2d owner; only while the plan is focused/hovered):** LMB = place/draw with the item
in hand, RMB = cancel/finish (context menu optional), middle-drag or `Space`+drag = pan, wheel = zoom
about cursor, `Shift` = temporarily disable angle snap, `Enter` = finish polyline, `R` rotate ghost,
arrows = nudge selection, double-click = finish chain. Typing a number while drawing sets the exact
length (e.g. `3.6m`, `12'6"`).

Views attach key handlers to their own focusable container and `stopPropagation()` for keys they
consume; the global dispatcher listens on `window`.

## Industry standards followed

- Layers: AIA CAD Layer Guidelines / ISO 13567 style (`A-WALL`, `A-WALL-PATT`, `A-DOOR`, `A-GLAZ`,
  `A-FLOR`, `A-FLOR-STRS`, `A-ROOF`, `S-COLS`, `S-BEAM`, `S-GRID`, `I-FURN`, `A-AREA-IDEN`,
  `A-ANNO-DIMS`, `A-ANNO-TEXT`, `A-ANNO-SYMB`).
- Lineweights ISO 128 pen series (0.13/0.18/0.25/0.35/0.5/0.7 mm); text heights ISO 3098 (2.5/3.5/5/7).
- Scales 1:20, 1:50, 1:100, 1:200, 1:500. Paper ISO A0–A4 + ANSI Letter/Tabloid/ARCH-D.
- IFC4 ADD2 TC1 (`IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey`, `IfcWall`, `IfcSlab`,
  `IfcDoor`, `IfcWindow` via `IfcOpeningElement` + `IfcRelVoidsElement`/`IfcRelFillsElement`,
  `IfcRoof`, `IfcStair`, `IfcColumn`, `IfcBeam`, `IfcRailing`, `IfcFurniture`, `IfcSpace`,
  `IfcBuildingElementProxy`, materials, Pset_*Common, quantities).
- DXF: AutoCAD R2000+ (AC1015) ASCII with layers, lineweights, linetypes.

## Rules for contributors (and parallel agents)

1. Stay inside the directories you own. Shared files (`src/core/*`, `src/app/*`, `src/export/index.ts`,
   `src/export/types.ts`, `src/main.ts`, `package.json`, configs) are **additive-only**: you may add
   new optional fields/exports, never rename/remove/change existing ones. Prefer putting helpers in
   your own directory.
2. Never add npm dependencies (everything needed is installed).
3. Put module CSS in your own directory (e.g. `src/plan2d/plan2d.css`) and import it from your module.
4. Every module ships Vitest tests (`src/<module>/**/*.test.ts`) and, for UI modules, a Playwright
   spec `e2e/<module>.spec.ts`. `npm run typecheck`, `npm test` and `npx vite build` must pass.
5. Use `createSampleProject()` (`src/app/sample.ts`) as the shared fixture.
