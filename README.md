# FrameLens

FrameLens is a cross-platform desktop app for viewing, and eventually editing, Minecraft Java Edition structure `.nbt` files.

## Milestone 1

- Electron, Vite, React, and strict TypeScript desktop shell.
- Native file picker for `.nbt` structure files.
- NBT parsing for Minecraft Java structure files through an internal domain layer.
- Metadata display for file name, byte size, palette count, block count, and entity count.
- Three.js viewport that renders each non-air block as a simple debug cube.

Milestone 1 intentionally does not bundle Minecraft assets, load textures/models, execute mod code, scan installed instances, include a FrameLens Bridge mod, or export edited structures.

## Milestone 1.1

- Keeps the current loaded structure in Electron main-process memory for same-session renderer restoration.
- Restores the current structure if the renderer reloads or remounts.
- Rebuilds the debug cube mesh after WebGL context restoration.

## Milestone 2

- Orbit, pan, zoom, fit, and reset viewport controls.
- X/Y/Z clipping controls that visually hide outer layers without mutating structure data.
- Visible-block picking with selected block details.
- Searchable palette panel and entity list.
- Structure summary with dimensions, total blocks, non-air blocks, visible blocks, palette count, and entity count.

## Milestone 3

- Read-only discovery of local Minecraft asset sources, including the Astralis instance under `~/Documents/astralis` when present.
- Asset providers for loose `assets/` folders, resource pack zips, version jars, and mod jars as archive data only.
- Model and texture resolution for simple blockstate/model chains.
- No mod code is loaded or executed.

## Milestone 4

- Render modes for debug cubes, palette-colored cubes, and textured cubes.
- Textured rendering for supported full-cube block models using locally resolved PNG textures.
- Per-block fallback colors when models or textures are missing or unsupported.
- Clipping and visible-block selection work across render modes.

## Architecture Notes

- Filesystem access lives in Electron main and is exposed to the renderer through a narrow preload API.
- React components consume normalized FrameLens structure data only.
- NBT parsing is kept out of React and isolated behind `src/main/structure/minecraftStructureParser.ts`.
- Placeholder interfaces exist for later instance scanning, asset providers, model resolvers, texture resolvers, and structure exporting.

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

Run validation:

```bash
npm run typecheck
npm test
npm run build
```

## Safety Boundaries

FrameLens does not ship Minecraft assets and does not execute mod code. Structure files and asset archives are parsed as data only.
