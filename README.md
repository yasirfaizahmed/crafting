# Crafting

**Build like Minecraft. Design like a pro. Free.**

Crafting is a free, browser-based architectural, structural and interior design tool. It plays like
Minecraft in creative mode: there's a hotbar and a creative inventory, you can fly, right-click places
something, left-click breaks it, and resources are infinite. Underneath, it builds a real BIM model
that exports to industry formats.

- **Blueprint → 3D**: draw each floor in 2D (or trace a scanned blueprint), then generate floors,
  rooms and a roof automatically.
- **Straight into 3D**: fly around and place walls, slabs, doors, windows, stairs, roofs, furniture and
  voxel blocks.
- **Exports**: IFC4 (BIM), DXF (CAD), PDF drawing sets, SVG, PNG, glTF/GLB, OBJ, STL.

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # unit tests
npm run build     # production build in dist/
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model, module contracts and controls.
