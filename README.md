# FrameLens

FrameLens is a cross-platform desktop app for viewing, and eventually editing, Minecraft Java Edition structure `.nbt` files.

## Milestone 1

- Electron, Vite, React, and strict TypeScript desktop shell.
- Native file picker for `.nbt` structure files.
- NBT parsing for Minecraft Java structure files through an internal domain layer.
- Metadata display for file name, byte size, palette count, block count, and entity count.
- Three.js viewport that renders each non-air block as a simple debug cube.

Milestone 1 intentionally does not bundle Minecraft assets, execute mod code, scan installed instances automatically, or include a FrameLens Bridge mod.

## Milestone 1.1

- Keeps the current loaded structure in Electron main-process memory for same-session renderer restoration.
- Restores the current structure if the renderer reloads or remounts.
- Rebuilds the debug cube mesh after WebGL context restoration.

## Milestone 2

- Orbit, pan, zoom, fit, and reset viewport controls.
- X/Y/Z clipping controls that visually hide outer layers without mutating structure data.
- Visible-block picking with selected block details.
- Entity list and clipping controls.
- Structure summary with dimensions, total blocks, non-air blocks, visible blocks, palette count, and entity count.

## Milestone 3

- Manual selection of a local Minecraft instance folder for read-only asset access.
- Asset providers for loose `assets/` folders, resource pack zips, version jars, and mod jars as archive data only.
- Minecraft version detection from instance metadata such as `minecraftinstance.json`, Prism/MultiMC `instance.cfg`, or launcher `versions/` folders.
- On-demand vanilla client asset caching for the detected Minecraft version through Mojang's public version manifest.
- Model and texture resolution for simple blockstate/model chains.
- No mod code is loaded or executed.

## Milestone 4

- Render modes for debug cubes, palette-colored cubes, and textured cubes.
- Textured rendering for supported block models using locally resolved PNG textures.
- Per-block fallback colors when models or textures are missing or unsupported.
- Clipping and visible-block selection work across render modes.

## Milestone 5

- Parses simple block entity NBT from structure blocks and exposes editable string/number fields in the inspector.
- Jigsaw block entities expose name, target, pool, final state, joint, and priority fields for in-memory editing.
- Container-like block entities expose either loot table fields or editable item slots, depending on what was loaded from NBT.
- Block properties can be edited from known option lists for common Minecraft properties such as facing, orientation, axis, slab type, stair shape, waterlogged, level, and rotation.
- The grouped block list is visible by default, searchable, can highlight a whole group in the viewport, and can expand to select one or more individual blocks.
- Block property and block entity edits open in a modal editor instead of expanding the left panel.
- Textured rendering consumes simple Minecraft model elements and face UVs, so slab, stair, and grindstone-style blocks render as model cuboids with better texture placement.
- Minecraft chests render with vanilla entity chest textures on a simplified chest cuboid until dedicated block entity models are supported.

## Milestone 6

- Toolbar commands for opening structures, exporting structures, selecting an instance folder, fit/reset, render mode, undo, redo, adding blocks, transforming blocks, and deleting selected blocks.
- In-memory undo/redo for structure edits.
- Multi-select actions from the grouped block list.
- Delete selected blocks, add a block by nudging from an existing coordinate, and transform a selected block into another block.
- Export the edited normalized structure back to `.nbt` through Electron main.
- Collapsible left-panel sections for structure, assets, clipping, selection, blocks, and entities.

## Architecture Notes

- Filesystem access lives in Electron main and is exposed to the renderer through a narrow preload API.
- React components consume normalized FrameLens structure data only.
- NBT parsing is kept out of React and isolated behind `src/main/structure/minecraftStructureParser.ts`.
- Structure exporting is implemented as a normalized writer. It preserves known block names, properties, positions, entities by id, and simple editable block entity fields; unknown original NBT is not fully round-tripped yet.
- Placeholder interfaces exist for later instance scanning, asset providers, model resolvers, texture resolvers, and richer structure exporting.

## Development

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run dev
```

On macOS, you can also double-click `launch-framelens.command` in this folder. It bootstraps a local Node runtime if needed, installs dependencies if missing, and launches the app.

Open a structure with **Open .nbt** in the toolbar. For textured rendering, use **Select instance** in the toolbar and select the root folder of the Minecraft instance you want FrameLens to read from. FrameLens reads loose `assets/` folders, resource pack archives, and mod jars as data; if it can detect the Minecraft version from that selected folder, it downloads the matching vanilla client jar into the app's local cache outside the repository and uses it as the final fallback asset provider.

Use the grouped block list to select blocks, open property/data editors, or multi-select blocks for toolbar actions. Use **Export** in the toolbar to save the current normalized edited structure as `.nbt`.

Run validation:

```bash
npm run typecheck
npm test
npm run build
```

The slow local Astralis asset smoke test is opt-in:

```bash
FRAMELENS_RUN_ASTRALIS_TEST=true npm test
```

## Safety Boundaries

FrameLens does not ship Minecraft assets and does not execute mod code. Structure files and asset archives are parsed as data only. Filesystem access, folder picking, asset archive reads, and vanilla asset downloads stay in Electron main/preload rather than React.
