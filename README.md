# FrameLens

FrameLens is a cross-platform desktop app for viewing, and eventually editing, Minecraft Java Edition structure `.nbt` files.

## Milestone 1

- Electron, Vite, React, and strict TypeScript desktop shell.
- Native file picker for `.nbt` structure files.
- NBT parsing for Minecraft Java structure files through an internal domain layer.
- Metadata display for file name, byte size, palette count, block count, and entity count.
- Three.js viewport that renders each non-air block as a simple debug cube.

Milestone 1 intentionally does not bundle Minecraft assets, load textures/models, execute mod code, scan installed instances, include a FrameLens Bridge mod, or export edited structures.

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

Run validation:

```bash
npm run typecheck
npm test
npm run build
```

## Safety Boundaries

FrameLens does not ship Minecraft assets and does not execute mod code. Structure files are parsed as data only.
