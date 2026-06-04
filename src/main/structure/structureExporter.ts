import nbt from 'prismarine-nbt'
import { createBlockAssetKey } from '@shared/assets'
import type { BlockEntitySummary, LoadedStructure, PaletteEntry, RenderableBlock } from '@shared/structure'

type NbtTag =
  | { readonly type: 'byte'; readonly value: number }
  | { readonly type: 'int'; readonly value: number }
  | { readonly type: 'long'; readonly value: [number, number] }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'compound'; readonly name?: string; readonly value: Record<string, NbtTag> }
  | { readonly type: 'list'; readonly value: { readonly type: string; readonly value: unknown[] } }

export function exportMinecraftStructure(structure: LoadedStructure): Buffer {
  const palette = buildPalette(structure.blocks, structure.palette)

  const root: NbtTag = {
    name: '',
    type: 'compound',
    value: {
      size: intList([structure.dimensions.x, structure.dimensions.y, structure.dimensions.z]),
      palette: compoundList(palette.map(toPaletteTag)),
      blocks: compoundList(structure.blocks.map((block) => toBlockTag(block, palette))),
      entities: compoundList(structure.entities.map((entity) => ({ nbt: compound({ id: stringTag(entity.id) }) })))
    }
  }

  return nbt.writeUncompressed(root as Parameters<typeof nbt.writeUncompressed>[0])
}

function buildPalette(blocks: readonly RenderableBlock[], originalPalette: readonly PaletteEntry[]): readonly PaletteEntry[] {
  const palette = new Map<string, PaletteEntry>()

  for (const entry of originalPalette) {
    palette.set(createBlockAssetKey(entry.name, entry.properties), entry)
  }

  for (const block of blocks) {
    const key = createBlockAssetKey(block.name, block.properties)
    if (!palette.has(key)) {
      palette.set(key, {
        index: palette.size,
        name: block.name,
        properties: block.properties
      })
    }
  }

  return [...palette.values()].map((entry, index) => ({ ...entry, index }))
}

function toPaletteTag(entry: PaletteEntry): Record<string, NbtTag> {
  const tag: Record<string, NbtTag> = {
    Name: stringTag(entry.name)
  }

  if (Object.keys(entry.properties).length > 0) {
    tag.Properties = compound(
      Object.fromEntries(Object.entries(entry.properties).map(([key, value]) => [key, stringTag(value)]))
    )
  }

  return tag
}

function toBlockTag(block: RenderableBlock, palette: readonly PaletteEntry[]): Record<string, NbtTag> {
  const state = palette.findIndex((entry) => createBlockAssetKey(entry.name, entry.properties) === createBlockAssetKey(block.name, block.properties))
  const tag: Record<string, NbtTag> = {
    pos: intList([...block.position]),
    state: intTag(Math.max(state, 0))
  }

  if (block.blockEntity) {
    tag.nbt = toBlockEntityTag(block.blockEntity)
  }

  return tag
}

function toBlockEntityTag(blockEntity: BlockEntitySummary): NbtTag {
  const fields: Record<string, NbtTag> = {
    id: stringTag(blockEntity.id)
  }

  for (const [key, value] of Object.entries(blockEntity.fields)) {
    if (blockEntity.kind === 'container' && blockEntity.containerMode === 'items' && (key === 'LootTable' || key === 'LootTableSeed')) {
      continue
    }
    fields[key] = inferPrimitiveTag(value)
  }

  if (blockEntity.kind === 'container' && blockEntity.containerMode === 'items') {
    fields.Items = compoundList(
      (blockEntity.items ?? []).map((item) => ({
        Slot: byteTag(item.slot),
        id: stringTag(item.id),
        Count: byteTag(item.count)
      }))
    )
  }

  return compound(fields)
}

function inferPrimitiveTag(value: string): NbtTag {
  if (/^-?\d+$/.test(value)) {
    const numeric = Number(value)
    if (Number.isSafeInteger(numeric)) {
      return intTag(numeric)
    }
  }

  return stringTag(value)
}

function compound(value: Record<string, NbtTag>): NbtTag {
  return { type: 'compound', value }
}

function compoundList(value: readonly Record<string, NbtTag>[]): NbtTag {
  return { type: 'list', value: { type: 'compound', value: [...value] } }
}

function intList(value: readonly number[]): NbtTag {
  return { type: 'list', value: { type: 'int', value: [...value] } }
}

function intTag(value: number): NbtTag {
  return { type: 'int', value }
}

function byteTag(value: number): NbtTag {
  return { type: 'byte', value }
}

function stringTag(value: string): NbtTag {
  return { type: 'string', value }
}
