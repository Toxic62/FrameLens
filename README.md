# FrameLens

FrameLens is a desktop viewer and editor for Minecraft Java Edition structure `.nbt` files.

It is built for inspecting structures visually, understanding their block/entity data, making focused edits, and exporting the result back to `.nbt` without running Minecraft or loading mod code.

## Status

FrameLens is in early development. It can already open, inspect, edit, and export Java structure files, but some Minecraft data is still normalized rather than fully round-tripped. Treat exported files as editable output, not byte-for-byte preservation of every unknown original tag.

## Features

- Open Minecraft Java structure `.nbt` files with a native desktop file picker.
- Render non-air blocks in an interactive Three.js viewport.
- Orbit, pan, zoom, fit, reset, and clip structures by X/Y/Z bounds.
- Select visible blocks from the 3D view or from the grouped block list.
- Inspect structure metadata, dimensions, palette counts, block counts, entities, and visible block counts.
- Use local Minecraft instance assets for textured rendering.
- Read loose `assets/` folders, resource pack archives, version jars, and mod jars as data.
- Download and cache the matching vanilla client jar as a fallback asset source when the Minecraft version can be detected.
- Render supported block models with textures, including simple cuboid model elements and UVs.
- Highlight selected blocks clearly in the renderer.
- Edit common block properties such as facing, axis, slab type, stair shape, waterlogged, level, rotation, and related boolean-like values.
- Edit simple block entity fields for supported data-bearing blocks.
- Edit container contents and loot table data for supported container-like blocks.
- Add, transform, delete, undo, redo, and export edited structures.
- Autocomplete block and item ids from detected assets and loaded structure data.

## Safety Boundaries

FrameLens does not ship Minecraft assets and does not execute Minecraft or mod code.

Structure files, resource packs, jars, and instance folders are treated as data sources only. Filesystem access, asset scanning, vanilla asset downloads, NBT parsing, and export writing live in Electron main/preload code rather than in React UI code.

## Development

Install dependencies:

```bash
npm install
```

Run the app in development mode:

```bash
npm run dev
```

On macOS, you can also double-click `launch-framelens.command`. It bootstraps a local Node runtime if needed, installs dependencies if missing, and launches the app.

## Usage

1. Click **Open .nbt** and choose a Minecraft Java structure file.
2. Use the viewport to orbit, zoom, select blocks, and inspect the structure.
3. Click **Select instance** to choose a Minecraft instance folder for textured rendering.
4. Use the sidebar to search block groups, edit properties/data, add or transform blocks, and manage selections.
5. Click **Export** to save the edited structure as a new `.nbt` file.

## Validation

Run the core checks:

```bash
npm run typecheck
npm test
npm run build
```

The slower local Astralis asset smoke test is opt-in:

```bash
FRAMELENS_RUN_ASTRALIS_TEST=true npm test
```

## Project Structure

- `src/main/structure/` parses, normalizes, stores, and exports structure NBT data.
- `src/main/assets/` scans Minecraft instance assets and resolves block/item asset ids, models, and textures.
- `src/shared/` contains renderer-safe types, IPC contracts, viewer helpers, and block capability logic.
- `src/preload/` exposes the narrow Electron API consumed by the renderer.
- `src/renderer/` contains the React UI, editor workflows, and Three.js viewport.

## Roadmap

- Package FrameLens as normal desktop installers/apps for macOS, Windows, and Linux.
- Improve support for more Minecraft block model variants and block entity renderers.
- Expand block capability detection and editing for richer block entity types.
- Preserve more unknown NBT data during export.
- Add stronger visual regression coverage for the renderer and editor UI.
