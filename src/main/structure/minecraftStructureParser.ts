import nbt from 'prismarine-nbt'
import { inferBlockEntityCapability } from '@shared/blockCapabilities'
import type {
  BlockEntitySummary,
  BlockPosition,
  ContainerItemSummary,
  EntitySummary,
  LoadedStructure,
  PaletteEntry,
  RenderableBlock,
  StructureDimensions
} from '@shared/structure'

export interface ParseStructureInput {
  readonly fileName: string
  readonly byteSize: number
  readonly data: Buffer
}

export class StructureParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StructureParseError'
  }
}

type NbtValue = unknown
type NbtRecord = Record<string, NbtValue>

const AIR_BLOCK_NAMES = new Set(['air', 'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])

export async function parseMinecraftStructure(input: ParseStructureInput): Promise<LoadedStructure> {
  let parsed: unknown

  try {
    const result = await nbt.parse(input.data)
    parsed = nbt.simplify(result.parsed)
  } catch (error) {
    throw new StructureParseError(error instanceof Error ? error.message : 'Failed to parse NBT data.')
  }

  const root = asRecord(parsed, 'NBT root')
  const dimensions = readDimensions(root.size)
  const palette = readPalette(root.palette)
  const allBlocks = readBlocks(root.blocks, palette)
  const entities = readEntities(root.entities)
  const blocks = allBlocks.filter((block) => !AIR_BLOCK_NAMES.has(block.name))

  return {
    metadata: {
      fileName: input.fileName,
      byteSize: input.byteSize,
      paletteCount: palette.length,
      blockCount: allBlocks.length,
      blockEntityCount: allBlocks.filter((block) => block.blockEntity !== undefined).length,
      entityCount: entities.length
    },
    dimensions,
    palette,
    blocks,
    entities
  }
}

function readDimensions(value: NbtValue): StructureDimensions {
  const size = asNumberArray(value, 'size')
  if (size.length !== 3) {
    throw new StructureParseError('Structure size must contain exactly 3 numbers.')
  }

  return {
    x: size[0] ?? 0,
    y: size[1] ?? 0,
    z: size[2] ?? 0
  }
}

function readPalette(value: NbtValue): PaletteEntry[] {
  const entries = asArray(value, 'palette')

  return entries.map((entry, index) => {
    const record = asRecord(entry, `palette[${index}]`)
    const name = asString(record.Name, `palette[${index}].Name`)
    const propertiesValue = record.Properties
    const properties =
      propertiesValue === undefined ? {} : readProperties(propertiesValue, `palette[${index}].Properties`)

    return {
      index,
      name,
      properties
    }
  })
}

function readBlocks(value: NbtValue, palette: readonly PaletteEntry[]): RenderableBlock[] {
  const entries = asArray(value, 'blocks')

  return entries.map((entry, index) => {
    const record = asRecord(entry, `blocks[${index}]`)
    const state = asNumber(record.state, `blocks[${index}].state`)
    const paletteEntry = palette[state]

    if (paletteEntry === undefined) {
      throw new StructureParseError(`Block ${index} references missing palette state ${state}.`)
    }

    const blockEntity = readBlockEntity(record.nbt, paletteEntry.name, readPosition(record.pos, `blocks[${index}].pos`))
    const block = {
      position: readPosition(record.pos, `blocks[${index}].pos`),
      state,
      name: paletteEntry.name,
      properties: paletteEntry.properties
    }
    return blockEntity ? { ...block, blockEntity } : block
  })
}

function readBlockEntity(value: NbtValue, blockName: string, position: BlockPosition): BlockEntitySummary | null {
  if (value === undefined) {
    return null
  }

  const record = asRecord(value, 'block nbt')
  const id = typeof record.id === 'string' ? record.id : blockName
  const kind = inferBlockEntityCapability(id, blockName, record).kind
  const items = kind === 'container' ? readContainerItems(record.Items) : []
  return {
    id,
    kind,
    position,
    ...(kind === 'container'
      ? {
          containerMode: items.length > 0 || record.LootTable === undefined ? 'items' : 'lootTable',
          items
        }
      : {}),
    fields: readEditableBlockEntityFields(record)
  }
}

function readContainerItems(value: NbtValue): readonly ContainerItemSummary[] {
  if (value === undefined) {
    return []
  }

  return asArray(value, 'block nbt.Items').flatMap((entry, index) => {
    const record = asRecord(entry, `block nbt.Items[${index}]`)
    const id = typeof record.id === 'string' ? record.id : null
    const slot = typeof record.Slot === 'number' ? record.Slot : null
    const count = typeof record.Count === 'number' ? record.Count : 1
    return id !== null && slot !== null ? [{ slot, id, count }] : []
  })
}

function readEditableBlockEntityFields(record: NbtRecord): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'id' || key === 'x' || key === 'y' || key === 'z' || key === 'Items') {
      continue
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      fields[key] = String(value)
    }
  }

  return fields
}

function readEntities(value: NbtValue): EntitySummary[] {
  if (value === undefined) {
    return []
  }

  return asArray(value, 'entities').map((entity, index) => {
    const record = asRecord(entity, `entities[${index}]`)
    const nbtRecord = record.nbt === undefined ? record : asRecord(record.nbt, `entities[${index}].nbt`)
    const id = typeof nbtRecord.id === 'string' ? nbtRecord.id : 'unknown'

    return { id }
  })
}

function readProperties(value: NbtValue, label: string): Record<string, string> {
  const record = asRecord(value, label)
  const properties: Record<string, string> = {}

  for (const [key, propertyValue] of Object.entries(record)) {
    properties[key] = String(propertyValue)
  }

  return properties
}

function readPosition(value: NbtValue, label: string): BlockPosition {
  const position = asNumberArray(value, label)
  if (position.length !== 3) {
    throw new StructureParseError(`${label} must contain exactly 3 numbers.`)
  }

  return [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0]
}

function asRecord(value: NbtValue, label: string): NbtRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StructureParseError(`${label} must be an object.`)
  }

  return value as NbtRecord
}

function asArray(value: NbtValue, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new StructureParseError(`${label} must be a list.`)
  }

  return value
}

function asNumberArray(value: NbtValue, label: string): number[] {
  const values = asArray(value, label)
  if (!values.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new StructureParseError(`${label} must contain only numbers.`)
  }

  return values as number[]
}

function asNumber(value: NbtValue, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new StructureParseError(`${label} must be an integer.`)
  }

  return value
}

function asString(value: NbtValue, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new StructureParseError(`${label} must be a non-empty string.`)
  }

  return value
}
